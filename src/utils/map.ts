export class MapWithDefault<K, V extends NonNullable<any>> extends Map<K, V> {
	readonly #create;

	constructor(create: (key: K) => V) {
		super();
		this.#create = create;
	}

	get(key: K): V {
		let value = super.get(key);
		if (value !== undefined && value !== null) return value;
		value = this.#create(key);
		this.set(key, value);
		return value;
	}
}

export class WeakMapWithDefault<K extends WeakKey, V extends NonNullable<any>> extends WeakMap<K, V> {
	readonly #create;

	constructor(create: (key: K) => V) {
		super();
		this.#create = create;
	}

	get(key: K): V {
		let value = super.get(key);
		if (value !== undefined && value !== null) return value;
		value = this.#create(key);
		this.set(key, value);
		return value;
	}
}

/**
 * Bidirectional map for parent-child relationships.
 */
export class RelationMap<Child, Parent> {
	readonly #childParent = new Map<Child, Parent>();
	readonly #parentChild = new Map<Parent, Set<Child>>();

	constructor(relations: Iterable<[Child, Parent]> = []) {
		for (const [child, parent] of relations) {
			this.set(parent, child);
		}
	}

	[Symbol.iterator]() {
		return this.#childParent.entries();
	}

	set(parent: Parent, child: Child) {
		// Remove the child from the old parent.
		if (this.#childParent.has(child)) {
			const old = this.#childParent.get(child)!;
			if (old === parent) return;
			this.#parentChild.get(old)?.delete(child);
		}

		// Reassign the parent.
		this.#childParent.set(child, parent);

		// Add to the new parent.
		const children = this.#parentChild.get(parent);
		if (children) {
			children.add(child);
		} else {
			this.#parentChild.set(parent, new Set([child]));
		}
	}

	replace(relations: Iterable<[Child, Parent]>) {
		this.#childParent.clear();
		this.#parentChild.clear();
		for (const [child, parent] of relations) {
			this.set(parent, child);
		}
	}

	removeChild(child: Child) {
		const parent = this.#childParent.get(child);
		if (!parent) return;
		this.#parentChild.get(parent)!.delete(child);
		this.#childParent.delete(child);
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
		const set = this.#parentChild.get(parent);
		return set ? [...set] : undefined;
	}
}
