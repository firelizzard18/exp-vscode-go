import deepEqual from 'deep-equal';
import { Range, Uri } from 'vscode';

import { type Commands } from '@/utils/common';

import type { ItemEvent, TestFile } from '.';
import { ItemSet } from './set';

/**
 * A test, benchmark, fuzz test, or example. Subtests are children of their
 * parent test, mirroring `go test`: `TestFoo/bar` is a child of `TestFoo`.
 */
export abstract class TestCase {
	readonly kind;
	readonly parent: TestFile | TestCase;
	readonly uri;
	readonly name;
	/** Subtests, keyed by their full name (e.g. `TestFoo/bar`). */
	readonly tests = new ItemSet<TestCase>();
	abstract readonly range?: Range;

	constructor(parent: TestFile | TestCase, uri: Uri, kind: 'test' | 'benchmark' | 'fuzz' | 'example', name: string) {
		this.parent = parent;
		this.uri = uri;
		this.kind = kind;
		this.name = name;
	}

	/** The file the test (or its top-level ancestor) is declared in. */
	get file(): TestFile {
		let p = this.parent;
		while (p.kind !== 'file') p = p.parent;
		return p;
	}

	/** Yields every descendant subtest, depth first. */
	*allTests(): Iterable<TestCase> {
		for (const test of this.tests) {
			yield test;
			yield* test.allTests();
		}
	}

	static keyOf(x: Commands.TestCase) {
		return x.Name;
	}

	get key() {
		return this.name;
	}
}

export class StaticTestCase extends TestCase {
	range?: Range;
	#src;

	constructor(parent: TestFile | TestCase, test: Commands.TestCase) {
		const kind = test.Name.match(/^(Test|Fuzz|Benchmark|Example)/)![1].toLowerCase();
		super(parent, Uri.parse(test.Loc.uri), kind as TestCase['kind'], test.Name);
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
		super(parent, parent.uri, parent.kind, name);
	}
}

/**
 * Finds a test by name within a set of tests and their descendants. Descends
 * by longest matching name prefix, so `TestFoo/a/b` is found under `TestFoo`
 * even if `TestFoo/a` does not exist.
 */
export function findTestByName(tests: ItemSet<TestCase>, name: string): TestCase | undefined {
	const exact = tests.get(name);
	if (exact) return exact;

	for (let i = name.lastIndexOf('/'); i > 0; i = name.lastIndexOf('/', i - 1)) {
		const ancestor = tests.get(name.substring(0, i));
		if (ancestor) return findTestByName(ancestor.tests, name);
	}
}

/**
 * Finds the nearest existing ancestor of a test name, e.g. `TestFoo/a/b` →
 * `TestFoo/a` if it exists, otherwise `TestFoo`.
 */
export function findParentTest(tests: ItemSet<TestCase>, name: string): TestCase | undefined {
	for (let i = name.lastIndexOf('/'); i > 0; i = name.lastIndexOf('/', i - 1)) {
		const parent = findTestByName(tests, name.substring(0, i));
		if (parent) return parent;
	}
}
