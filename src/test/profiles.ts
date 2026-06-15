import { Uri } from 'vscode';
import { GoTestItem } from './item';

/**
 * A type of profile that can be captured by Go's profiling tools.
 */
export class ProfileType {
	/** Profile CPU usage. */
	static readonly cpu = new this('cpu', 'CPU', 'Profile CPU usage');

	/** Profile memory usage. */
	static readonly mem = new this('mem', 'Memory', 'Profile memory usage');

	/** Profile mutex contention. */
	static readonly mutex = new this('mutex', 'Mutexes', 'Profile mutex contention');

	/** Profile blocking events. */
	static readonly block = new this('block', 'Blocking', 'Profile blocking events');

	/** All supported profile types. */
	static readonly all = [this.cpu, this.mem, this.mutex, this.block] as const;

	private constructor(
		public readonly id: string,
		public readonly label: string,
		public readonly description: string,
	) {}

	enabled = false;
	picked = false;
}

/**
 * Represents a captured profile.
 */
export class CapturedProfile {
	readonly file: Uri;

	constructor(
		public readonly item: GoTestItem,
		public readonly type: ProfileType,
		public readonly time: Date,
		dir: Uri,
	) {
		this.file = Uri.joinPath(dir, `${type.id}.pprof`);
	}
}

export class ProfileTracker {
	readonly #profiles = new WeakMap<GoTestItem, Set<CapturedProfile>>();

	has(item: GoTestItem) {
		return this.#profiles.has(item);
	}

	get(item: GoTestItem): CapturedProfile[] {
		return [...(this.#profiles.get(item) || [])];
	}

	add(profile: CapturedProfile) {
		let profiles = this.#profiles.get(profile.item);
		if (!profiles) {
			profiles = new Set();
			this.#profiles.set(profile.item, profiles);
		}
		profiles.add(profile);
	}

	remove(profile: CapturedProfile) {
		this.#profiles.get(profile.item)?.delete(profile);
	}
}
