/* eslint-disable @typescript-eslint/no-explicit-any */

import { TestItem } from 'vscode';
import { GoTestItem, Package, RootItem, TestCase, TestFile } from './item';
import vscode from 'vscode';
import { shouldRunBenchmarks } from './runner';
import path from 'node:path';
import { TestRun } from 'vscode';
import { Location } from 'vscode';
import { TestMessage } from 'vscode';
import { Uri, Position } from 'vscode';
import { TestManager } from './manager';
import { CapturedProfile, ProfileContainer, ProfileSet } from './profile';

/**
 * go test -json output format.
 * which is a subset of https://golang.org/cmd/test2json/#hdr-Output_Format
 * and includes only the fields that we are using.
 */
interface Event {
	Action: string;
	Output?: string;
	Package?: string;
	Test?: string;
	Elapsed?: number; // seconds
}

export class TestRunRequest {
	readonly manager: TestManager;
	readonly source: vscode.TestRunRequest;
	readonly #packages: Set<Package>;
	readonly include: Map<Package, TestCase[]>;
	readonly exclude: Map<Package, TestCase[]>;

	private constructor(
		manager: TestManager,
		original: vscode.TestRunRequest,
		packages: Set<Package>,
		include: Map<Package, TestCase[]>,
		exclude: Map<Package, TestCase[]>,
	) {
		this.manager = manager;
		this.source = original;
		this.#packages = packages;
		this.include = include;
		this.exclude = exclude;
	}

	/**
	 * Constructs a {@link TestRunRequest} from a {@link vscode.TestRunRequest}.
	 */
	static async from(manager: TestManager, request: vscode.TestRunRequest) {
		const include = (request.include || [...manager.rootTestItems]).map((x) => resolveGoItem(manager, x));
		const exclude = request.exclude?.map((x) => resolveGoItem(manager, x)) || [];

		// Get roots that aren't excluded
		const roots = new Set(include.filter((x): x is RootItem => x instanceof RootItem));
		exclude.forEach((x) => roots.delete(x as any));

		// Get packages that aren't excluded
		const packages = new Set(include.filter((x): x is Package => x instanceof Package));
		await Promise.all(
			[...roots].map(async (x) => {
				for (const pkg of await x.getPackages()) {
					packages.add(pkg);
				}
			}),
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
			if (item.kind !== 'benchmark' || shouldRunBenchmarks(manager.context.workspace, pkg)) {
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

		return new this(manager, request, packages, testsForPackage, excludeForPackage);
	}

	/**
	 * Constructs a new {@link TestRunRequest} with the intersection of the
	 * receiver's included tests and the given tests.
	 */
	async with(tests: Iterable<TestCase | TestFile>) {
		// Determine which tests cases may be included
		const candidates = new Set<TestCase>();
		for (const pkg of this.#packages) {
			(this.include.get(pkg) || pkg.getTests()).forEach((x) => candidates.add(x));
			(this.exclude.get(pkg) || []).forEach((x) => candidates.delete(x));
		}

		// Create the package and include sets for the new request
		const packages = new Set<Package>();
		const include = new Map<Package, TestCase[]>();
		const add = (item: TestCase) => {
			if (!candidates.has(item)) {
				return;
			}
			const items = include.get(item.file.package) || [];
			if (items.includes(item)) {
				return;
			}
			packages.add(item.file.package);
			items.push(item);
			include.set(item.file.package, items);
		};

		for (const item of tests) {
			if (item instanceof TestCase) {
				add(item);
			} else {
				for (const test of item.tests) {
					add(test);
				}
			}
		}

		// Resolve test items
		const testItems: TestItem[] = [];
		await Promise.all(
			[...include.values()].map((x) =>
				Promise.all(
					x.map(async (y) => {
						const item = await this.manager.resolveTestItem(y, { create: true });
						testItems.push(item);
					}),
				),
			),
		);

		return new TestRunRequest(
			this.manager,
			{
				include: testItems,
				exclude: [],
				profile: this.source.profile,
			},
			packages,
			include,
			new Map(),
		);
	}

	get size() {
		return this.#packages.size;
	}

	async *packages(run: TestRun) {
		for (const pkg of this.#packages) {
			const pkgItem = await this.manager.resolveTestItem(pkg, { create: true });
			const include = await this.#resolveTestItems(this.include.get(pkg) || pkg.getTests());
			const exclude = await this.#resolveTestItems(this.exclude.get(pkg) || []);

			yield new PackageTestRun(this, run, pkg, pkgItem, include, exclude);
		}
	}

	async #resolveTestItems<T extends GoTestItem>(goItems: T[]) {
		return new Map(
			await Promise.all(
				goItems.map(
					async (x): Promise<[T, TestItem]> => [x, await this.manager.resolveTestItem(x, { create: true })],
				),
			),
		);
	}
}

export class PackageTestRun {
	readonly goItem: Package;
	readonly testItem: TestItem;
	readonly include: Map<TestCase, TestItem>;
	readonly exclude: Map<TestCase, TestItem>;
	readonly #request: TestRunRequest;
	readonly #run: TestRun;

	constructor(
		request: TestRunRequest,
		run: TestRun,
		goItem: Package,
		testItem: TestItem,
		include: Map<TestCase, TestItem>,
		exclude: Map<TestCase, TestItem>,
	) {
		this.goItem = goItem;
		this.testItem = testItem;
		this.include = include;
		this.exclude = exclude;
		this.#request = request;
		this.#run = run;
	}

	readonly stderr: string[] = [];
	readonly output = new Map<string, string[]>();
	readonly currentLocation = new Map<string, Location>();

	get includeAll() {
		return !this.#request.include.has(this.goItem);
	}

	/**
	 * Handles an event from `go test -json`.
	 */
	async onStdout(s: string) {
		// Attempt to parse the output as a test message
		let msg: Event;
		try {
			msg = JSON.parse(s);
		} catch (_) {
			// Unknown output
			this.append(s);
			return;
		}

		// Resolve the named test case and its associated test item
		// const test = msg.Test ? await this.#resolveTestCase(this.goItem, msg.Test) : undefined;
		const test = msg.Test ? this.goItem.findTest(msg.Test, true, this.#run) : undefined;
		const item = test && (await this.#request.manager.resolveTestItem(test, { create: true }));

		const elapsed = typeof msg.Elapsed === 'number' ? msg.Elapsed * 1000 : undefined;
		if (msg.Action === 'output') {
			if (!msg.Output) {
				return;
			}

			// Track output
			const { id } = item || this.testItem;
			if (!this.output.has(id)) {
				this.output.set(id, []);
			}
			this.output.get(id)!.push(msg.Output);

			let location: Location | undefined;
			let message = msg.Output;
			if (item && !/^(=== RUN|\s*--- (FAIL|PASS): )/.test(msg.Output)) {
				const parsed = parseOutputLocation(msg.Output, path.join(item.uri!.fsPath, '..'));
				message = parsed.message;
				location = parsed.location;
				if (location) {
					this.currentLocation.set(id, location);
				} else {
					location = this.currentLocation.get(id);
				}
			}
			this.append(message, location, item || this.testItem);

			// go test is not good about reporting the start and end of benchmarks
			// so we'll synthesize those events to make life easier.
			if (!msg.Test?.startsWith('Benchmark')) {
				return;
			}
			if (msg.Output === `=== RUN   ${msg.Test}\n`) {
				// === RUN   BenchmarkFooBar
				msg.Action = 'run';
			} else if (
				msg.Output?.match(/^(?<name>Benchmark[/\w]+)-(?<procs>\d+)\s+(?<result>.*)(?:$|\n)/)?.[1] === msg.Test
			) {
				// BenchmarkFooBar-4    123456    123.4 ns/op    123 B/op    12 allocs/op
				msg.Action = 'pass';
			} else {
				return;
			}
		}

		switch (msg.Action) {
			case 'run':
			case 'start':
				if (!msg.Test) {
					this.#run.started(this.testItem);
				} else if (item) {
					this.#run.started(item);
				}
				break;

			case 'skip':
				if (!msg.Test) {
					this.#run.skipped(this.testItem);
				} else if (item) {
					this.#run.skipped(item);
				}
				break;

			case 'pass':
				if (!msg.Test) {
					this.#run.passed(this.testItem, elapsed);
				} else if (item) {
					this.#run.passed(item, elapsed);
				}
				break;

			case 'fail': {
				if (!msg.Test) {
					processPackageFailure(
						this.#run,
						this.goItem,
						this.testItem,
						elapsed,
						this.output.get(this.testItem.id) || [],
						this.stderr,
					);
				} else if (item) {
					const messages = parseTestFailure(test, this.output.get(item.id) || []);
					this.#run.failed(item, messages, elapsed);
				}
				break;
			}

			default:
				// Ignore 'cont' and 'pause'
				break;
		}
	}

	onStderr(s: string) {
		this.append(s, undefined, this.testItem);
		this.stderr.push(s);
	}

	append(output: string, location?: Location, test?: TestItem) {
		if (!output.endsWith('\n')) output += '\n';
		output = output.replace(/\n/g, '\r\n');
		this.#run.appendOutput(output, location, test);
	}

	forEach(fn: (item: TestItem, goItem?: TestCase) => void) {
		const recurse = (item: TestItem, goItem?: TestCase) => {
			fn(item, goItem);
			for (const [, child] of item.children) {
				recurse(child);
			}
		};

		fn(this.testItem);
		for (const [goItem, item] of this.include) {
			if (!this.exclude.has(goItem)) {
				recurse(item, goItem);
			}
		}
	}
}

function* testCases(items: GoTestItem[]) {
	for (const item of items) {
		if (item instanceof TestCase) {
			yield item;
		}
		if (item instanceof TestFile) {
			yield* item.tests;
		}
	}
}

function resolveGoItem(manager: TestManager, item: TestItem) {
	let pi = manager.resolveGoTestItem(item.id);
	if (!pi) throw new Error(`Cannot find test item ${item.id}`);

	// VSCode appears to have a bug where clicking {run} on a test item that
	// has no children except `Profiles` selects the wrong item to run.
	if (pi instanceof CapturedProfile) pi = pi.parent;
	if (pi instanceof ProfileSet) pi = pi.parent;
	if (pi instanceof ProfileContainer) pi = pi.parent;
	return pi;
}

function processPackageFailure(
	run: TestRun,
	pkg: Package,
	pkgItem: TestItem,
	elapsed: number | undefined,
	stdout: string[],
	stderr: string[],
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
function parseTestFailure(test: GoTestItem, output: string[]): TestMessage[] {
	const messages: TestMessage[] = [];

	const gotI = output.indexOf('got:\n');
	const wantI = output.indexOf('want:\n');
	if (test.kind === 'example' && gotI >= 0 && wantI >= 0) {
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
		location: new Location(file, new Position(ln, col)),
	};
}
