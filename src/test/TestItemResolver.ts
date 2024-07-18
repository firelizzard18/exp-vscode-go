import {
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
export class TestItemResolver<T> {
	readonly #ctrl: TestController;
	readonly #provider: TestItemProvider<T>;
	readonly #items = new Map<string, T>();

	constructor(ctrl: TestController, provider: TestItemProvider<T>) {
		this.#ctrl = ctrl;
		this.#provider = provider;
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
			const newChildren = await Promise.all(
				((await this.#provider.getChildren(providerItem)) || []).map(async (providerChild) => {
					const data = await this.#provider.getTestItem(providerChild);
					const childItem = this.#getOrCreate(childItems, data);
					this.#items.set(data.id, providerChild);

					childItem.description = data.description;
					childItem.sortText = data.sortText;
					childItem.tags = data.tags || [];
					childItem.canResolveChildren = data.hasChildren || false;
					childItem.range = data.range;
					childItem.error = data.error;
					return childItem;
				})
			);
			childItems.replace(newChildren);
		} finally {
			if (item) item.busy = false;
		}
	}

	#getOrCreate(children: TestItemCollection, data: TestItemData) {
		const existing = children.get(data.id);
		if (existing) {
			return existing;
		}

		return this.#ctrl.createTestItem(data.id, data.label, data.uri);
	}
}

export interface TestItemProvider<T> {
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
