import { Uri, ProviderResult } from 'vscode';
import { GoTestItem } from './item';

export abstract class BaseItem implements GoTestItem {
	abstract key: string;
	abstract uri: Uri;
	abstract kind: GoTestItem.Kind;
	abstract label: string;
	abstract hasChildren: boolean;
	abstract getParent(): ProviderResult<GoTestItem>;
	abstract getChildren(): BaseItem[] | Promise<BaseItem[]>;
}

export class RelationMap<Child, Parent> {
	readonly #childParent = new Map<Child, Parent>();
	readonly #parentChild = new Map<Parent, Child[]>();

	constructor(relations: Iterable<[Child, Parent]> = []) {
		for (const [child, parent] of relations) {
			this.add(parent, child);
		}
	}

	add(parent: Parent, child: Child) {
		this.#childParent.set(child, parent);
		const children = this.#parentChild.get(parent);
		if (children) {
			children.push(child);
		} else {
			this.#parentChild.set(parent, [child]);
		}
	}

	replace(relations: Iterable<[Child, Parent]>) {
		this.#childParent.clear();
		this.#parentChild.clear();
		for (const [child, parent] of relations) {
			this.add(parent, child);
		}
	}

	removeChildren(parent: Parent) {
		for (const child of this.#parentChild.get(parent) || []) {
			this.#childParent.delete(child);
		}
		this.#parentChild.delete(parent);
	}

	getParent(child: Child) {
		return this.#childParent.get(child);
	}

	getChildren(parent: Parent) {
		return this.#parentChild.get(parent);
	}
}

export class ItemSet<T extends BaseItem> {
	readonly #items: Map<string, T>;

	constructor(items: T[] = []) {
		this.#items = new Map(items.map((x) => [x.key, x]));
	}

	*keys() {
		yield* this.#items.keys();
	}

	*values() {
		yield* this.#items.values();
	}

	[Symbol.iterator]() {
		return this.#items.values();
	}

	get size() {
		return this.#items.size;
	}

	has(item: string | T) {
		return this.#items.has(typeof item === 'string' ? item : item.key);
	}

	get(item: string | T) {
		return this.#items.get(typeof item === 'string' ? item : item.key);
	}

	add(...items: T[]) {
		for (const item of items) {
			if (this.has(item)) continue;
			this.#items.set(item.key, item);
		}
	}

	remove(item: string | T) {
		this.#items.delete(typeof item === 'string' ? item : item.key);
	}

	replace(items: T[]) {
		// Insert new items
		this.add(...items);

		// Delete items that are no longer present
		const keep = new Set(items.map((x) => `${x.uri}`));
		for (const key of this.keys()) {
			if (!keep.has(key)) {
				this.remove(key);
			}
		}
	}

	replaceWith<S>(src: S[], id: (_: S) => string, make: (_: S) => T, update: (_1: S, _2: T) => void) {
		// Delete items that are no longer present
		const keep = new Set(src.map(id));
		for (const key of this.keys()) {
			if (!keep.has(key)) {
				this.remove(key);
			}
		}

		// Update and insert items
		for (const item of src) {
			const key = id(item);
			const existing = this.get(key);
			if (existing) {
				update(item, existing);
			} else {
				this.add(make(item));
			}
		}
	}
}
