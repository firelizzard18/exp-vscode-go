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
						return this.#getOrCreate(providerChild, false, childItems);
					})
				)
			);
		} finally {
			if (item) item.busy = false;
		}
	}

	#didChangeTestItem(items?: T[]) {
		if (!items) {
			return this.resolve();
		}

		return Promise.all(items.map((x) => this.#getOrCreate(x)));
	}

	async #getOrCreate(providerItem: T, add = true, children?: TestItemCollection): Promise<TestItem> {
		if (!children) {
			if (!providerItem.parent) {
				children = this.#ctrl.items;
			} else {
				const parent = await this.#getOrCreate(providerItem.parent);
				children = parent.children;
			}
		}

		const data = await this.#provider.getTestItem(providerItem);
		this.#items.set(data.id, providerItem);

		const item = children.get(data.id) || this.#ctrl.createTestItem(data.id, data.label, data.uri);
		item.description = data.description;
		item.sortText = data.sortText;
		item.tags = data.tags || [];
		item.canResolveChildren = data.hasChildren || false;
		item.range = data.range;
		item.error = data.error;
		if (add) children.add(item);
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
