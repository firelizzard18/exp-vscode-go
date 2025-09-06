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

export class BiMap<A, B> {
	readonly #a2b = new Map<A, B>();
	readonly #b2a = new Map<B, A>();

	has(v: A | B) {
		return this.#a2b.has(v as any) || this.#b2a.has(v as any);
	}

	get(a: A): B;
	get(b: B): A;
	get(v: A | B) {
		return (this.#a2b.get(v as any) ?? this.#b2a.get(v as any)) as any;
	}

	add(a: A, b: B) {
		this.#a2b.set(a, b);
		this.#b2a.set(b, a);
	}

	delete(v: A | B) {
		this.#a2b.delete(v as any);
		this.#b2a.delete(v as any);
	}

	get a() {
		return this.#a2b.keys();
	}

	get b() {
		return this.#b2a.keys();
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
			this.add(parent, child);
		}
	}

	[Symbol.iterator]() {
		return this.#childParent.entries();
	}

	add(parent: Parent, child: Child) {
		this.#childParent.set(child, parent);
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
			this.add(parent, child);
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
