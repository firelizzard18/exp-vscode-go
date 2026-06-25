/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
export { Uri } from './uri';
import type * as vscode from 'vscode';

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64,
}

export enum TestRunProfileKind {
	Run = 1,
	Debug = 2,
	Coverage = 3,
}

export class Range {
	readonly start: Position;
	readonly end: Position;

	constructor(...args: [Position, Position] | [number, number, number, number]) {
		if (args.length === 2) {
			this.start = args[0];
			this.end = args[1];
		} else {
			const [sl, sc, el, ec] = args;
			this.start = new Position(sl, sc);
			this.end = new Position(el, ec);
		}
	}

	get isEmpty() {
		return this.start.line === this.end.line && this.start.character === this.end.character;
	}

	get isSingleLine() {
		return this.start.line === this.end.line;
	}

	contains(positionOrRange: Position | Range): boolean {
		if (positionOrRange instanceof Position) {
			return this.start.isBeforeOrEqual(positionOrRange) && this.end.isAfterOrEqual(positionOrRange);
		}
		return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
	}

	isEqual(other: Range) {
		return this.start.isEqual(other.start) && this.end.isEqual(other.end);
	}

	// intersection(range: Range): Range | undefined;
	// union(other: Range): Range;
	// with(start?: Position, end?: Position): Range;
	// with(change: { start?: Position; end?: Position }): Range;
}

export class Position {
	readonly line: number;
	readonly character: number;

	constructor(line: number, character: number) {
		this.line = line;
		this.character = character;
	}

	compareTo(other: Position): number {
		return this.line !== other.line ? this.line - other.line : this.character - other.character;
	}

	isBefore(other: Position): boolean {
		return this.compareTo(other) < 0;
	}

	isBeforeOrEqual(other: Position): boolean {
		return this.compareTo(other) <= 0;
	}

	isAfter(other: Position): boolean {
		return this.compareTo(other) > 0;
	}

	isAfterOrEqual(other: Position): boolean {
		return this.compareTo(other) >= 0;
	}

	isEqual(other: Position): boolean {
		return this.compareTo(other) === 0;
	}

	// translate(lineDelta?: number, characterDelta?: number): Position;
	// translate(change: { lineDelta?: number; characterDelta?: number }): Position;
	// with(line?: number, character?: number): Position;
	// with(change: { line?: number; character?: number }): Position;
}

/**
 * EventEmitter is a clone of VSCode's event emitter, with one key change: the
 * promise returned by fire does not resolve until all listeners have finished
 * executing.
 *
 * This is probably unnecessary since the 0.2 async purge.
 */
export class EventEmitter<T> implements vscode.EventEmitter<T> {
	readonly #listeners = new Set<(_: T) => void | Promise<void>>();

	readonly dispose = () => {};

	readonly event = (
		listener: (_: T) => void | Promise<void>,
		thisArgs: any = {},
		disposables?: vscode.Disposable[],
	): vscode.Disposable => {
		const l = (...args: Parameters<(_: T) => void | Promise<void>>) => listener.call(thisArgs, ...args);
		const d = { dispose: () => this.#listeners.delete(<(_: T) => void | Promise<void>>l) };
		this.#listeners.add(<(_: T) => void | Promise<void>>l);
		disposables?.push(d);
		return d;
	};

	readonly fire = (...args: Parameters<(_: T) => void | Promise<void>>): Promise<void> => {
		const promises = [];
		for (const l of this.#listeners) {
			const r = l.call(null, ...args);
			if (r && typeof r === 'object' && 'then' in r) {
				promises.push(r);
			}
		}

		// Return a promise to allow tests to await the result
		return Promise.all(promises).then(() => {});
	};
}

export class CodeLens {
	range: Range;
	command?: vscode.Command;
	readonly isResolved = false;

	constructor(range: Range, command?: vscode.Command) {
		this.range = range;
		this.command = command;
	}
}

export class Location {
	uri: vscode.Uri;
	range: Range;

	constructor(uri: vscode.Uri, rangeOrPosition: Range | Position) {
		this.uri = uri;
		this.range =
			rangeOrPosition instanceof Range
				? rangeOrPosition
				: new Range(rangeOrPosition, rangeOrPosition);
	}
}

export class TestMessage {
	message: string;
	location?: Location;
	expectedOutput?: string;
	actualOutput?: string;

	constructor(message: string) {
		this.message = message;
	}

	static diff(label: string, expected: string, actual: string): TestMessage {
		const msg = new TestMessage(label);
		msg.expectedOutput = expected;
		msg.actualOutput = actual;
		return msg;
	}
}

export class CancellationTokenSource {
	readonly token = {
		isCancellationRequested: false,
		onCancellationRequested: (_listener: () => void) => ({ dispose: () => {} }),
	};

	cancel() {
		this.token.isCancellationRequested = true;
	}

	dispose() {}
}

export class TestRunRequest {
	include: vscode.TestItem[] | undefined;
	exclude: vscode.TestItem[] | undefined;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	profile: any;
	continuous?: boolean;

	constructor(
		include?: vscode.TestItem[],
		exclude?: vscode.TestItem[],
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		profile?: any,
		continuous?: boolean,
	) {
		this.include = include;
		this.exclude = exclude;
		this.profile = profile;
		this.continuous = continuous;
	}
}

export class FileCoverage {
	uri: vscode.Uri;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	constructor(uri: vscode.Uri, public statementCoverage?: any) {
		this.uri = uri;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	static fromDetails(uri: vscode.Uri, _details: any[]): FileCoverage {
		return new FileCoverage(uri);
	}
}
