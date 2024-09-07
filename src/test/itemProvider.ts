import { Uri } from 'vscode';
import { TestItemData, TestItemProvider } from './itemResolver';
import { Context } from './testing';
import { TestConfig } from './config';
import { findParentTestCase, GoTestItem, Package, RootItem, RootSet, TestCase, TestFile } from './item';
import { EventEmitter } from '../utils/eventEmitter';
import { Range } from 'vscode';

export class GoTestItemProvider implements TestItemProvider<GoTestItem> {
	readonly #didChangeTestItem = new EventEmitter<GoTestItem[] | void>();
	readonly onDidChangeTestItem = this.#didChangeTestItem.event;
	readonly #didInvalidateTestResults = new EventEmitter<GoTestItem[] | void>();
	readonly onDidInvalidateTestResults = this.#didInvalidateTestResults.event;
	readonly #shouldRerunTests = new EventEmitter<(TestCase | TestFile)[]>();
	readonly onShouldRerunTests = this.#shouldRerunTests.event;

	readonly #context: Context;
	readonly #config: TestConfig;
	readonly #requested = new Set<string>();
	readonly #roots: RootSet;

	constructor(context: Context) {
		this.#context = context;
		this.#config = new TestConfig(context.workspace);
		this.#roots = new RootSet(context);
	}

	getTestItem(element: GoTestItem): TestItemData | Thenable<TestItemData> {
		return {
			id: GoTestItem.id(element.uri, element.kind, element.name),
			label: element.label,
			uri: element.uri,
			hasChildren: element.hasChildren,
			preloadChildren: element instanceof TestCase,
			range: element.range,
			error: element.error,
			tags: element instanceof RootItem ? [] : [{ id: 'canDebug' }]
		};
	}

	getParent(element: GoTestItem) {
		return element.getParent();
	}

	getChildren(): Promise<RootItem[]>;
	getChildren(element: GoTestItem): Promise<GoTestItem[]>;
	async getChildren(element?: GoTestItem | undefined): Promise<GoTestItem[]> {
		if (element) {
			return element.getChildren();
		}

		return [...(await this.#roots.getChildren(true))].filter((x) => {
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

		// Only support the file: URIs. It is necessary to exclude git: URIs
		// because gopls will not handle them. Excluding everything except file:
		// may not be strictly necessary, but vscode-go currently has no support
		// for remote workspaces so it is safe for now.
		if (uri.scheme !== 'file') {
			return;
		}

		// Ignore anything that's not a Go file
		if (!uri.path.endsWith('.go')) {
			return;
		}

		const ws = this.#context.workspace.getWorkspaceFolder(uri);
		if (!ws) {
			return;
		}

		const packages = Package.resolve(
			ws.uri,
			this.#config,
			await this.#context.commands.packages({
				Files: [uri.toString()],
				Mode: 1
			})
		);

		const updated = new Set<GoTestItem>();
		const toRun = new Set<TestCase | TestFile>();
		const mark = (pkg: Package) => {
			const file = [...pkg.files].find((x) => `${x.uri}` === `${uri}`);
			if (!file) return;

			const tests = file.find(ranges);
			if (tests.length) {
				tests.forEach((x) => (updated.add(x), toRun.add(x)));
				return;
			}

			toRun.add(file);
			if (this.#config.for(uri).showFiles()) {
				updated.add(file);
			} else {
				updated.add(file.getParent());
			}
		};

		// With one URI and no recursion there *should* only be one result, but
		// process in a loop regardless
		const findOpts = { tryReload: true };
		for (const pkg of packages) {
			// This shouldn't happen, but just in case
			if (!pkg.TestFiles?.length) continue;

			// Find the module or workspace that owns this package
			const root = await this.#roots.getRootFor(pkg, findOpts);
			if (!root) continue; // TODO: Handle tests from external packages?

			// Mark the package as requested
			this.#requested.add(root.uri.toString());
			root.markRequested(pkg);

			// Find the package
			const pkgItem = (await root.getPackages()).find((x) => x.path === pkg.Path);
			if (!pkgItem) continue; // This indicates a bug

			// Mark the updated items
			mark(pkgItem);

			// Update the package. This must happen after finding the update
			// items since this update may change what items overlap the ranges.
			pkgItem.update(pkg);
		}

		await this.#didChangeTestItem.fire([...updated]);
		await this.#shouldRerunTests.fire([...toRun]);
		if (invalidate) {
			await this.#didInvalidateTestResults.fire([...updated]);
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
		const parent = findParentTestCase(pkg.getTests(), name);
		if (!parent) return;

		const test = parent.makeDynamicTestCase(name);
		if (!test) return;
		await this.#didChangeTestItem.fire([test]);
		return test;
	}

	*roots() {
		yield* this.#roots;
	}
}
