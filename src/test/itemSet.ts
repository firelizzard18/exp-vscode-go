/**
 * Represents an update to a test item.
 *  - `added` indicates that the item was added.
 *  - `removed` indicates that the item was removed.
 *  - `moved` indicates that the item's range changed without changing its contents.
 *  - `modified` indicates that the item's contents and possibly its range changed.
 */
export type ItemEvent<T> = { item: T; type: 'added' | 'removed' | 'moved' | 'modified' };

export class ItemSet<T extends NonNullable<{ key: string }>, S extends NonNullable<object>> {
	readonly #srcKey;
	readonly #items;

	constructor(srcKey: (s: S) => string, items: T[] = []) {
		this.#srcKey = srcKey;
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

	has(item: string | T | S) {
		return this.#items.has(this.#key(item));
	}

	get(item: string | T | S) {
		return this.#items.get(this.#key(item));
	}

	remove(item: string | T | S) {
		this.#items.delete(this.#key(item));
	}

	#key(item: string | T | S) {
		if (typeof item !== 'object') {
			return item;
		}
		if ('key' in item) {
			return item.key;
		}
		return this.#srcKey(item);
	}

	add(...items: T[]) {
		for (const item of items) {
			if (this.has(item)) continue;
			this.#items.set(item.key, item);
		}
	}

	/**
	 * Replaces the set of items with a new set. If the existing set has items
	 * with the same key, the original items are preserved.
	 */
	replace(items: T[]) {
		// Insert new items
		this.add(...items);

		// Delete items that are no longer present
		const keep = new Set(items.map((x) => x.key));
		for (const key of this.keys()) {
			if (!keep.has(key)) {
				this.remove(key);
			}
		}
	}

	/**
	 * Replaces the set of items with a new set. For each value in source, if an
	 * item with the same key exists in the set, the item is updated. Otherwise,
	 * a new item is created.
	 * @param src The sources to create items from.
	 * @param id A function that returns the item key of a source value.
	 * @param make A function that creates a new item from a source value.
	 * @param update A function that updates an existing item with a source value.
	 */
	update<SS extends S, R>(
		src: readonly SS[],
		make: (_: SS) => T,
		update: (_1: SS, _2: T) => Iterable<ItemEvent<R>> = () => [],
		keep: (_: T) => boolean = () => false,
	): ItemEvent<T | R>[] {
		// Delete items that are no longer present
		const changed: ItemEvent<T | R>[] = [];
		const srcKeys = new Set(src.map((x) => this.#srcKey(x)));
		for (const [key, item] of this.#items.entries()) {
			if (!srcKeys.has(key) && !keep(item)) {
				changed.push({ item, type: 'removed' });
				this.remove(key);
			}
		}

		// Update and insert items
		for (const value of src) {
			const key = this.#srcKey(value);
			let item = this.get(key);
			if (!item) {
				item = make(value);
				this.add(item);
				changed.push({ item, type: 'added' });
			}

			changed.push(...update(value, item));
		}
		return changed;
	}
}
