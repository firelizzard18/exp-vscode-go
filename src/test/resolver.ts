/* eslint-disable @typescript-eslint/no-unused-vars */
import { Range, Uri, WorkspaceFolder, type TestItem, type TestItemCollection } from 'vscode';
import { Context, debugViewTree, TestController } from '../utils/testing';
import { GoTestItem, Package, RootItem, RootSet, TestCase, TestFile } from './item';
import { TestConfig } from './config';
import { CapturedProfile, ProfileContainer, ProfileSet } from './profile';
import { EventEmitter } from '../utils/eventEmitter';
import { timeit } from '../utils/util';

export type ResolveOptions = {
	/**
	 * If this is true and the {@link TestItem} corresponding to a
	 * {@link GoTestItem} has not been created yet, it will be created.
	 */
	create?: boolean;

	/**
	 * If this is true and a {@link GoTestItem} does not have a corresponding
	 * {@link TestItem} (e.g. a file when showFiles is false), the GoTestItem
	 * will resolve to its children instead of its parent.
	 */
	children?: boolean;
};

/**
 * Maps between Go items ({@link GoTestItem}) and view items ({@link TestItem})
 * and manages view updates.
 */
export class TestResolver {
	// NOTE: As much as is possible, this class should be restricted to
	// functions relating to the view. It should _not_ be responsible for
	// managing Go test items, and Go test items should not be responsible for
	// managing view information.

	readonly #didChangeTestItem = new EventEmitter<(_?: Iterable<TestCase | TestFile | Package | RootItem>) => void>();
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
	async #get(goItem: GoTestItem): Promise<TestItem | undefined> {
		const id = this.#id(goItem);
		const parent = await goItem.getParent?.();
		if (!parent) {
			return this.#ctrl.items.get(id);
		}
		return (await this.#get(parent))?.children.get(id);
	}

	/**
	 * Get or create the {@link TestItem} for a {@link GoTestItem}. The items
	 * ancestors will also be created if they do not exist.
	 */
	async #getOrCreateAll(goItem: GoTestItem): Promise<TestItem> {
		const parent = await goItem.getParent?.();
		const children = !parent ? this.#ctrl.items : (await this.#getOrCreateAll(parent)).children;
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
		if (goItem instanceof RootItem) {
			tags.push({ id: 'canRun' });
		} else if (goItem instanceof Package || goItem instanceof TestFile || goItem instanceof TestCase) {
			tags.push({ id: 'canRun' });
			tags.push({ id: 'canDebug' });
		}

		const existing = children.get(id);
		const item = existing || this.#ctrl.createTestItem(id, goItem.label, goItem.uri);
		item.canResolveChildren = goItem.hasChildren;
		item.range = goItem.range;
		item.error = goItem.error;
		item.tags = tags;

		if (add) {
			children.add(item);
		}

		// Automatically resolve files and tests since once we have the package
		// we already have all the data to create those. We may want to make
		// this configurable to account for large projects.
		if (!(goItem instanceof RootItem)) {
			await this.reloadViewItem(item);
		}

		return item;
	}

	#id(item: GoTestItem): string {
		if (item instanceof TestCase) {
			return `${item.uri}?${item.kind}#${item.name}`;
		}
		if (item instanceof ProfileContainer) {
			return JSON.stringify({ kind: item.kind, of: this.#id(item.parent) });
		} else if (item instanceof ProfileSet) {
			return JSON.stringify({ kind: item.kind, of: this.#id(item.parent.parent), at: item.time.getTime() });
		} else if (item instanceof CapturedProfile) {
			return JSON.stringify({
				profile: item.type.id,
				of: this.#id(item.parent.parent.parent),
				at: item.parent.time.getTime(),
			});
		}
		return `${item.uri}?${item.kind}`;
	}

	/* ******************************************** */
	/* ***              Reloading               *** */
	/* ******************************************** */

	/**
	 * Reloads all view items.
	 */
	async reloadView() {
		const goRoots = await this.#goRoots.getChildren();
		this.#ctrl.items.replace([]); // force reload
		this.#ctrl.items.replace(
			await Promise.all(goRoots.map(async (x) => this.#createOrUpdate(x, this.#ctrl.items))),
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

			container.replace(await Promise.all(children.map(async (x) => this.#createOrUpdate(x, container))));
		} finally {
			item.busy = false;

			debugViewTree(this.#ctrl.items, item ? `Resolving ${item.id}` : 'Resolving (root)');
		}
	}

	/**
	 * Reloads a set of Go items.
	 */
	async reloadGoItem(
		item: TestCase | TestFile | Package | RootItem | Iterable<TestCase | TestFile | Package | RootItem>,
	) {
		if (
			item instanceof TestCase ||
			item instanceof TestFile ||
			item instanceof Package ||
			item instanceof RootItem
		) {
			await this.reloadGoItem([item]);
			return;
		}

		// Create a TestItem for each GoTestItem, including its ancestors, and refresh
		const items = await this.resolveViewItems(item, { create: true });
		await Promise.all(items.map((x) => this.reloadViewItem(x)));
		await this.#didChangeTestItem.fire(item);
	}

	/**
	 * Reloads the test items (view and Go) for the given file.
	 *
	 * @param uri The URI of the file to reload.
	 * @param invalidate Whether to invalidate test results.
	 */
	async reloadUri(ws: WorkspaceFolder, uri: Uri, ranges: Range[] = [], invalidate = false) {
		const reload: (TestCase | TestFile | Package)[] = [];
		const invalidated: (TestCase | TestFile)[] = [];
		await timeit('didUpdate', async () => {
			for (const { item, type } of await this.#goRoots.didUpdate(ws, uri, { [`${uri}`]: ranges })) {
				if (type !== 'removed') {
					reload.push(item);
				}
				if (type === 'modified' && !(item instanceof Package)) {
					invalidated.push(item);
				}
			}
		});

		// Update the view
		const items = await timeit('resolveViewItems', () => this.resolveViewItems(reload, { create: true }));
		await timeit('reloadViewItem', () => Promise.all(items.map((x) => this.reloadViewItem(x))));
		invalidate && this.#ctrl.invalidateTestResults?.(items);

		// Notify listeners
		await this.#didChangeTestItem.fire(reload);
		invalidate && (await this.#didInvalidateTestResults.fire(invalidated));
	}

	/**
	 * Returns the corresponding {@link TestItem}(s) for one or more
	 * {@link GoTestItem}s. If a given `GoTestItem` does not have a
	 * corresponding `TestItem`, such as the root package of a module or a file
	 * when showFiles is not enabled, the item's parent's `TestItem` will be
	 * returned instead.
	 * @param goItems - The {@link GoTestItem} or items to resolve.
	 * @param create - Whether to create missing {@link TestItem}(s).
	 * @returns The corresponding {@link TestItem}(s).
	 */
	resolveViewItems(goItems: GoTestItem): Promise<TestItem | undefined>;
	resolveViewItems(goItems: GoTestItem, opts: ResolveOptions & { create: true }): Promise<TestItem>;
	resolveViewItems(goItems: GoTestItem, opts: ResolveOptions & { children: true }): Promise<TestItem[]>;
	resolveViewItems(goItems: GoTestItem, opts?: ResolveOptions): Promise<TestItem | undefined> | Promise<TestItem[]>;
	resolveViewItems(goItems: Iterable<GoTestItem>, opts?: ResolveOptions): Promise<TestItem[]>;
	resolveViewItems(
		goItems: GoTestItem | Iterable<GoTestItem>,
		opts: ResolveOptions = {},
	): Promise<TestItem | undefined> | Promise<TestItem[]> {
		if (!(Symbol.iterator in goItems)) {
			if (opts?.children) {
				return this.resolveViewItems([goItems], opts);
			}
			return (async () => {
				const [item] = await this.resolveViewItems([goItems], opts);
				return item;
			})();
		}

		const config = new TestConfig(this.#context.workspace);
		return (async () => {
			const items: Promise<TestItem | undefined>[] = [];
			for (const item of this.#resolveViewItems(goItems, opts, config)) {
				items.push(opts.create ? this.#getOrCreateAll(item) : this.#get(item));
			}
			return (await timeit('await get or create all', () => Promise.all(items))).filter((x) => !!x);
		})();
	}

	*#resolveViewItems(goItems: Iterable<GoTestItem>, opts: ResolveOptions, config: TestConfig): Generator<GoTestItem> {
		for (const item of goItems) {
			let hidden;

			// If the item is a file and showFiles is disabled, resolve the
			// parent instead of the file
			if (item instanceof TestFile && !config.for(item.uri).showFiles()) {
				hidden = item;
			}

			// If the item is a package and is the self-package of a root,
			// resolve the root instead of the package
			if (item instanceof Package && item.isRootPkg) {
				hidden = item;
			}

			if (!hidden) {
				yield item;
			} else if (opts.children) {
				yield* this.#resolveViewItems(hidden.getChildren(), opts, config);
			} else {
				yield* this.#resolveViewItems([hidden.getParent()], opts, config);
			}
		}
	}
}
