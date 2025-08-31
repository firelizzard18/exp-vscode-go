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
