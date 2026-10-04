import { Uri } from 'vscode';

import { type Commands } from '@/utils/common';

import type { Package, TestCase } from '.';
import { ItemSet } from './set';

export class TestFile {
	readonly kind = 'file';
	readonly package;
	readonly uri;
	readonly tests = new ItemSet<TestCase>();

	constructor(pkg: Package, file: Commands.TestFile) {
		this.package = pkg;
		this.uri = Uri.parse(file.URI);
	}

	/** Yields every test in the file, including nested subtests, depth first. */
	*allTests(): Iterable<TestCase> {
		for (const test of this.tests) {
			yield test;
			yield* test.allTests();
		}
	}

	static keyOf(x: Commands.TestFile) {
		return `${Uri.parse(x.URI)}`;
	}

	get key() {
		return `${this.uri}`;
	}
}
