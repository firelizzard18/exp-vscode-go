import path from 'node:path';
import { Location, Position, type TestItem, Uri } from 'vscode';

/**
 * go test -json output format.
 * which is a subset of https://golang.org/cmd/test2json/#hdr-Output_Format
 * and includes only the fields that we are using.
 */
export interface TestEvent {
	Action: string;
	Output?: string;
	OutputType?: string;
	Package?: string;
	Test?: string;
	Elapsed?: number;
	FailedBuild?: string;
}

export interface RichTestEvent extends TestEvent {
	Location?: Location;
	TestItem: TestItem;
}

export interface RichOutputEvent extends RichTestEvent {
	Output: string;
}

export function isOutputEvent(event: RichTestEvent): event is RichOutputEvent {
	return !!event.Output;
}

/**
 * ^(?:.*\s+|\s*)                  - non-greedy match of any chars followed by a space or, a space.
 * (?<file>\S+\.go):(?<line>\d+):  - gofile:line: followed by a space.
 * (?<message>.\n)$                - all remaining message up to $.
 */
const reLineLocation = /^(.*\s+)?(?<file>\S+\.go):(?<line>\d+)(?::(?<column>\d+))?: (?<message>.*\n?)$/;

export function normalizeTestEvent(test: TestItem, event: TestEvent): RichTestEvent {
	/**
	 * Extract the location info from output message. This is not trivial since
	 * both the test output and any output/print from the tested program are
	 * reported as `output` type test events and not distinguishable.
	 * stdout/stderr output from the tested program makes this more trickier.
	 *
	 * Here we assume that test output messages are line-oriented, precede with
	 * a file name and line number, and end with new lines.
	 */
	let location: Location | undefined;
	const parsed = event.Output?.match(reLineLocation);
	if (parsed?.groups?.file) {
		location = parseLocation(test, parsed);
		event.Output = parsed.groups.message;
	}

	// go test is not good about reporting the start and end of benchmarks
	// so we'll synthesize them.
	if (event.Test?.startsWith('Benchmark')) {
		if (event.Output === `=== RUN   ${event.Test}\n`) {
			// === RUN   BenchmarkFooBar
			event.Action = 'run';
		} else if (
			event.Output?.match(/^(?<name>Benchmark[/\w]+)-(?<procs>\d+)\s+(?<result>.*)(?:$|\n)/)?.[1] === event.Test
		) {
			// BenchmarkFooBar-4    123456    123.4 ns/op    123 B/op    12 allocs/op
			event.Action = 'pass';
		}
	}

	return { ...event, Location: location, TestItem: test };
}

export function parseLocation(test: TestItem, parsed: RegExpMatchArray) {
	if (!parsed?.groups?.file) {
		throw new Error('Internal error: expected file group in regex match');
	}

	// Paths will always be absolute for versions of Go (1.21+) due to
	// -fullpath, but the user may be using an old version, and build errors
	// still give relative paths.
	let dir = test.uri!.fsPath;
	if (path.extname(dir) !== '') {
		dir = path.join(dir, '..');
	}

	const file =
		parsed.groups.file && path.isAbsolute(parsed.groups.file)
			? Uri.file(parsed.groups.file)
			: Uri.file(path.join(dir, parsed.groups.file));

	// VSCode uses 0-based line numbering (internally)
	const ln = Number(parsed.groups.line) - 1;
	const col = parsed.groups.column ? Number(parsed.groups.column) - 1 : 0;
	return new Location(file, new Position(ln, col));
}
