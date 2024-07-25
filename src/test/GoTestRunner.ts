/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	CancellationToken,
	Location,
	Position,
	TestItem,
	TestMessage,
	TestRun,
	TestRunProfile,
	TestRunProfileKind,
	TestRunRequest,
	Uri
} from 'vscode';
import cp from 'child_process';
import path from 'path';
import { GoTestItem, Package, RootItem, TestCase, TestFile } from './GoTestItem';
import { TestItemResolver } from './TestItemResolver';
import { Context, doSafe, reportError, TestController, Workspace } from './testSupport';
import { killProcessTree } from '../utils/processUtils';
import { LineBuffer } from '../utils/lineBuffer';
import { Spawner } from './utils';

export interface GoTestRunRequest extends Omit<TestRunRequest, 'include' | 'exclude'> {
	readonly original: TestRunRequest;
	readonly packages: Set<Package>;
	readonly include: Map<Package, TestCase[]>;
	readonly exclude: Map<Package, TestCase[]>;
}

export class GoTestRunner {
	readonly #context: Context;
	readonly #ctrl: TestController;
	readonly #resolver: TestItemResolver<GoTestItem>;
	readonly #profile: TestRunProfile;

	constructor(
		context: Context,
		ctrl: TestController,
		resolver: TestItemResolver<GoTestItem>,
		label: string,
		kind: TestRunProfileKind,
		isDefault = false
	) {
		this.#context = context;
		this.#ctrl = ctrl;
		this.#resolver = resolver;
		this.#profile = ctrl.createRunProfile(
			label,
			kind,
			(request, token) =>
				doSafe(context, 'execute test', async () => {
					const r = await resolveRunRequest(context, resolver, request);
					await this.#run(r, token);
				}),
			isDefault
		);
	}

	async #run(request: GoTestRunRequest, token: CancellationToken) {
		if (request.packages.size > 1 && this.#profile.kind === TestRunProfileKind.Debug) {
			reportError(this.#context, new Error('debugging multiple packages is not supported'));
			return;
		}

		// Save all files to ensure `go test` tests the latest changes
		await this.#context.workspace.saveAll(false);

		const run = this.#ctrl.createTestRun(request.original);

		// Execute the tests
		try {
			let first = true;
			for (const pkg of request.packages) {
				if (first) {
					first = false;
				} else {
					run.appendOutput('\r\n\r\n');
				}

				const pkgItem = await this.#resolver.getOrCreateAll(pkg);
				const include = await resolveTestItems(this.#resolver, request.include.get(pkg) || pkg.allTests());
				const exclude = await resolveTestItems(this.#resolver, request.exclude.get(pkg) || []);

				await goTest({
					context: this.#context,
					run,
					pkg,
					pkgItem,
					runAll: !request.include.get(pkg),
					include,
					exclude,
					resolver: this.#resolver,
					token,
					spawn: this.#profile.kind === TestRunProfileKind.Debug ? this.#context.debug : this.#context.spawn
				});
			}
		} finally {
			run.end();
		}
	}
}

/**
 * go test -json output format.
 * which is a subset of https://golang.org/cmd/test2json/#hdr-Output_Format
 * and includes only the fields that we are using.
 */
interface GoTestOutput {
	Action: string;
	Output?: string;
	Package?: string;
	Test?: string;
	Elapsed?: number; // seconds
}

// TODO: Once this is merged into vscode-go, replace with vscode-go's more
// complete goTest implementation (with modifications)
async function goTest({
	context,
	run,
	pkg,
	pkgItem,
	runAll,
	include,
	exclude,
	resolver,
	token,
	spawn
}: {
	context: Context;
	run: TestRun;
	pkg: Package;
	pkgItem: TestItem;
	runAll: boolean;
	include: Map<TestCase, TestItem>;
	exclude: Map<TestCase, TestItem>;
	resolver: TestItemResolver<GoTestItem>;
	token: CancellationToken;
	spawn: Spawner;
}) {
	run.enqueued(pkgItem);
	for (const [goItem, item] of include) {
		if (!exclude.has(goItem)) {
			run.enqueued(item);
		}
	}

	const { binPath: goRuntimePath } = context.go.settings.getExecutionCommand('go', pkg.uri) || {};
	if (!goRuntimePath) {
		run.failed(pkgItem, {
			message: 'Failed to run "go test" as the "go" binary cannot be found in either GOROOT or PATH'
		});
		return;
	}
	const flags: string[] = [
		'-fullpath' // Include the full path for output events
	];
	if (runAll) {
		// Include all test cases
		flags.push('-run=.');
		if (shouldRunBenchmarks(context.workspace, pkg)) {
			flags.push('-bench=.');
		}
	} else {
		// Include specific test cases
		flags.push(`-run=${makeRegex(include.keys(), (x) => x.kind !== 'benchmark')}`);
		flags.push(`-bench=${makeRegex(include.keys(), (x) => x.kind === 'benchmark')}`);
	}
	if (exclude.size) {
		// Exclude specific test cases
		flags.push(`-skip=${makeRegex(exclude.keys())}`);
	}

	const append = (output: string, location?: Location, test?: TestItem) => {
		if (!output.endsWith('\n')) output += '\n';
		output = output.replace(/\n/g, '\r\n');
		run.appendOutput(output, location, test);
	};

	const errOutput: string[] = [];
	const onStderr = (line: string | null) => {
		if (!line) return;
		append(line, undefined, pkgItem);
		errOutput.push(line);
		context.output.debug(`stderr> ${line}`);
	};

	// Map item to name for all tests in the package
	const itemByName = new Map<string, TestItem>();
	await Promise.all(
		pkg.allTests().map(async (test) => {
			const item = await resolver.get(test);
			if (item) itemByName.set(test.name, item);
		})
	);

	const output = new Map<string, string[]>();
	const currentLocation = new Map<string, Location>();
	const onStdout = (s: string | null) => {
		if (!s) return;

		// Attempt to parse the output as a test message
		let msg: GoTestOutput;
		try {
			msg = JSON.parse(s);
			context.output.debug(s);
		} catch (_) {
			// Unknown output
			append(s);
			context.output.debug(`stdout> ${s}`);
			return;
		}

		const item = itemByName.get(msg.Test!);
		const elapsed = typeof msg.Elapsed === 'number' ? msg.Elapsed * 1000 : undefined;
		switch (msg.Action) {
			case 'output': {
				if (!msg.Output) {
					break;
				}

				// Track output
				const { id } = item || pkgItem;
				if (!output.has(id)) {
					output.set(id, []);
				}
				output.get(id)!.push(msg.Output);

				if (!item || /^(=== RUN|\s*--- (FAIL|PASS): )/.test(msg.Output)) {
					append(msg.Output, undefined, pkgItem);
					break;
				}

				const { message, location } = parseOutputLocation(msg.Output, path.join(item.uri!.fsPath, '..'));
				if (location) {
					currentLocation.set(id, location);
				}
				append(message, location || currentLocation.get(id), item);

				// Detect benchmark completion, e.g.
				//   "BenchmarkFooBar-4    123456    123.4 ns/op    123 B/op    12 allocs/op"
				const m = msg.Output.match(/^(?<name>Benchmark[#/\w+]+)(?:-(?<procs>\d+)\s+(?<result>.*))?(?:$|\n)/);
				if (m && msg.Test && m.groups?.name === msg.Test) {
					run.passed(item);
				}

				break;
			}

			case 'run':
			case 'start':
				run.started(item || pkgItem);
				break;

			case 'skip':
				run.skipped(item || pkgItem);
				break;

			case 'pass':
				run.passed(item || pkgItem, elapsed);
				break;

			case 'fail': {
				if (!item) {
					processPackageFailure(run, pkg, pkgItem, elapsed, output.get(pkgItem.id) || [], errOutput);
					break;
				}

				const messages = parseTestFailure(item, output.get(item.id) || []);
				run.failed(item, messages, elapsed);
				break;
			}

			default:
				// Ignore 'cont' and 'pause'
				break;
		}
	};

	append(`$ cd ${pkg.uri.fsPath}\n$ ${goRuntimePath} test ${flags.join(' ')}\n\n`, undefined, pkgItem);
	const r = await spawn(context, goRuntimePath, flags, {
		run,
		cwd: pkg.uri.fsPath,
		cancel: token,
		stdout: onStdout,
		stderr: onStderr
	});
	if (r && r.code !== 0 && r.code !== 1) {
		run.errored(pkgItem, {
			message: `\`go test\` exited with ${[
				...(r.code ? [`code ${r.code}`] : []),
				...(r.signal ? [`signal ${r.signal}`] : [])
			].join(', ')}`
		});
	}
}

async function mapTestItems(
	resolver: TestItemResolver<GoTestItem>,
	map: Map<string, TestItem>,
	tests: Iterable<TestCase>
) {
	for (const test of tests) {
		map.set(test.name, await resolver.getOrCreateAll(test));
		await mapTestItems(resolver, map, test.getChildren());
	}
}

function shouldRunBenchmarks(workspace: Workspace, pkg: Package) {
	// When the user clicks the run button on a package, they expect all of the
	// tests within that package to run - they probably don't want to run the
	// benchmarks. So if a benchmark is not explicitly selected, don't run
	// benchmarks. But the user may disagree, so behavior can be changed with
	// `testExplorer.runPackageBenchmarks`. However, if the user clicks the run
	// button on a file or package that contains benchmarks and nothing else,
	// they likely expect those benchmarks to run.
	if (workspace.getConfiguration('goExp', pkg.uri).get<boolean>('testExplorer.runPackageBenchmarks')) {
		return true;
	}
	for (const test of pkg.allTests()) {
		if (test.kind !== 'benchmark') {
			return false;
		}
	}
	return true;
}

async function resolveRunRequest(
	{ workspace }: Context,
	resolver: TestItemResolver<GoTestItem>,
	request: TestRunRequest
): Promise<GoTestRunRequest> {
	const include = (request.include || [...resolver.roots]).map((x) => resolveGoTestItem(resolver, x));
	const exclude = request.exclude?.map((x) => resolveGoTestItem(resolver, x)) || [];

	// Get roots that aren't excluded
	const roots = new Set(include.filter((x) => x instanceof RootItem));
	exclude.forEach((x) => roots.delete(x as any));

	// Get packages that aren't excluded
	const packages = new Set(include.filter((x) => x instanceof Package));
	await Promise.all(
		[...roots].map(async (x) => {
			for (const pkg of (await x.allPackages()) || []) {
				packages.add(pkg);
			}
		})
	);
	exclude.forEach((x) => packages.delete(x as any));

	// Get explicitly requested test items that aren't excluded
	const tests = new Set(testCases(include));
	for (const test of testCases(exclude)) {
		tests.delete(test);
	}

	// Remove redundant requests for specific tests
	for (const item of tests) {
		const pkg = item.file.package;
		if (!packages.has(pkg)) {
			continue;
		}

		// If a package is selected, all tests within it will be run so ignore
		// explicit requests for a test if its package is selected. Do the same
		// for benchmarks, if shouldRunBenchmarks.
		if (item.kind !== 'benchmark' || shouldRunBenchmarks(workspace, pkg)) {
			tests.delete(item);
		}
	}

	// Record requests for specific tests
	const testsForPackage = new Map<Package, TestCase[]>();
	for (const item of tests) {
		const pkg = item.file.package;
		packages.add(pkg);

		if (!testsForPackage.has(pkg)) {
			testsForPackage.set(pkg, []);
		}
		testsForPackage.get(pkg)!.push(item);
	}

	// Tests that should be excluded for each package
	const excludeForPackage = new Map<Package, TestCase[]>();
	for (const item of testCases(exclude)) {
		const pkg = item.file.package;
		if (!packages.has(pkg)) continue;

		if (!excludeForPackage.has(pkg)) {
			excludeForPackage.set(pkg, []);
		}
		excludeForPackage.get(pkg)!.push(item);
	}

	return {
		...request,
		original: request,
		packages,
		include: testsForPackage,
		exclude: excludeForPackage
	};
}

async function resolveTestItems<T extends GoTestItem>(resolver: TestItemResolver<GoTestItem>, goItems: T[]) {
	return new Map(
		await Promise.all(goItems.map(async (x): Promise<[T, TestItem]> => [x, await resolver.getOrCreateAll(x)]))
	);
}

function resolveGoTestItem(resolver: TestItemResolver<GoTestItem>, item: TestItem) {
	const pi = resolver.getProviderItem(item.id);
	if (!pi) throw new Error(`Cannot find test item ${item.id}`);
	return pi;
}

function* testCases(items: GoTestItem[]) {
	for (const item of items) {
		if (item instanceof TestCase) {
			yield item;
		}
		if (item instanceof TestFile) {
			yield* item.allTests();
		}
	}
}

function processPackageFailure(
	run: TestRun,
	pkg: Package,
	pkgItem: TestItem,
	elapsed: number | undefined,
	stdout: string[],
	stderr: string[]
) {
	const buildFailed = stdout.some((x) => /\[build failed\]\s*$/.test(x));
	if (!buildFailed) {
		run.failed(pkgItem, [], elapsed);
		return;
	}

	const pkgMessages: TestMessage[] = [];
	const testMessages = new Map<TestItem, TestMessage[]>();

	for (const line of stderr) {
		const { message, location } = parseOutputLocation(line, pkg.uri.fsPath);
		const test =
			location &&
			[...pkgItem.children]
				.map((x) => x[1])
				.find((x) => x.uri!.fsPath === location.uri.fsPath && x.range?.contains(location.range));

		if (!test) {
			pkgMessages.push({ message });
			continue;
		}

		if (!testMessages.has(test)) {
			testMessages.set(test, []);
		}
		testMessages.get(test)!.push({ message, location });
	}

	run.errored(pkgItem, pkgMessages, elapsed);
	for (const [test, messages] of testMessages) {
		run.errored(test, messages);
	}
}

/**
 * Returns build/test error messages associated with source locations.
 * Location info is inferred heuristically by applying a simple pattern matching
 * over the output strings from `go test -json` `output` type action events.
 */
function parseTestFailure(test: TestItem, output: string[]): TestMessage[] {
	const messages: TestMessage[] = [];

	const { kind } = GoTestItem.parseId(test.id);
	const gotI = output.indexOf('got:\n');
	const wantI = output.indexOf('want:\n');
	if (kind === 'example' && gotI >= 0 && wantI >= 0) {
		const got = output.slice(gotI + 1, wantI).join('');
		const want = output.slice(wantI + 1).join('');
		const message = TestMessage.diff('Output does not match', want, got);
		if (test.uri && test.range) {
			message.location = new Location(test.uri, test.range.start);
		}
		messages.push(message);
		output = output.slice(0, gotI);
	}

	// TODO(hyangah): handle panic messages specially.

	const dir = path.join(test.uri!.fsPath, '..');
	output.forEach((line) => messages.push(parseOutputLocation(line, dir)));

	return messages;
}

/**
 * ^(?:.*\s+|\s*)                  - non-greedy match of any chars followed by a space or, a space.
 * (?<file>\S+\.go):(?<line>\d+):  - gofile:line: followed by a space.
 * (?<message>.\n)$                - all remaining message up to $.
 */
const lineLocPattern = /^(.*\s+)?(?<file>\S+\.go):(?<line>\d+)(?::(?<column>\d+)): (?<message>.*\n?)$/;

/**
 * Extract the location info from output message.
 * This is not trivial since both the test output and any output/print
 * from the tested program are reported as `output` type test events
 * and not distinguishable. stdout/stderr output from the tested program
 * makes this more trickier.
 *
 * Here we assume that test output messages are line-oriented, precede
 * with a file name and line number, and end with new lines.
 */
function parseOutputLocation(line: string, dir: string): { message: string; location?: Location } {
	const m = line.match(lineLocPattern);
	if (!m?.groups?.file) {
		return { message: line };
	}

	// Paths will always be absolute for versions of Go (1.21+) due to
	// -fullpath, but the user may be using an old version
	const file =
		m.groups.file && path.isAbsolute(m.groups.file)
			? Uri.file(m.groups.file)
			: Uri.file(path.join(dir, m.groups.file));

	// VSCode uses 0-based line numbering (internally)
	const ln = Number(m.groups.line) - 1;
	const col = m.groups.column ? Number(m.groups.column) - 1 : 0;

	return {
		message: m.groups.message,
		location: new Location(file, new Position(ln, col))
	};
}

function makeRegex(tests: Iterable<TestCase>, where: (_: TestCase) => boolean = () => true) {
	// TODO: Handle Go ≤ 1.17 (https://go.dev/issue/39904)
	return [...tests]
		.filter(where)
		.map((x) =>
			x.name
				.split('/')
				.map((part) => `^${escapeRegExp(part)}$`)
				.join('/')
		)
		.join('|');
}

// escapeRegExp escapes regex metacharacters.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
function escapeRegExp(v: string) {
	return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
