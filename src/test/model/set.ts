import type { GoTestItem, ItemEvent } from '.';

export class ItemSet<T extends GoTestItem> {
	readonly #items;

	/**
	 * Tracks whether this set has been populated or not. This is a bit awkward
	 * because it's used as a sentinel/as a proxy for "have we asked gopls to
	 * populate this?" We do not set #loaded when add is called, because it does
	 * not indicate that we 'properly' populated this set.
	 */
	#loaded = false;

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

	get loaded() {
		return this.#loaded;
	}

	get size() {
		return this.#items.size;
	}

	has(item: string | T) {
		return this.#items.has(this.#key(item));
	}

	get(item: string | T) {
		return this.#items.get(this.#key(item));
	}

	remove(item: string | T) {
		this.#items.delete(this.#key(item));
	}

	#key(item: string | T): string {
		return typeof item === 'string' ? item : item.key;
	}

	add(...items: T[]) {
		for (const item of items) {
			if (this.has(item)) continue;
			this.#items.set(item.key, item);
		}
	}

	/**
	 * Replaces the set of items with a new set. For each value in source, if an
	 * item with the same key exists in the set, the item is updated. Otherwise,
	 * a new item is created.
	 * @param src The sources to create items from.
	 * @param make A function that creates a new item from a source value.
	 * @param update A function that updates an existing item with a source value.
	 */
	update<S, R = never>(
		src: readonly S[],
		make: (_: S) => T,
		update: (_1: S, _2: T) => Iterable<ItemEvent<R>> = () => [],
		keep: (_: T) => boolean = () => false,
	): ItemEvent<T | R>[] {
		this.#loaded = true;

		const entries = src.map((value) => ({ value, created: make(value) }));
		const srcKeys = new Set(entries.map((x) => x.created.key));

		// Delete items that are no longer present
		const changed: ItemEvent<T | R>[] = [];
		for (const [key, item] of this.#items.entries()) {
			if (!srcKeys.has(key) && !keep(item)) {
				changed.push({ item, type: 'removed' });
				this.remove(key);
			}
		}

		// Update and insert items
		for (const { value, created } of entries) {
			let item = this.get(created.key);
			if (!item) {
				item = created;
				this.add(item);
				changed.push({ item, type: 'added' });
			}

			changed.push(...update(value, item));
		}
		return changed;
	}
}
