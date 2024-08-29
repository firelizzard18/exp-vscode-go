/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
export { Uri } from './uri';
import type * as vscode from 'vscode';
import { EventEmitter as EEImpl } from './../utils/eventEmitter';

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64
}

export enum TestRunProfileKind {
	Run = 1,
	Debug = 2,
	Coverage = 3
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

export class EventEmitter<T> extends EEImpl<T> implements vscode.EventEmitter<T> {
	readonly dispose = () => {};
}
