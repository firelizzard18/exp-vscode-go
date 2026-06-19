import { Commands } from '@/utils/common';
import { Uri } from 'vscode';
import type { Package, TestCase } from '.';
import { ItemSet } from './set';

export class TestFile {
	readonly kind = 'file';
	readonly package;
	readonly uri;
	readonly tests = new ItemSet<TestCase, Commands.TestCase>((x) => x.Name);

	constructor(pkg: Package, file: Commands.TestFile) {
		this.package = pkg;
		this.uri = Uri.parse(file.URI);
	}

	get key() {
		return `${this.uri}`;
	}
}
