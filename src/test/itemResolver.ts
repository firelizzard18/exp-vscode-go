import type {
	Disposable,
	Event,
	MarkdownString,
	ProviderResult,
	Range,
	TestItem,
	TestItemCollection,
	TestTag,
	Uri
} from 'vscode';
import { TestController } from './testing';

const debugResolve = false;

/**
 * Translates between VSCode's test resolver interface and a more typical tree
 * data style provider. This is intentionally implemented in a way that is
 * non-specific.
 */
export class TestItemResolver<T> implements Disposable {
	readonly #ctrl: TestController;
	readonly #provider: TestItemProvider<T>;
	readonly #items = new Map<string, T>();
	readonly #disposable: Disposable[] = [];

	constructor(ctrl: TestController, provider: TestItemProvider<T>) {
		this.#ctrl = ctrl;
		this.#provider = provider;

		this.#disposable.push(
			provider.onDidChangeTestItem(async (e) => {
				if (!e) await this.#didChangeTestItem();
				else if (e instanceof Array) await this.#didChangeTestItem(e);
				else await this.#didChangeTestItem([e]);
			})
		);

		this.#disposable.push(
			provider.onDidInvalidateTestResults(async (e) => {
				if (!e) await this.#didInvalidateTestResults();
				else if (e instanceof Array) await this.#didInvalidateTestResults(e);
				else await this.#didInvalidateTestResults([e]);
			})
		);
	}

	dispose() {
		this.#disposable.forEach((x) => x.dispose());
	}

	getProviderItem(id: string) {
		return this.#items.get(id);
	}

	get roots() {
		const { items } = this.#ctrl;
		function* it() {
			for (const [, item] of items) {
				yield item;
			}
		}
		return it();
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

			await childItems.replace(
				await Promise.all(
					providerChildren.map(async (providerChild) => {
						return this.#getOrCreate(providerChild, childItems);
					})
				)
			);
		} finally {
			if (item) item.busy = false;

			debugTree(this.#ctrl.items, item ? `Resolving ${item.id}` : 'Resolving (root)');
		}
	}

	async #didChangeTestItem(providerItems?: T[]) {
		if (!providerItems) {
			// Force a refresh by dumping all the roots and resolving
			this.#ctrl.items.replace([]);
			return this.resolve();
		}

		// Create a TestItem for each T, including its ancestors
		const items = await Promise.all(providerItems.map((x) => this.getOrCreateAll(x)));

		// Refresh
		await Promise.all(items.map((x) => this.resolve(x)));
	}

	async #didInvalidateTestResults(providerItems?: T[]) {
		safeInvalidate(
			this.#ctrl,
			providerItems && (await Promise.all(providerItems.map((x) => this.getOrCreateAll(x))))
		);
	}

	async get(providerItem: T): Promise<TestItem | undefined> {
		const { id } = await this.#provider.getTestItem(providerItem);
		const parent = await this.#provider.getParent(providerItem);
		if (!parent) {
			return this.#ctrl.items.get(id);
		}
		return (await this.get(parent))?.children.get(id);
	}

	async getOrCreateAll(providerItem: T): Promise<TestItem> {
		const parent = await this.#provider.getParent(providerItem);
		const children = !parent ? this.#ctrl.items : (await this.getOrCreateAll(parent)).children;
		return await this.#getOrCreate(providerItem, children, true);
	}

	async #getOrCreate(providerItem: T, children: TestItemCollection, add = false): Promise<TestItem> {
		const data = await this.#provider.getTestItem(providerItem);
		this.#items.set(data.id, providerItem);

		const existing = children.get(data.id);
		const item = existing || this.#ctrl.createTestItem(data.id, data.label, data.uri);
		item.description = data.description;
		item.sortText = data.sortText;
		item.tags = data.tags || [];
		item.canResolveChildren = data.hasChildren;
		item.range = data.range;
		item.error = data.error;

		if (add) {
			await children.add(item);
		}

		if (data.preloadChildren) {
			await this.resolve(item);
		}

		return item;
	}
}

export function safeInvalidate(ctrl: TestController, item: TestItem | TestItem[] | undefined) {
	// invalidateTestResults is not present in vscode 1.75, hence the check
	if (ctrl && 'invalidateTestResults' in ctrl && typeof ctrl.invalidateTestResults === 'function') {
		ctrl.invalidateTestResults(item);
	}
}

export interface TestItemProvider<T> {
	onDidChangeTestItem: Event<T | T[] | null | undefined | void>;
	onDidInvalidateTestResults: Event<T | T[] | null | undefined | void>;
	getTestItem(element: T): TestItemData | Thenable<TestItemData>;
	getParent(element: T): ProviderResult<T>;
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
	preloadChildren: boolean;
	range?: Range;
	error?: string | MarkdownString;
}

function debugTree(root: TestItemCollection, label: string) {
	if (!debugResolve) return;
	const s = [label];
	const add = (item: TestItem, indent: string) => {
		if (indent === '  ' && item.children.size > 2) {
			console.error('wtf');
		}
		s.push(`${indent}${item.label}`);
		for (const [, child] of item.children) {
			add(child, indent + '  ');
		}
	};
	for (const [, item] of root) {
		add(item, '  ');
	}
	console.log(s.join('\n'));
}
