import {
	Disposable,
	Event,
	MarkdownString,
	ProviderResult,
	Range,
	TestController,
	TestItem,
	TestItemCollection,
	TestTag,
	Uri
} from 'vscode';

/**
 * Translates between VSCode's test resolver interface and a more typical tree
 * data style provider.
 */
export class TestItemResolver<T extends { parent?: T }> implements Disposable {
	readonly #ctrl: TestController;
	readonly #provider: TestItemProvider<T>;
	readonly #items = new Map<string, T>();
	readonly #disposable: Disposable[] = [];

	constructor(ctrl: TestController, provider: TestItemProvider<T>) {
		this.#ctrl = ctrl;
		this.#provider = provider;

		this.#disposable.push(
			provider.onDidChangeTestItem((e) => {
				if (!e) this.#didChangeTestItem();
				else if (e instanceof Array) this.#didChangeTestItem(e);
				else this.#didChangeTestItem([e]);
			})
		);
	}

	dispose() {
		this.#disposable.forEach((x) => x.dispose());
	}

	async resolve(item?: TestItem) {
		if (item) item.busy = true;

		try {
			const providerItem = item && this.#items.get(item.id);
			if (item && !providerItem) {
				// Unknown test item
				return;
			}

			const childItems = item ? item.children : this.#ctrl.items;
			const providerChildren = await this.#provider.getChildren(providerItem);
			if (!providerChildren) {
				return;
			}

			childItems.replace(
				await Promise.all(
					providerChildren.map(async (providerChild) => {
						return this.#getOrCreate(providerChild, childItems);
					})
				)
			);
		} finally {
			if (item) item.busy = false;
		}
	}

	async #didChangeTestItem(providerItems?: T[]) {
		if (!providerItems) {
			// Force a refresh by dumping all the roots and resolving
			this.#ctrl.items.replace([]);
			return this.resolve();
		}

		// Create a TestItem for each T, including its ancestors
		const items = await Promise.all(providerItems.map((x) => this.#getOrCreateAll(x)));

		// For each parent (using a Set to avoid duplicate work), force a
		// refresh by dumping its children and resolving
		return Promise.all(
			[...new Set(items.map((x) => x.parent))].map(async (x) => {
				(x?.children || this.#ctrl.items).replace([]);
				return this.resolve(x);
			})
		);
	}

	async #getOrCreateAll(providerItem: T): Promise<TestItem> {
		const { parent } = providerItem;
		const children = !parent ? this.#ctrl.items : (await this.#getOrCreateAll(parent)).children;
		const item = await this.#getOrCreate(providerItem, children);
		children.add(item);
		return item;
	}

	async #getOrCreate(providerItem: T, children: TestItemCollection): Promise<TestItem> {
		const data = await this.#provider.getTestItem(providerItem);
		this.#items.set(data.id, providerItem);

		const item = children.get(data.id) || this.#ctrl.createTestItem(data.id, data.label, data.uri);
		item.description = data.description;
		item.sortText = data.sortText;
		item.tags = data.tags || [];
		item.canResolveChildren = data.hasChildren || false;
		item.range = data.range;
		item.error = data.error;
		return item;
	}
}

export interface TestItemProvider<T> {
	onDidChangeTestItem: Event<T | T[] | null | undefined | void>;
	getTestItem(element: T): TestItemData | Thenable<TestItemData>;
	getChildren(element?: T): ProviderResult<T[]>;
}

export interface TestItemData {
	id: string;
	label: string;
	uri?: Uri;
	description?: string;
	sortText?: string;
	tags?: readonly TestTag[];
	hasChildren: boolean;
	range?: Range;
	error?: string | MarkdownString;
}
