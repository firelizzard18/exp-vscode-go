import { Uri, WorkspaceFolder } from 'vscode';
import { ItemSet } from './itemSet';
import { RelationMap } from '../utils/map';
import path from 'node:path';
import { WorkspaceConfig } from './workspaceConfig';
import { WeakMapWithDefault } from '../utils/map';
import { CapturedProfile, ProfileTracker, ProfileType } from './profiles';
import {
	Module,
	Package,
	Workspace,
	DynamicTestCase,
	GoTestItem,
	TestCase,
	findParentTestCase,
	isTestItem,
} from './item';
import { ModelUpdateEvent } from './itemResolver';
import moment from 'moment';

export type Presentable = GoTestItem | ProfileContainer | ProfileSet | ProfileItem;

export class ProfileContainer {
	readonly kind = 'profile-container';

	constructor(public readonly parent: GoTestItem) {}
}

export class ProfileSet {
	readonly kind = 'profile-set';

	constructor(
		public readonly parent: ProfileContainer,
		public readonly time: Date,
	) {}
}

export class ProfileItem {
	readonly kind = 'profile';
	readonly uri;

	constructor(
		public readonly parent: ProfileSet,
		public readonly profile: CapturedProfile,
	) {
		this.uri = profile.file;
	}
}

export class GoTestItemPresenter {
	readonly kind = '(root)';
	readonly workspaces = new ItemSet<Workspace, WorkspaceFolder | Uri>((x) => `${x instanceof Uri ? x : x.uri}`);

	readonly #config;
	readonly #pkgRel = new WeakMapWithDefault<Workspace | Module, RelationMap<Package, Package | undefined>>(
		() => new RelationMap(),
	);
	readonly #testRel = new WeakMapWithDefault<Package, RelationMap<TestCase, TestCase | undefined>>(
		() => new RelationMap(),
	);
	readonly #profiles = new ProfileTracker();
	readonly #requested = new WeakSet<Workspace | Module | Package>();

	constructor(config: WorkspaceConfig) {
		this.#config = config;
	}

	markRequested(item: Workspace | Module | Package) {
		this.#requested.add(item);
	}

	labelFor(item: Presentable) {
		switch (item.kind) {
			case 'workspace':
				return `${item.ws.name} (workspace)`;

			case 'module':
				return item.path;

			case 'package': {
				if (item.isRootPkg) {
					return '(root package)';
				}
				const config = this.#config.for(item);
				const pkgParent = this.#pkgRel.get(item.parent).getParent(item);
				if (pkgParent && config.nestPackages.get()) {
					return item.path.substring(pkgParent.path.length + 1);
				}
				if (item.parent instanceof Module && item.path.startsWith(`${item.parent.path}/`)) {
					return item.path.substring(item.parent.path.length + 1);
				}
				return item.path;
			}

			case 'file':
				return path.basename(item.uri.fsPath);

			default: {
				// If we are a subtest, remove the parent's name from the label
				const parent = this.getParent(item);
				if (parent instanceof TestCase) {
					return item.name.replace(`${parent.name}/`, '');
				}
				return item.name;
			}

			case 'profile-container':
				return 'Profiles';

			case 'profile-set': {
				const now = new Date();
				if (now.getFullYear() !== item.time.getFullYear()) {
					return moment(item.time).format('YYYY-MM-DD HH:mm:ss');
				}
				if (now.getMonth() !== item.time.getMonth() || now.getDate() !== item.time.getDate()) {
					return moment(item.time).format('MM-DD HH:mm:ss');
				}
				return moment(item.time).format('HH:mm:ss');
			}

			case 'profile':
				return item.profile.type.label;
		}
	}

	getParent(item: Presentable): Presentable | undefined {
		switch (item.kind) {
			case 'workspace':
			case 'module':
				// Modules are root items in the view.
				return undefined;

			case 'package': {
				const config = this.#config.for(item);
				if (!config.nestPackages.get()) {
					return item.parent;
				}

				const parent = this.#pkgRel.get(item.parent).getParent(item);
				if (!parent) return item.parent;
				if (parent.isRootPkg) return parent.parent;
				return parent;
			}

			case 'file': {
				if (item.package.isRootPkg) {
					return this.getParent(item.package);
				}
				return item.package;
			}

			case 'profile-container':
			case 'profile-set':
			case 'profile':
				return item.parent;

			default: {
				const config = this.#config.for(item);
				const parentTest = config.nestSubtests.get() && this.#testRel.get(item.file.package).getParent(item);
				if (parentTest) {
					return parentTest;
				}
				if (config.showFiles.get()) {
					return item.file;
				}
				return this.getParent(item.file);
			}
		}
	}

	hasChildren(item: Presentable): 'none' | 'lazy' | 'eager' {
		switch (item.kind) {
			case 'workspace':
			case 'module':
			case 'package':
				// Resolve children lazily (since it might require calling
				// gopls).
				return 'lazy';

			case 'profile':
				// Profiles do not have children.
				return 'none';

			default:
				// Resolve children eagerly (since these should be static).
				for (const _ of this.getChildren(item)) {
					return 'eager';
				}
				return 'none';
		}
	}

	*getChildren(item?: Presentable | null): Iterable<Presentable, void, void> {
		if (!item) {
			for (const ws of this.workspaces) {
				// If the workspace has discovery disabled and has _not_
				// been requested (e.g. by opening a file), skip it.
				const mode = this.#config.for(ws).discovery.get();
				if (mode !== 'on' && this.#requested.has(ws)) {
					continue;
				}

				// If the workspace has packages (outside of a module),
				// include it as a root.
				if (ws.packages.size > 0) {
					yield ws;
				}

				// Include any modules as roots.
				yield* ws.modules;
			}
			return;
		}

		// If the item has a non-empty profile container, include it.
		if (isTestItem(item) && this.#profiles.has(item)) {
			const profiles = this.#profiles.get(item);
			if (profiles.length > 0) {
				yield new ProfileContainer(item);
			}
		}

		switch (item.kind) {
			case 'workspace':
			case 'module':
				const config = this.#config.for(item);
				const rel = this.#pkgRel.get(item);
				for (const pkg of item.packages) {
					// If the package is a root, return its children.
					if (pkg.isRootPkg) {
						yield* this.getChildren(pkg);
						continue;
					}

					// If packages are nested, return root packages. Otherwise,
					// return all packages.
					if (!config.nestPackages.get() || !rel.getParent(pkg)) {
						yield pkg;
					}
				}
				return;

			case 'package': {
				// If packages are nested, return child packages.
				const config = this.#config.for(item);
				const rel = this.#pkgRel.get(item.parent);
				if (config.nestPackages.get()) {
					yield* rel.getChildren(item) ?? [];
				}

				// If files are shown, return files. Otherwise, return all their
				// children.
				if (config.showFiles.get()) {
					yield* item.files;
				} else {
					for (const file of item.files) {
						yield* this.getChildren(file);
					}
				}
				return;
			}

			case 'file': {
				// If subtests are not nested, return all tests.
				const config = this.#config.for(item);
				if (!config.nestSubtests.get()) {
					yield* item.tests;
					return;
				}

				// Otherwise, return root tests (those with no parent).
				const rel = this.#testRel.get(item.package);
				for (const test of item.tests) {
					if (!rel.getParent(test)) {
						yield test;
					}
				}
				return;
			}

			case 'profile-container':
				// Create a profile set for each unique time.
				const profiles = this.#profiles.get(item.parent);
				for (const time of new Set(profiles.map((x) => x.time))) {
					yield new ProfileSet(item, time);
				}
				return;

			case 'profile-set':
				// Return a profile item for each profile that belongs to the
				// set (that has the same time).
				for (const profile of this.#profiles.get(item.parent.parent)) {
					if (profile.time === item.time) {
						yield new ProfileItem(item, profile);
					}
				}
				return;

			case 'profile':
				// Profiles do not have children.
				return;

			default: {
				// If nested subtest are enabled, return the tests's subtests.
				const config = this.#config.for(item);
				const rel = this.#testRel.get(item.file.package);
				if (config.nestSubtests.get()) {
					yield* rel.getChildren(item) || [];
				}
				return;
			}
		}
	}

	getProfiles(scope: Presentable) {
		return this.#profiles.get(this.#resolveProfilesParent(scope));
	}

	addProfile(scope: Presentable, dir: Uri, type: ProfileType, time: Date) {
		scope = this.#resolveProfilesParent(scope);
		const profile = new CapturedProfile(scope, type, time, dir);
		this.#profiles.add(profile);
		return profile;
	}

	removeProfile(profile: CapturedProfile) {
		this.#profiles.remove(profile);
	}

	#resolveProfilesParent(scope: Presentable) {
		// Don't attach profiles to profiles (this probably shouldn't ever
		// happen) or to dynamic test cases (since they are destroyed and
		// recreated on each run).
		while (
			scope instanceof DynamicTestCase ||
			scope.kind === 'profile' ||
			scope.kind === 'profile-set' ||
			scope.kind === 'profile-container'
		) {
			scope = this.getParent(scope)!;
		}

		return scope;
	}

	didUpdate(updates: ModelUpdateEvent[]) {
		// If packages were added or removed, rebuild the root's package
		// relations. It could make sense to do this on a per-package basis, but
		// it's a lot simpler just to rebuild the relation map.
		const pkgChanges = updates.filter(
			(x): x is ModelUpdateEvent<Package> =>
				x.item instanceof Package && (x.type === 'added' || x.type === 'removed'),
		);
		const pkgRoots = new Set(pkgChanges.map((x) => x.item.parent));
		for (const root of pkgRoots) {
			const pkgs = [...root.packages];
			this.#pkgRel.get(root).replace(
				pkgs.map((pkg): [Package, Package | undefined] => {
					const ancestors = pkgs.filter((x) => pkg.path.startsWith(`${x.path}/`));
					ancestors.sort((a, b) => b.path.length - a.path.length);
					return [pkg, ancestors[0]];
				}),
			);
		}

		// If tests were added or removed, rebuild the package's test relations.
		const testChanges = updates.filter(
			(x): x is ModelUpdateEvent<TestCase> =>
				x.item instanceof TestCase && (x.type === 'added' || x.type === 'removed'),
		);
		const testPkgs = new Set(testChanges.map((x) => x.item.file.package));
		for (const pkg of testPkgs) {
			const tests = [...pkg.allTests()];
			this.#testRel.get(pkg).replace(tests.map((test) => [test, findParentTestCase(pkg, test.name)]));
		}
	}
}

export function idFor(item: Presentable): Uri {
	switch (item.kind) {
		case 'workspace':
		case 'module':
		case 'package':
		case 'file':
			return item.uri.with({ query: `kind=${item.kind}` });

		case 'profile-container':
			return idFor(item.parent).with({ fragment: 'profiles' });

		case 'profile-set': {
			const base = idFor(item.parent);
			return base.with({ query: `${base.query}&at=${item.time.getTime()}` });
		}

		case 'profile': {
			const base = idFor(item.parent);
			return base.with({ query: `${base.query}&profile=${item.profile.type.id}` });
		}

		default:
			return item.uri.with({ query: `kind=${item.kind}&name=${item.name}` });
	}
}

export function parseID(id: string | Uri) {
	if (typeof id === 'string') {
		id = Uri.parse(id);
	}
	const query = new URLSearchParams(id.query);
	if (!query.has('kind')) {
		throw new Error('Invalid ID');
	}

	const obj = {
		path: id.path,
		kind: query.get('kind')! as Exclude<GoTestItem['kind'], 'profile-container' | 'profile-set' | 'profile'>,
		name: query.get('name') ?? undefined,
		at: query.has('at') ? new Date(Number(query.get('at'))) : undefined,
		profile: query.get('profile') ?? id.fragment === 'profiles',
	};

	switch (obj.kind) {
		case 'test':
		case 'benchmark':
		case 'example':
		case 'fuzz':
			if (!obj.name) throw new Error('Invalid test ID: missing name');
	}

	return obj;
}
