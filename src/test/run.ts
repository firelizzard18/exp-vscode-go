/* eslint-disable @typescript-eslint/no-explicit-any */

import { TestItem } from 'vscode';
import { GoTestItem, Package, RootItem, TestCase, TestFile } from './item';
import { TestItemResolver } from './itemResolver';
import { Context } from './testing';
import vscode from 'vscode';
import { shouldRunBenchmarks } from './runner';
import path from 'node:path';
import { TestRun } from 'vscode';
import { Location } from 'vscode';
import { TestMessage } from 'vscode';
import { Uri, Position } from 'vscode';

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
	readonly source: vscode.TestRunRequest;
	readonly #packages: Set<Package>;
	readonly include: Map<Package, TestCase[]>;
	readonly exclude: Map<Package, TestCase[]>;

	readonly #resolver: TestItemResolver<GoTestItem>;

	private constructor(
		original: vscode.TestRunRequest,
		packages: Set<Package>,
		include: Map<Package, TestCase[]>,
		exclude: Map<Package, TestCase[]>,
		resolver: TestItemResolver<GoTestItem>
	) {
		this.source = original;
		this.#packages = packages;
		this.include = include;
		this.exclude = exclude;
		this.#resolver = resolver;
	}

	static async from({ workspace }: Context, resolver: TestItemResolver<GoTestItem>, request: vscode.TestRunRequest) {
		const include = (request.include || [...resolver.roots]).map((x) => resolveGoItem(resolver, x));
		const exclude = request.exclude?.map((x) => resolveGoItem(resolver, x)) || [];

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

		return new this(request, packages, testsForPackage, excludeForPackage, resolver);
	}

	get size() {
		return this.#packages.size;
	}

	async *packages(run: TestRun) {
		for (const pkg of this.#packages) {
			const pkgItem = await this.#resolver.getOrCreateAll(pkg);
			const include = await this.#resolveTestItems(this.include.get(pkg) || pkg.allTests());
			const exclude = await this.#resolveTestItems(this.exclude.get(pkg) || []);
			const itemByName = await this.#testItemsByName(pkg);

			yield new PackageTestRun(this, run, pkg, pkgItem, include, exclude, itemByName);
		}
	}

	async #resolveTestItems<T extends GoTestItem>(goItems: T[]) {
		return new Map(
			await Promise.all(
				goItems.map(async (x): Promise<[T, TestItem]> => [x, await this.#resolver.getOrCreateAll(x)])
			)
		);
	}

	async #testItemsByName(pkg: Package) {
		const itemByName = new Map<string, TestItem>();
		await Promise.all(
			pkg.allTests().map(async (test) => {
				const item = await this.#resolver.get(test);
				if (item) itemByName.set(test.name, item);
			})
		);
		return itemByName;
	}
}

export class PackageTestRun {
	readonly goItem: Package;
	readonly testItem: TestItem;
	readonly include: Map<TestCase, TestItem>;
	readonly exclude: Map<TestCase, TestItem>;
	readonly #request: TestRunRequest;
	readonly #run: TestRun;
	readonly #itemByName: Map<string, TestItem>;

	constructor(
		request: TestRunRequest,
		run: TestRun,
		goItem: Package,
		testItem: TestItem,
		include: Map<TestCase, TestItem>,
		exclude: Map<TestCase, TestItem>,
		itemByName: Map<string, TestItem>
	) {
		this.goItem = goItem;
		this.testItem = testItem;
		this.include = include;
		this.exclude = exclude;
		this.#request = request;
		this.#run = run;
		this.#itemByName = itemByName;
	}

	readonly stderr: string[] = [];
	readonly output = new Map<string, string[]>();
	readonly currentLocation = new Map<string, Location>();

	get includeAll() {
		return !this.#request.include.has(this.goItem);
	}

	onStdout(s: string) {
		// Attempt to parse the output as a test message
		let msg: Event;
		try {
			msg = JSON.parse(s);
		} catch (_) {
			// Unknown output
			this.append(s);
			return;
		}

		const item = this.#itemByName.get(msg.Test!);
		const elapsed = typeof msg.Elapsed === 'number' ? msg.Elapsed * 1000 : undefined;
		switch (msg.Action) {
			case 'output': {
				if (!msg.Output) {
					break;
				}

				// Track output
				const { id } = item || this.testItem;
				if (!this.output.has(id)) {
					this.output.set(id, []);
				}
				this.output.get(id)!.push(msg.Output);

				if (!item || /^(=== RUN|\s*--- (FAIL|PASS): )/.test(msg.Output)) {
					this.append(msg.Output, undefined, this.testItem);
					break;
				}

				const { message, location } = parseOutputLocation(msg.Output, path.join(item.uri!.fsPath, '..'));
				if (location) {
					this.currentLocation.set(id, location);
				}
				this.append(message, location || this.currentLocation.get(id), item);

				// Detect benchmark completion, e.g.
				//   "BenchmarkFooBar-4    123456    123.4 ns/op    123 B/op    12 allocs/op"
				const m = msg.Output.match(/^(?<name>Benchmark[#/\w+]+)(?:-(?<procs>\d+)\s+(?<result>.*))?(?:$|\n)/);
				if (m && msg.Test && m.groups?.name === msg.Test) {
					this.#run.passed(item);
				}

				break;
			}

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
						this.stderr
					);
				} else if (item) {
					const messages = parseTestFailure(item, this.output.get(item.id) || []);
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

function resolveGoItem(resolver: TestItemResolver<GoTestItem>, item: TestItem) {
	const pi = resolver.getProviderItem(item.id);
	if (!pi) throw new Error(`Cannot find test item ${item.id}`);
	return pi;
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
