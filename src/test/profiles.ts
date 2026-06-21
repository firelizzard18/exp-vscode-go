import { Uri } from 'vscode';

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
		public readonly type: ProfileType,
		public readonly time: Date,
		dir: Uri,
	) {
		this.file = Uri.joinPath(dir, `${type.id}.pprof`);
	}
}
