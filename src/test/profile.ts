import { createHash } from 'node:crypto';
import { Uri } from 'vscode';
import { GoTestItem } from './item';
import { BaseItem } from './itemBase';

export class ProfileType {
	constructor(
		public readonly id: string,
		public readonly flag: string,
		public readonly label: string,
		public readonly description: string
	) {}

	enabled = false;
	picked = false;
}

export function makeProfileTypeSet() {
	return <const>[
		new ProfileType('cpu', '--cpuprofile', 'CPU', 'Profile CPU usage'),
		new ProfileType('mem', '--memprofile', 'Memory', 'Profile memory usage'),
		new ProfileType('mutex', '--mutexprofile', 'Mutexes', 'Profile mutex contention'),
		new ProfileType('block', '--blockprofile', 'Blocking', 'Profile blocking events')
	];
}

export abstract class ItemWithProfiles extends BaseItem {
	readonly profiles = new Set<CapturedProfile>();

	addProfile(dir: Uri, type: ProfileType, time: Date) {
		const profile = new CapturedProfile(this, dir, type, time);
		this.profiles.add(profile);
		return profile;
	}

	removeProfile(profile: CapturedProfile) {
		this.profiles.delete(profile);
	}
}

export class CapturedProfile extends BaseItem implements GoTestItem {
	readonly kind = 'profile';
	readonly type: ProfileType;
	readonly uri: Uri;
	readonly parent: ItemWithProfiles;
	readonly hasChildren = false;

	constructor(parent: ItemWithProfiles, dir: Uri, type: ProfileType, time: Date) {
		super();

		// This is a simple way to make an ID from the package URI
		const hash = createHash('sha256').update(`${parent.uri}`).digest('hex').substring(0, 16);

		this.type = type;
		this.uri = Uri.joinPath(dir, `${hash}-${type.id}-${time.getTime()}.pprof`);
		this.parent = parent;
	}

	get key() {
		return `${this.uri}`;
	}

	get label() {
		return `Profile (${this.type.id})`;
	}

	getParent() {
		return this.parent;
	}

	getChildren() {
		return [];
	}
}
