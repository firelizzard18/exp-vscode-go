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
