import { Location, Position, TestItem, TestMessage, TestRun, Uri } from 'vscode';
import { GoTestItem, Package, StaticTestCase, TestCase } from './model';
import { TestEvent } from './testEvent';
import path from 'node:path';

export interface ResolvedRunRequest {
	size: number;
	packages(run: TestRun): Iterable<PackageTestRun>;
}

export class PackageTestRun {
	readonly goItem: Package;
	readonly testItem: TestItem;
	readonly include: Map<TestCase, TestItem>;
	readonly exclude: Map<TestCase, TestItem>;
	readonly run: TestRun;
	#buildFailed = false;

	constructor(
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
		this.run = run;
	}

	readonly stderr: string[] = [];
	readonly output = new Map<string, { output: string[]; item: TestItem; test?: TestCase }>();
	readonly currentLocation = new Map<string, Location>();

	get uri() {
		return this.goItem.uri;
	}

	get includeAll() {
		return !this.#request.include.has(this.goItem);
	}

	get buildFailed() {
		return this.#buildFailed;
	}

	/**
	 * Handles an event from `go test -json`.
	 */
	async onStdout(s: string) {
		// Attempt to parse the output as a test message
		let msg: TestEvent;
		try {
			msg = JSON.parse(s);
		} catch (_) {
			// Unknown output
			this.append(s);
			return;
		}

		// Resolve the named test case and its associated test item
		const test = msg.Test ? this.goItem.findTest(msg.Test, true, this.run) : undefined;
		const item = test && (await this.#request.manager.resolveTestItem(test, { create: true }));
		await this.#onEvent(test, item, msg);
	}

	async #onEvent(test: TestCase | undefined, item: TestItem | undefined, msg: TestEvent) {
		const elapsed = typeof msg.Elapsed === 'number' ? msg.Elapsed * 1000 : undefined;
		switch (msg.Action) {
			case 'output':
			case 'build-output':
				await this.#onOutput(test, item, msg);
				break;

			case 'build-fail': {
				let didReport = false;
				this.output.forEach(({ output, item }) => {
					// Exclude the comment lines
					const message = output.filter((x) => !x.startsWith('# ')).join('\n');
					if (!message) return;

					didReport = true;
					item.error = message;
					this.run.errored(item, { message });
				});
				if (!didReport) {
					this.testItem.error = 'Build error';
				}
				this.run.errored(item || this.testItem, []);
				this.#buildFailed = true;
				break;
			}

			case 'run':
			case 'start':
				if (!msg.Test) {
					this.run.started(this.testItem);
				} else if (item) {
					this.run.started(item);
				}
				break;

			case 'skip':
				if (!msg.Test) {
					this.run.skipped(this.testItem);
				} else if (item) {
					this.run.skipped(item);
				}
				break;

			case 'pass':
				if (!msg.Test) {
					this.run.passed(this.testItem, elapsed);
				} else if (item) {
					this.run.passed(item, elapsed);
				}
				break;

			case 'fail': {
				if (!msg.Test) {
					processPackageFailure(
						this.run,
						this.goItem,
						this.testItem,
						elapsed,
						this.output.get(this.testItem.id)?.output || [],
						this.stderr,
					);
				} else if (item && test) {
					const messages = parseTestFailure(test, this.output.get(item.id)?.output || []);
					this.run.failed(item, messages, elapsed);
				}
				break;
			}

			default:
				// Ignore 'cont' and 'pause'
				break;
		}
	}

	async #onOutput(test: TestCase | undefined, item: TestItem | undefined, msg: TestEvent) {
		if (!msg.Output) {
			return;
		}

		// Try to deduce the location of the output
		const parsed = parseOutputLocation(msg.Output, path.join((item || this.testItem).uri!.fsPath, '..'));
		const message = parsed.message;
		let location = parsed.location;

		const origItem = item;
		const origTest = test;
		item ??= this.testItem;

		// The output location is only shown on the first line so remember what
		// the 'current' location is; continuations are prefixed with 4 spaces
		if (location) {
			this.currentLocation.set(item.id, location);
		} else if (origItem && message.startsWith('    ')) {
			location = this.currentLocation.get(item.id);
		}

		// Determine the test from the location
		if (!origTest && location) {
			test = this.goItem.findTestAt(location);
			item = test ? await this.#request.manager.resolveTestItem(test, { create: true }) : item;
		}

		// Record the output
		this.append(message, location, item || this.testItem);

		// Track output for later detection of errors
		if (!this.output.has(item.id)) {
			this.output.set(item.id, { output: [], item, test });
		}
		this.output.get(item.id)!.output.push(msg.Output);

		// go test is not good about reporting the start and end of benchmarks
		// so we'll synthesize them.
		if (!msg.Test?.startsWith('Benchmark')) {
			return;
		}

		if (msg.Output === `=== RUN   ${msg.Test}\n`) {
			// === RUN   BenchmarkFooBar
			this.#onEvent(origTest, origItem, {
				...msg,
				Action: 'run',
			});
		} else if (
			msg.Output?.match(/^(?<name>Benchmark[/\w]+)-(?<procs>\d+)\s+(?<result>.*)(?:$|\n)/)?.[1] === msg.Test
		) {
			// BenchmarkFooBar-4    123456    123.4 ns/op    123 B/op    12 allocs/op
			this.#onEvent(origTest, origItem, {
				...msg,
				Action: 'pass',
			});
		}
	}

	onStderr(s: string) {
		this.append(s, undefined, this.testItem);
		this.stderr.push(s);
	}

	append(output: string, location?: Location, test?: TestItem) {
		if (!output.endsWith('\n')) output += '\n';
		output = output.replace(/\n/g, '\r\n');
		this.run.appendOutput(output, location, test);
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
	switch (test.kind) {
		case 'profile-container':
		case 'profile-set':
		case 'profile':
			// This should never happen.
			throw new Error('Internal error');
	}

	const messages: TestMessage[] = [];

	const gotI = output.indexOf('got:\n');
	const wantI = output.indexOf('want:\n');
	if (test.kind === 'example' && gotI >= 0 && wantI >= 0) {
		const got = output.slice(gotI + 1, wantI).join('');
		const want = output.slice(wantI + 1).join('');
		const message = TestMessage.diff('Output does not match', want, got);
		if (test instanceof StaticTestCase && test.range) {
			message.location = new Location(test.uri, test.range.start);
		}
		messages.push(message);
		output = output.slice(0, gotI);
	}

	// TODO(hyangah): handle panic messages specially.

	const dir = path.join(test.uri.fsPath, '..');
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
