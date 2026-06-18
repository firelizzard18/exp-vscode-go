import { Location, TestItem, TestRun } from 'vscode';
import { Package, TestCase } from './model';
import { TestEvent } from './testEvent';

export class PackageTestRun {
	readonly run: TestRun;
	readonly mode: 'all' | 'specific';
	readonly goItem: Package;
	readonly testItem: TestItem;
	readonly tests: Map<TestCase, TestItem>;
	readonly exclude: Map<TestCase, TestItem>;

	constructor(args: Pick<PackageTestRun, 'run' | 'mode' | 'goItem' | 'testItem' | 'tests' | 'exclude'>) {
		this.run = args.run;
		this.mode = args.mode;
		this.goItem = args.goItem;
		this.testItem = args.testItem;
		this.tests = args.tests;
		this.exclude = args.exclude;
	}

	forEach(fn: (item: TestItem) => void) {
		const recurse = (item: TestItem) => {
			fn(item);
			for (const [, child] of item.children) {
				recurse(child);
			}
		};

		fn(this.testItem);
		for (const [goItem, item] of this.tests) {
			if (!this.exclude.has(goItem)) {
				recurse(item);
			}
		}
	}
}
