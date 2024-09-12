/* eslint-disable @typescript-eslint/no-unused-vars */
import { Range, TestRun, Uri, type TestItem, type TestItemCollection } from 'vscode';
import { Context, debugViewTree, TestController } from './testing';
import { findParentTestCase, GoTestItem, Package, RootItem, RootSet, TestCase, TestFile } from './item';
import { TestConfig } from './config';
import { CapturedProfile, ProfileType } from './profile';
import { EventEmitter } from '../utils/eventEmitter';

/**
 * Adapts between VSCode's TestController.resolveHandler and TestItemProvider.
 *
 * TestItemProvider could directly implement resolveHandler, but then the
 * provider would need to handle two separate trees of items or it would need to
 * use {@link TestItem} instead of {@link GoTestItem}. Past experience shows
 * that leads to difficult to maintain structures and code. This adapter allows
 * the provider to be implemented in a way that is natural given the nature of
 * Go and gopls, with the adapter handling the translation to the VSCode API.
 *
 * Originally this adapter was agnostic of the provider item type and required a
 * generic TestItemProvider implementation similar to a TreeDataProvider.
 * However, maintaining that was impractical and lead to unnecessarily complex
 * (and hard to maintain) code.
 */
export class TestResolver {
	readonly #didChangeTestItem = new EventEmitter<(_?: Iterable<TestCase | TestFile | Package>) => void>();
	readonly onDidChangeTestItem = this.#didChangeTestItem.event;
	readonly #didInvalidateTestResults = new EventEmitter<(_?: Iterable<TestCase | TestFile>) => void>();
	readonly onDidInvalidateTestResults = this.#didInvalidateTestResults.event;

	readonly #context: Context;
	readonly #ctrl: TestController;
	readonly #items = new Map<string, GoTestItem>();
	readonly #goRoots: RootSet;

	constructor(context: Context, ctrl: TestController) {
		this.#context = context;
		this.#ctrl = ctrl;
		this.#goRoots = new RootSet(context);
	}

	getGoItem(id: string) {
		return this.#items.get(id);
	}

	get viewRoots() {
		const { items } = this.#ctrl;
		function* it() {
			for (const [, item] of items) {
				yield item;
			}
		}
		return it();
	}

	get goRoots() {
		return this.#goRoots.getChildren();
	}

	/**
	 * Get the {@link TestItem} for a {@link GoTestItem}.
	 */
	async get(goItem: GoTestItem): Promise<TestItem | undefined> {
		const id = this.#id(goItem);
		const parent = await goItem.getParent?.();
		if (!parent) {
			return this.#ctrl.items.get(id);
		}
		return (await this.get(parent))?.children.get(id);
	}

	/**
	 * Get or create the {@link TestItem} for a {@link GoTestItem}. The items
	 * ancestors will also be created if they do not exist.
	 */
	async getOrCreateAll(goItem: GoTestItem): Promise<TestItem> {
		const parent = await goItem.getParent?.();
		const children = !parent ? this.#ctrl.items : (await this.getOrCreateAll(parent)).children;
		return await this.#createOrUpdate(goItem, children, true);
	}

	/**
	 * Create or update a {@link TestItem} for a {@link GoTestItem}.
	 * @returns The {@link TestItem}.
	 */
	async #createOrUpdate(goItem: GoTestItem, children: TestItemCollection, add = false): Promise<TestItem> {
		const id = this.#id(goItem);
		this.#items.set(id, goItem);

		const tags = [];
		if (!(goItem instanceof CapturedProfile)) {
			tags.push({ id: 'canRun' });
			if (!(goItem instanceof RootItem)) {
				tags.push({ id: 'canDebug' });
			}
		}

		const existing = children.get(id);
		const item = existing || this.#ctrl.createTestItem(id, goItem.label, goItem.uri);
		item.canResolveChildren = goItem.hasChildren;
		item.range = goItem.range;
		item.error = goItem.error;
		item.tags = tags;

		if (add) {
			await children.add(item);
		}

		// Automatically resolve all children of a test case
		if (goItem instanceof TestCase) {
			await this.reloadViewItem(item);
		}

		return item;
	}

	#id(goItem: GoTestItem) {
		if (goItem instanceof CapturedProfile) {
			return GoTestItem.id(goItem.file, goItem.kind);
		}
		return GoTestItem.id(goItem.uri, goItem.kind, goItem.name);
	}

	/* ******************************************** */
	/* ***              Reloading               *** */
	/* ******************************************** */

	/**
	 * Reloads all view items.
	 */
	async reloadView() {
		const goRoots = await this.#goRoots.getChildren();
		await this.#ctrl.items.replace(
			await Promise.all(goRoots.map(async (x) => this.#createOrUpdate(x, this.#ctrl.items)))
		);

		debugViewTree(this.#ctrl.items, 'Resolving (root)');
	}

	/**
	 * Reloads a specific view item.
	 */
	async reloadViewItem(item: TestItem) {
		item.busy = true;

		try {
			const goItem = this.#items.get(item.id);
			if (!goItem) {
				// Unknown test item
				return;
			}

			const container = item ? item.children : this.#ctrl.items;
			const children = await (goItem ? goItem.getChildren() : this.#goRoots.getChildren());
			if (!children) {
				return;
			}

			await container.replace(await Promise.all(children.map(async (x) => this.#createOrUpdate(x, container))));
		} finally {
			item.busy = false;

			debugViewTree(this.#ctrl.items, item ? `Resolving ${item.id}` : 'Resolving (root)');
		}
	}

	/**
	 * Reloads a set of Go items.
	 */
	async reloadGoItem(item: TestCase | TestFile | Package | Iterable<TestCase | TestFile | Package>) {
		if (item instanceof TestCase || item instanceof TestFile || item instanceof Package) {
			await this.reloadGoItem([item]);
			return;
		}

		// Create a TestItem for each GoTestItem, including its ancestors, and refresh
		const items = await this.#resolveViewItems(item, true);
		await Promise.all(items.map((x) => this.reloadViewItem(x)));
		await this.#didChangeTestItem.fire(item);
	}

	/**
	 * Reloads the test items (view and Go) for the given file.
	 *
	 * @param uri The URI of the file to reload.
	 * @param invalidate Whether to invalidate test results.
	 */
	async reloadUri(uri: Uri, invalidate = false) {
		// TODO:
		//  - This should be moved into a different class; this class should
		//    focus on the model-view translation.
		//  - Can gopls emit an event when tests/etc change?

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
			new TestConfig(this.#context.workspace, uri),
			await this.#context.commands.packages({
				Files: [uri.toString()],
				Mode: 1
			})
		);

		// An alternative build system may allow a file to be part of multiple
		// packages, so process all results
		const findOpts = { tryReload: true };
		const updated = new Set<TestCase | TestFile>();
		for (const pkg of packages) {
			// This shouldn't happen, but just in case
			if (!pkg.TestFiles?.length) continue;

			// Find the module or workspace that owns this package
			const root = await this.#goRoots.getRootFor(pkg, findOpts);
			if (!root) continue; // TODO: Handle tests from external packages?

			// Mark the package as requested
			this.#goRoots.markRequested(root);
			root.markRequested(pkg);

			// Find the package
			const pkgItem = (await root.getPackages()).find((x) => x.path === pkg.Path);
			if (!pkgItem) continue; // This indicates a bug

			// Update the package. This must happen after finding the update
			// items since this update may change what items overlap the ranges.
			let any = false;
			for (const changed of pkgItem.update(pkg)) {
				updated.add(changed);
				any = true;
			}

			// If the update had no effect, mark the file as updated
			if (!any) {
				for (const file of pkgItem.files) {
					if (`${file.uri}` === `${uri}`) {
						updated.add(file);
						break;
					}
				}
			}
		}

		// Update the view
		const items = await this.#resolveViewItems(updated, true);
		await Promise.all(items.map((x) => this.reloadViewItem(x)));
		invalidate && this.#ctrl.invalidateTestResults?.(items);

		// Notify listeners
		await this.#didChangeTestItem.fire(updated);
		invalidate && (await this.#didInvalidateTestResults.fire(updated));
	}

	/**
	 * Filters out items that should not be displayed and finds the
	 * corresponding TestItem for each GoTestItem.
	 */
	async #resolveViewItems(goItems: Iterable<TestCase | TestFile | Package>, create = false) {
		// If showFiles is disabled we need to reload the parent of each file
		// instead of the file. If an item is a package and is the self-package
		// of a root, we need to reload the root instead of the package.
		const toReload = [];
		const config = new TestConfig(this.#context.workspace);
		for (const item of goItems) {
			if (item instanceof TestCase) {
				toReload.push(item);
				continue;
			}

			if (item instanceof Package ? item.isRootPkg : !config.for(item.uri).showFiles()) {
				toReload.push(item.getParent());
			} else {
				toReload.push(item);
			}
		}

		if (create) {
			return await Promise.all(toReload.map((x) => this.getOrCreateAll(x)));
		}

		const items = await Promise.all(toReload.map((x) => this.get(x)));
		return items.filter((x) => x) as TestItem[];
	}
}
