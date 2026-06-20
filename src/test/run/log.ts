import path from 'node:path';
import { Location, TestItem, TestMessage, TestRun } from 'vscode';
import {
	isOutputEvent,
	normalizeTestEvent,
	parseLocation,
	RichOutputEvent,
	RichTestEvent,
	TestEvent,
} from './testEvent';

interface TestResolver {
	(event: Location | string): TestItem | undefined;
}

/**
 * TestRunLog is responsible for logging and processing the output from a test
 * run, attaching output and errors to the appropriate VSCode {@link TestItem}s.
 */
export class TestRunLog {
	readonly #run;
	readonly #defaultTestItem;
	readonly #testFor;

	readonly stderr: string[] = [];
	readonly events = new Map<string, { item: TestItem; events: RichTestEvent[] }>();
	readonly currentLocation = new Map<string, Location>();

	#buildFailed = false;

	constructor(run: TestRun, defaultTestItem: TestItem, testFor: TestResolver) {
		this.#run = run;
		this.#defaultTestItem = defaultTestItem;
		this.#testFor = testFor;
	}

	get buildFailed() {
		return this.#buildFailed;
	}

	/**
	 * Handles an event from `go test -json`.
	 */
	onStdout(s: string) {
		// Attempt to parse the output as a test message
		let msg: TestEvent;
		try {
			msg = JSON.parse(s);
		} catch (_) {
			// Unknown output
			this.append(s);
			return;
		}

		const item = msg.Test ? this.#testFor(msg.Test) : undefined;
		const rich = normalizeTestEvent(item ?? this.#defaultTestItem, msg);

		// The output location is only shown on the first line so remember what
		// the 'current' location is; continuations are prefixed with 8 spaces.
		if (rich.Location) {
			this.currentLocation.set(rich.TestItem.id, rich.Location);
		} else if (item && rich.Action === 'output' && rich.Output?.startsWith('        ')) {
			rich.Output = rich.Output.substring(8);
			rich.Location = this.currentLocation.get(rich.TestItem.id);
		}

		// Determine the test from the location.
		if (!item && rich.Location) {
			rich.TestItem = this.#testFor(rich.Location) ?? this.#defaultTestItem;
		}

		this.#onEvent(rich);
	}

	#onEvent(event: RichTestEvent) {
		const item = event.TestItem;

		// Track events (for reporting build failures).
		if (!this.events.has(item.id)) {
			this.events.set(item.id, { events: [], item });
		}
		this.events.get(item.id)!.events.push(event);

		if (event.Output) {
			this.append(event.Output, event.Location, event.TestItem);
		}

		const elapsed = typeof event.Elapsed === 'number' ? event.Elapsed * 1000 : undefined;
		switch (event.Action) {
			case 'output':
			case 'build-output':
				// Output has already been logged, nothing left to do.
				break;

			case 'build-fail': {
				let didReport = false;
				this.events.forEach(({ events, item }) => {
					// Exclude the comment lines
					const message = events
						.map((x) => x.Output)
						.filter((x) => x && !x.startsWith('# '))
						.join('\n');
					if (!message) return;

					didReport = true;
					item.error = message;
					this.#run.errored(item, { message });
				});
				if (!didReport) {
					this.#defaultTestItem.error = 'Build error';
				}
				this.#run.errored(item, []);
				this.#buildFailed = true;
				break;
			}

			case 'run':
			case 'start':
				this.#run.started(item);
				break;

			case 'skip':
				this.#run.skipped(item);
				break;

			case 'pass':
				this.#run.passed(item, elapsed);
				break;

			case 'fail': {
				const messages = groupOutputEvents(this.events.get(item.id)?.events ?? []).flatMap((x) =>
					parseTestFailure(x),
				);
				this.#run.failed(item, messages, elapsed);
				break;
			}

			default:
				// Ignore 'cont' and 'pause'
				break;
		}
	}

	onStderr(s: string) {
		this.append(s, undefined, this.#defaultTestItem);
		this.stderr.push(s);
	}

	append(output: string, location?: Location, test?: TestItem) {
		if (!output.endsWith('\n')) output += '\n';
		output = output.replace(/\n/g, '\r\n');
		this.#run.appendOutput(output, location, test);
	}
}

function groupOutputEvents(events: RichTestEvent[]) {
	const errors: RichOutputEvent[][] = [];
	const output: RichOutputEvent[][] = [];

	// Group error output.
	for (const event of events) {
		if (!isOutputEvent(event)) continue;
		switch (event.OutputType) {
			case 'frame':
				// Ignore.
				break;
			case 'error':
				errors.push([event]);
				break;
			case 'error-continue':
				if (errors.length > 0) {
					errors[errors.length - 1].push(event);
				} else {
					errors.push([event]);
				}
				break;
			default:
				if (output.length > 0 && output[output.length - 1][0].Location === event.Location) {
					output[output.length - 1].push(event);
				} else {
					output.push([event]);
				}
				break;
		}
	}

	return [...output, ...errors];
}

/**
 * Returns build/test error messages associated with source locations.
 * Location info is inferred heuristically by applying a simple pattern matching
 * over the output strings from `go test -json` `output` type action events.
 */
function parseTestFailure(events: RichOutputEvent[]) {
	const output = events.map((x) => x.Output).join('');
	let message = parsePanic(events[0].TestItem, output) ?? parseWantGot(output);
	if (!message) {
		switch (events[0].OutputType) {
			case 'error':
			case 'error-continue':
				message = new TestMessage(output);
				break;
			default:
				return [];
		}
	}

	if (message.location) {
		return [message];
	}

	for (const event of events) {
		if (event.TestItem.range) {
			message.location = new Location(event.TestItem.uri!, event.TestItem.range.start);
			break;
		}
	}
	for (const event of events) {
		if (event.Location) {
			message.location = event.Location;
			break;
		}
	}

	return [message];
}

function parsePanic(test: TestItem, output: string) {
	// Find the `panic:` line.
	const start = output.match(/^panic: /m);
	if (!start) return;

	// Scan to the last `goroutine 1 [running]:` line.
	const reGoroutine = /^goroutine \d+ \[[^\]]+\]:$/gm;
	reGoroutine.lastIndex = start.index! + start[0].length;
	let last: number | undefined;
	while (reGoroutine.exec(output)) {
		last = reGoroutine.lastIndex;
	}
	if (last === undefined) return;

	// Scan to the end of the stack trace.
	const reFileLine = /^\t(?<file>\S+\.go):(?<line>\d+)( \+0x[0-9a-f]+)?( \w+=0x[0-9a-f]+)*$/gm;
	reFileLine.lastIndex = last;
	last = undefined;
	while (reFileLine.exec(output)) {
		last = reFileLine.lastIndex;
	}
	if (last === undefined) return;

	// Find the first goroutine.
	reGoroutine.lastIndex = 0;
	reGoroutine.exec(output);
	const stackStart = reGoroutine.lastIndex;
	const stackEnd = reGoroutine.exec(output)?.index ?? last;
	const stackStr = output.slice(stackStart, stackEnd);

	// Parse the stack trace.
	reFileLine.lastIndex = 0;
	let m: RegExpMatchArray | null;
	const stack: Location[] = [];
	while ((m = reFileLine.exec(stackStr))) {
		if (!m?.groups?.file) return;
		stack.push(parseLocation(test, m));
	}

	// Find the workspace/module directory.
	while (test.parent) {
		test = test.parent;
	}

	let dir = test.uri!.fsPath;
	if (path.extname(dir) !== '') {
		dir = path.join(dir, '..');
	}

	// Use the first location within the workspace/module, or just the first.
	const message = new TestMessage(output.slice(start.index!, last));
	message.location = stack.find((x) => x.uri.fsPath.startsWith(dir)) ?? stack[0];
	return message;
}

function parseWantGot(output: string) {
	const re = /\b(?<verb>got|have|actual|want|expected|received|desired)\s*:/gi;
	const first = re.exec(output);
	const second = re.exec(output);
	if (!first?.groups?.verb || !second?.groups?.verb) return;

	const firstKind = wantGotVerbKind(first.groups.verb);
	const secondKind = wantGotVerbKind(second.groups.verb);
	if (firstKind === 0 || secondKind === 0 || firstKind === secondKind) return;

	const prefix = output.slice(0, first.index).trim();
	const firstContent = output
		.slice(first.index + first[0].length, second.index)
		.trim()
		.replace(/;$/, '');
	const secondContent = output.slice(second.index + second[0].length).trim();

	return TestMessage.diff(
		prefix || 'Unexpected output',
		firstKind > 0 ? firstContent : secondContent,
		firstKind < 0 ? firstContent : secondContent,
	);
}

function wantGotVerbKind(s: string) {
	switch (s) {
		case 'got':
		case 'have':
		case 'received':
		case 'actual':
			return -1;
		case 'expected':
		case 'want':
		case 'desired':
			return +1;
		default:
			return 0;
	}
}
