import { Uri } from 'vscode';
import { TestItemData, TestItemProvider } from './itemResolver';
import { Context } from './testing';
import { TestConfig } from './config';
import { Commander } from './commander';
import { GoTestItem, Package, TestCase } from './item';
import { EventEmitter } from '../utils/eventEmitter';

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
			range: element.range,
			error: element.error
		};
	}

	getParent(element: GoTestItem) {
		return element.getParent();
	}

	async getChildren(element?: GoTestItem | undefined) {
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

	async reload(uri?: Uri, invalidate = false) {
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

		// With one URI and no recursion there *should* only be one result, but
		// process in a loop regardless
		const items: GoTestItem[] = [];
		const findOpts = { tryReload: true };
		for (const pkg of packages) {
			// This shouldn't happen, but just in case
			if (!pkg.TestFiles?.length) continue;

			// Find the module or workspace that owns this package
			const parent = await this.#commander.getRootFor(pkg, findOpts);
			if (!parent) continue; // TODO: Handle tests from external packages?

			// Mark the package as requested
			this.#requested.add(parent.uri.toString());
			parent.markRequested(pkg);

			// Update the data model
			items.push(parent);
		}

		await this.#didChangeTestItem.fire(items);
		if (invalidate) {
			await this.#didInvalidateTestResults.fire(items);
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

		// Find the parent test case
		let parent: TestCase;
		const separators: number[] = [];
		outer: for (let n = name; ; ) {
			const i = n.lastIndexOf('/');
			if (i < 0) return;
			n = n.substring(0, i);
			separators.push(i);

			for (const file of pkg.files) {
				for (const test of file.tests) {
					if (test.name === n) {
						parent = test;
						break outer;
					}
				}
			}
		}
		if (!parent) return;

		// Depending on configuration there are many different cases for which
		// items should be refreshed. Instead of handling all that, just refresh
		// everything that could be affected.
		const updates: GoTestItem[] = [parent.file.package, parent.file, parent];

		for (const i of separators.slice(1).reverse()) {
			parent = parent.newChild(name.substring(0, i));
			updates.push(parent);
		}
		const test = parent.newChild(name);
		updates.push(test);

		await this.#didChangeTestItem.fire(updates);
		return test;
	}
}
