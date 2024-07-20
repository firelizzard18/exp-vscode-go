/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	CancellationToken,
	Location,
	TestController,
	TestItem,
	TestRun,
	TestRunProfile,
	TestRunProfileKind,
	TestRunRequest
} from 'vscode';
import cp from 'child_process';
import { GoTestItem, Package, RootItem, TestCase, TestFile } from './GoTestItem';
import { TestItemResolver } from './TestItemResolver';
import { Context, Workspace } from './testSupport';
import { killProcessTree } from '../utils/processUtils';
import { LineBuffer } from '../utils/lineBuffer';

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
		doSafe: <T>(msg: string, fn: () => T | Promise<T>) => T | undefined | Promise<T | undefined>,
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
				doSafe('execute test', async () => {
					const r = await resolveRunRequest(context, resolver, request);
					await this.#run(r, token);
				}),
			isDefault
		);
	}

	async #run(request: GoTestRunRequest, token: CancellationToken) {
		// Save all files to ensure `go test` tests the latest changes
		await this.#context.workspace.saveAll(false);

		// Open the test output panel
		const showOutput = [...request.packages].some((x) =>
			this.#context.workspace.getConfiguration('goExp', x.uri).get<boolean>('testExplorer.showOutput')
		);
		if (showOutput) {
			await this.#context.commands.focusTestOutput();
		}

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
				const include = await resolveTestItems(this.#resolver, request.include.get(pkg) || pkg.getTests());
				const exclude = await resolveTestItems(this.#resolver, request.exclude.get(pkg) || []);

				await goTest({
					context: this.#context,
					run,
					pkg,
					pkgItem,
					runAll: !request.include.get(pkg),
					include,
					exclude,
					token
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
	context: { workspace, go },
	run,
	pkg,
	pkgItem,
	runAll,
	include,
	exclude,
	token
}: {
	context: Context;
	run: TestRun;
	pkg: Package;
	pkgItem: TestItem;
	runAll: boolean;
	include: Map<TestCase, TestItem>;
	exclude: Map<TestCase, TestItem>;
	token: CancellationToken;
}) {
	run.enqueued(pkgItem);
	for (const [goItem, item] of include) {
		if (!exclude.has(goItem)) {
			run.enqueued(item);
		}
	}

	const { binPath: goRuntimePath } = go.settings.getExecutionCommand('go', pkg.uri) || {};
	if (!goRuntimePath) {
		run.failed(pkgItem, {
			message: 'Failed to run "go test" as the "go" binary cannot be found in either GOROOT or PATH'
		});
		return;
	}
	const args: string[] = [
		'test',
		'-json',
		'-fullpath' // Include the full path for output events
	];
	if (runAll) {
		// Include all test cases
		args.push('-run=.');
		if (shouldRunBenchmarks(workspace, pkg)) {
			args.push('-bench=.');
		}
	} else {
		// Include specific test cases
		args.push(`-run=^${makeRegex(include.keys(), (x) => x.kind !== 'benchmark')}$`);
		args.push(`-bench=^${makeRegex(include.keys(), (x) => x.kind === 'benchmark')}$`);
	}
	if (exclude.size) {
		// Exclude specific test cases
		args.push(`-skip=^${makeRegex(exclude.keys())}$`);
	}

	const append = (output: string, location?: Location, test?: TestItem) => {
		run.appendOutput(output.replace(/\n/g, '\r\n'), location, test);
	};

	// TODO: map relative paths
	const itemByName = new Map([...include].map(([test, item]) => [test.name, item]));
	const onOutput = (s: string | null) => {
		if (!s) return;

		// Attempt to parse the output as a test message
		let msg: GoTestOutput;
		try {
			msg = JSON.parse(s);
		} catch (_) {
			// Unknown output
			append(s);
			return;
		}

		// TODO: Benchmarks probably need a lot more processing as per
		// extension/src/goTest/test_events.md (vscode-go)

		const test = itemByName.get(msg.Test!) || pkgItem;
		const elapsed = typeof msg.Elapsed === 'number' ? msg.Elapsed * 1000 : undefined;
		switch (msg.Action) {
			case 'output':
				if (!msg.Output) {
					break;
				}

				// TODO: Extract location
				append(msg.Output, undefined, test);

				// if (record.has(test.id)) record.get(test.id)!.push(e.Output ?? '');
				// else record.set(test.id, [e.Output ?? '']);
				break;

			case 'run':
			case 'start':
				run.started(test);
				break;

			case 'skip':
				run.skipped(test);
				break;

			case 'pass':
				// TODO(firelizzard18): add messages on pass, once that capability
				// is added.
				run.passed(test, elapsed);
				break;

			case 'fail': {
				run.failed(test, [], elapsed);

				// const messages = this.parseOutput(test, record.get(test.id) || []);

				// if (!concat) {
				// 	run.failed(test, messages, (e.Elapsed ?? 0) * 1000);
				// 	break;
				// }

				// const merged = new Map<string, TestMessage>();
				// for (const { message, location } of messages) {
				// 	const loc = `${location?.uri}:${location?.range.start.line}`;
				// 	if (merged.has(loc)) {
				// 		merged.get(loc)!.message += '' + message;
				// 	} else {
				// 		merged.set(loc, { message, location });
				// 	}
				// }

				// run.failed(test, Array.from(merged.values()), (e.Elapsed ?? 0) * 1000);
				break;
			}

			default:
				// Ignore 'cont' and 'pause'
				break;
		}
	};

	const stdout = new LineBuffer();
	stdout.onLine(onOutput);
	stdout.onDone(onOutput);

	const stderr = new LineBuffer();
	stderr.onLine((line) => append(line));
	stderr.onDone((last) => last && append(last));

	append(`$ cd ${pkg.uri.fsPath}\n$ ${goRuntimePath} ${args.join(' ')}\n\n`);
	const { code, signal } = await new Promise<ProcessResult>((resolve) =>
		spawnGoTest({ token, goRuntimePath, args, pkg, resolve, stdout, stderr })
	);
	if (code !== 0) {
		run.errored(pkgItem, {
			message: `\`go test\` exited with ${[
				...(code ? [`code ${code}`] : []),
				...(signal ? [`signal ${signal}`] : [])
			].join(', ')}`
		});
	}
}

interface ProcessResult {
	code: number | null;
	signal: NodeJS.Signals | null;
}

function spawnGoTest({
	token,
	goRuntimePath,
	args,
	pkg,
	stdout,
	stderr,
	resolve
}: {
	token: CancellationToken;
	goRuntimePath: string;
	args: string[];
	pkg: Package;
	stdout: LineBuffer;
	stderr: LineBuffer;
	resolve: (_: ProcessResult) => void;
}) {
	if (token.isCancellationRequested) {
		return;
	}

	const tp = cp.spawn(goRuntimePath, args, { cwd: pkg.uri.fsPath });
	token.onCancellationRequested(() => killProcessTree(tp));

	tp.stdout.on('data', (chunk) => stdout.append(chunk.toString()));
	tp.stderr.on('data', (chunk) => stderr.append(chunk.toString()));

	tp.on('close', (code, signal) => {
		stdout.done();
		stderr.done();
		resolve({ code, signal });
	});
}

function makeRegex(tests: Iterable<TestCase>, where: (_: TestCase) => boolean = () => true) {
	return '.*'; // TODO
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
			for (const pkg of (await x.getPackages()) || []) {
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
	for (const test of pkg.getTests()) {
		if (test.kind !== 'benchmark') {
			return false;
		}
	}
	return true;
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
			yield* item.getTests();
		}
	}
}
