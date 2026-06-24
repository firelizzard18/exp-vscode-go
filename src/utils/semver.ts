export class SemVer {
	static parse(s: string) {
		const match = s.match(/^v(\d+)\.(\d+)\.(\d+)(?:-(.*))?$/);
		if (!match) return;

		return new this(Number(match[1]), Number(match[2]), Number(match[3]), match[4]);
	}

	constructor(major: number, minor: number, patch: number, extra?: string) {
		this.major = major;
		this.minor = minor;
		this.patch = patch;
		this.extra = extra;
	}

	readonly major;
	readonly minor;
	readonly patch;
	readonly extra;

	cmp(other: SemVer) {
		let c = this.major - other.major;
		if (c !== 0) return c;

		c = this.minor - other.minor;
		if (c !== 0) return c;

		c = this.patch - other.patch;
		if (c !== 0) return c;

		// Don't parse the extra string.
		if (!this.extra && other.extra) return -1;
		if (this.extra && !other.extra) return -1;
		return 0;
	}
}
