import { Uri } from 'vscode';
import { TestItemData, TestItemProvider } from './itemResolver';
import { Context } from './testing';
import { TestConfig } from './config';
import { Commander } from './commander';
import { findParentTestCase, GoTestItem, Package, TestCase } from './item';
import { EventEmitter } from '../utils/eventEmitter';
import { Range } from 'vscode';

export class GoTestItemProvider implements TestItemProvider<GoTestItem> {
	readonly #didChangeTestItem = new EventEmitter<GoTestItem[] | void>();
	readonly onDidChangeTestItem = this.#didChangeTestItem.event;
	readonly #didInvalidateTestResults = new EventEmitter<GoTestItem[] | void>();
	readonly onDidInvalidateTestResults = this.#didInvalidateTestResults.event;

	readonly #context: Context;
	readonly #config: TestConfig;
	readonly #commander: Commander;
	readonly #requested = new Set<string>();

	constructor(context: Context) {
		this.#context = context;
		this.#config = new TestConfig(context.workspace);
		this.#commander = new Commander(context);
	}

	getTestItem(element: GoTestItem): TestItemData | Thenable<TestItemData> {
		return {
			id: GoTestItem.id(element.uri, element.kind, element.name),
			label: element.label,
			uri: element.uri,
			hasChildren: element.hasChildren,
			preloadChildren: element instanceof TestCase,
			range: element.range,
			error: element.error
		};
	}

	getParent(element: GoTestItem) {
		return element.getParent();
	}

	async getChildren(element?: GoTestItem | undefined): Promise<GoTestItem[]> {
		if (element) {
			return element.getChildren();
		}

		return [...(await this.#commander.getRoots(true))].filter((x) => {
			// Return a given root if discovery is on or the root (or more
			// likely one of its children) has been explicitly requested
			const mode = this.#config.for(x.uri).discovery();
			return mode === 'on' || this.#requested.has(x.uri.toString());
		});
	}

	async reload(uri?: Uri, ranges: Range[] = [], invalidate = false) {
		if (!uri) {
			await this.#didChangeTestItem.fire();
			if (invalidate) {
				await this.#didInvalidateTestResults.fire();
			}
			return;
		}

		if (!uri.path.endsWith('.go')) {
			return;
		}

		// Load tests for the given URI
		const packages = Package.resolve(
			await this.#context.commands.packages({
				Files: [uri.toString()],
				Mode: 1
			})
		);

		const updated = [];

		// With one URI and no recursion there *should* only be one result, but
		// process in a loop regardless
		const findOpts = { tryReload: true };
		for (const pkg of packages) {
			// This shouldn't happen, but just in case
			if (!pkg.TestFiles?.length) continue;

			// Find the module or workspace that owns this package
			const root = await this.#commander.getRootFor(pkg, findOpts);
			if (!root) continue; // TODO: Handle tests from external packages?

			// Mark the package as requested
			this.#requested.add(root.uri.toString());
			root.markRequested(pkg);

			// Find the updated items
			updated.push(...(await root.find(uri, ranges)));
		}

		await this.#didChangeTestItem.fire(updated);
		if (invalidate) {
			await this.#didInvalidateTestResults.fire(updated);
		}
	}

	async resolveTestCase(pkg: Package, name: string) {
		// Check for an exact match
		for (const file of pkg.files) {
			for (const test of file.tests) {
				if (test.name === name) {
					return test;
				}
			}
		}

		// Find the parent test case and create a dynamic subtest
		const parent = findParentTestCase(pkg.allTests(), name);
		if (!parent) return;

		const test = parent.makeDynamicTestCase(name);
		await this.#didChangeTestItem.fire([test]);
		return test;
	}
}
