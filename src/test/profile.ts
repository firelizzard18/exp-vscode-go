/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { Uri } from 'vscode';
import type { GoTestItem } from './item';
import moment from 'moment';

export class ProfileType {
	constructor(
		public readonly id: string,
		public readonly label: string,
		public readonly description: string,
	) {}

	enabled = false;
	picked = false;
}

export function makeProfileTypeSet() {
	return <const>[
		new ProfileType('cpu', 'CPU', 'Profile CPU usage'),
		new ProfileType('mem', 'Memory', 'Profile memory usage'),
		new ProfileType('mutex', 'Mutexes', 'Profile mutex contention'),
		new ProfileType('block', 'Blocking', 'Profile blocking events'),
	];
}

export class ProfileContainer {
	readonly kind = 'profile-container';
	readonly parent: GoTestItem;
	readonly profiles = new Map<number, ProfileSet>();

	constructor(parent: GoTestItem) {
		this.parent = parent;
	}

	addProfile(dir: Uri, type: ProfileType, time: Date): CapturedProfile {
		let set = this.profiles.get(time.getTime());
		if (!set) {
			set = new ProfileSet(this, time);
			this.profiles.set(time.getTime(), set);
		}

		const profile = CapturedProfile.new(set, dir, type);
		set.profiles.add(profile);
		return profile;
	}
}

export class ProfileSet {
	readonly kind = 'profile-set';
	readonly time: Date;
	readonly parent: ProfileContainer;
	readonly profiles = new Set<CapturedProfile>();

	constructor(parent: ProfileContainer, time: Date) {
		this.parent = parent;
		this.time = time;
	}

	get label() {
		const now = new Date();
		if (now.getFullYear() !== this.time.getFullYear()) {
			return moment(this.time).format('YYYY-MM-DD HH:mm:ss');
		}
		if (now.getMonth() !== this.time.getMonth() || now.getDate() !== this.time.getDate()) {
			return moment(this.time).format('MM-DD HH:mm:ss');
		}
		return moment(this.time).format('HH:mm:ss');
	}
}

/**
 * Represents a captured profile.
 */
export class CapturedProfile {
	readonly kind = 'profile';
	readonly type: ProfileType;
	readonly uri: Uri;
	readonly parent: ProfileSet;
	readonly hasChildren = false;

	static new(parent: ProfileSet, dir: Uri, type: ProfileType) {
		let file = Uri.joinPath(dir, `${type.id}.pprof`);
		const item = parent.parent.parent;
		switch (item.kind) {
			case 'test':
			case 'benchmark':
			case 'example':
			case 'fuzz':
				file = file.with({ query: `title=${item.name} (${type.label}) @ ${parent.label}` });
				break;
		}
		return new this(parent, type, file);
	}

	private constructor(parent: ProfileSet, type: ProfileType, uri: Uri) {
		this.type = type;
		this.parent = parent;
		this.uri = uri;
	}

	get key() {
		return `${this.uri}`;
	}

	remove(): void {
		this.parent.profiles.delete(this);
	}
}
