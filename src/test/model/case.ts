import { Commands } from '@/utils/common';
import deepEqual from 'deep-equal';
import { Range, Uri } from 'vscode';
import type { ItemEvent, TestFile } from '.';

export abstract class TestCase {
	readonly kind;
	readonly file;
	readonly uri;
	readonly name;
	abstract readonly range?: Range;

	constructor(file: TestFile, uri: Uri, kind: 'test' | 'benchmark' | 'fuzz' | 'example', name: string) {
		this.file = file;
		this.uri = uri;
		this.kind = kind;
		this.name = name;
	}

	get key() {
		return this.name;
	}
}

export class StaticTestCase extends TestCase {
	range?: Range;
	#src;

	constructor(file: TestFile, test: Commands.TestCase) {
		const kind = test.Name.match(/^(Test|Fuzz|Benchmark|Example)/)![1].toLowerCase();
		super(file, Uri.parse(test.Loc.uri), kind as TestCase['kind'], test.Name);
		this.#src = test;
		this.range = new Range(
			test.Loc.range.start.line,
			test.Loc.range.start.character,
			test.Loc.range.end.line,
			test.Loc.range.end.character,
		);
	}

	/**
	 * Updates the test case with data from gopls.
	 * @param src The data from gopls.
	 * @param ranges Modified file ranges.
	 * @returns Update events. See {@link ItemEvent}.
	 */
	update(src: Commands.TestCase, ranges?: Range[]): Iterable<ItemEvent<TestCase>> {
		const moved = !deepEqual(src, this.#src);
		const contains = ranges?.some((x) => this.contains(x));

		if (moved) {
			const { start, end } = src.Loc.range;
			this.#src = src;
			this.range = new Range(start.line, start.character, end.line, end.character);
		}

		// Return the appropriate event. Modified is a larger change than moved.
		return [{ item: this, type: contains ? 'modified' : 'moved' }];
	}

	/**
	 * Determines whether the test case contains a given range. The range must
	 * be strictly contained within the test's range. If the intersection
	 * includes regions outside of the test, or intersects the end or the
	 * beginning but has a size of zero, this will return false.
	 */
	contains(range: Range): boolean {
		// The range of the test must be defined
		if (!this.range) return false;

		// The test must contain the given range
		if (!this.range.contains(range)) return false;

		// The intersection must be strictly within the test range. If the
		// intersection is an empty range at the very start or end of the test's
		// range, reject it.
		const r = this.range.intersection(range)!;
		if (!r.isEmpty) return true;
		return !r.start.isEqual(this.range.start) && !r.end.isEqual(this.range.end);
	}
}

export class DynamicTestCase extends TestCase {
	readonly range: undefined;

	constructor(parent: TestCase, name: string) {
		super(parent.file, parent.uri, parent.kind, name);
	}
}
