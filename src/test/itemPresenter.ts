import { TestRun, Uri, WorkspaceFolder } from 'vscode';
import { ItemSet } from './itemSet';
import { RelationMap } from '../utils/map';
import path from 'node:path';
import { WorkspaceConfig } from './workspaceConfig';
import { WeakMapWithDefault } from '../utils/map';
import { ProfileContainer } from './profile';
import moment from 'moment';
import {
	Module,
	Package,
	Workspace,
	DynamicTestCase,
	GoTestItem,
	StaticTestCase,
	TestCase,
	findParentTestCase,
} from './model';

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
	readonly #profiles = new WeakMapWithDefault<Package | StaticTestCase, ProfileContainer>(
		(x) => new ProfileContainer(x),
	);
	readonly #requested = new WeakSet<Workspace | Module | Package>();

	constructor(config: WorkspaceConfig) {
		this.#config = config;
	}

	markRequested(item: Workspace | Module | Package) {
		this.#requested.add(item);
	}

	labelFor(item: GoTestItem) {
		switch (item.kind) {
			case 'workspace':
				return `${item.ws.name} (workspace)`;

			case 'module':
				return item.path;

			case 'package': {
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
				return item.type.label;
		}
	}

	getParent(item: GoTestItem): GoTestItem | undefined {
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
				return this.#pkgRel.get(item.parent).getParent(item) || item.parent;
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

	hasChildren(item: GoTestItem) {
		switch (item.kind) {
			case 'workspace':
			case 'module':
			case 'package':
			case 'file':
				return true;
			case 'profile':
				return false;
			default:
				return this.getChildren(item).length > 0;
		}
	}

	getChildren(item?: GoTestItem | null): GoTestItem[] {
		if (!item) {
			const children = [];
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
					children.push(ws);
				}

				// Include any modules as roots.
				children.push(...ws.modules);
			}
			return children;
		}

		switch (item.kind) {
			case 'workspace':
			case 'module':
				return [...item.packages];

			case 'package': {
				const config = this.#config.for(item);
				const children: GoTestItem[] = [];
				const tests = config.showFiles.get()
					? [...item.files]
					: [...item.files].flatMap((x) => this.getChildren(x));
				if (config.nestPackages.get()) {
					children.push(...(this.#pkgRel.get(item.parent).getChildren(item) || []));
				}

				children.push(...tests);

				if (this.hasChildren(this.#profiles.get(item))) {
					children.push(this.#profiles.get(item));
				}
				return children;
			}

			case 'file': {
				const config = this.#config.for(item);
				if (config.nestSubtests.get()) {
					return [...item.tests].filter((x) => !this.#testRel.get(item.package).getParent(x));
				}
				return [...item.tests];
			}

			case 'profile-container':
				return [...item.profiles.values()].filter((x) => this.hasChildren(x));

			case 'profile-set':
				return [...item.profiles];

			case 'profile':
				return [];

			default: {
				const config = this.#config.for(item);
				const children = [];
				if (item instanceof StaticTestCase && this.hasChildren(this.#profiles.get(item))) {
					children.push(this.#profiles.get(item));
				}
				if (config.nestSubtests.get()) {
					children.push(...(this.#testRel.get(item.file.package).getChildren(item) || []));
				}

				return children;
			}
		}
	}

	/**
	 * The packages of a {@link Workspace} or {@link Module} were updated, so
	 * package relations should be rebuilt.
	 */
	didUpdatePackages(root: Workspace | Module) {
		// TODO: Can we handle this by listening for item events instead?
		const pkgs = [...root.packages];
		this.#pkgRel.get(root).replace(
			pkgs.map((pkg): [Package, Package | undefined] => {
				const ancestors = pkgs.filter((x) => pkg.path.startsWith(`${x.path}/`));
				ancestors.sort((a, b) => a.path.length - b.path.length);
				return [pkg, ancestors[0]];
			}),
		);
	}

	/**
	 * The files and tests of a {@link Package} were updated, so test relations
	 * should be rebuilt.
	 */
	didUpdateTests(pkg: Package) {
		// TODO: Can we handle this by listening for item events instead?
		const tests = [...pkg.allTests()];
		this.#testRel.get(pkg).replace(tests.map((test) => [test, findParentTestCase(tests, test.name)]));
	}

	/**
	 * Adds a new {@link DynamicTestCase dynamic subtest}.
	 */
	addTestCase(parent: TestCase, name: string, run: TestRun) {
		const child = new DynamicTestCase(parent, name, run);
		parent.file.tests.add(child);
		this.#testRel.get(parent.file.package).add(parent, child);
		return child;
	}

	/**
	 * Deletes all {@link DynamicTestCase dynamic subtests} that are children of
	 * the given test case. If a test run is specified, only items from that run
	 * are removed.
	 * @returns The items that should be reloaded.
	 */
	*removeTestCases(parent: TestCase, run?: TestRun): Iterable<TestCase> {
		const rel = this.#testRel.get(parent.file.package);
		if (!(parent instanceof DynamicTestCase)) {
			const children = rel.getChildren(parent) ?? [];
			for (const child of children) {
				yield* this.removeTestCases(child, run);
			}
			return;
		}

		// If `run` is specified, only remove this case if it belongs to `run`
		if (run && run !== parent.run) {
			return;
		}

		// This item's parent should be refreshed.
		yield rel.getParent(parent)!;

		// Remove children.
		const children = rel.getChildren(parent) ?? [];
		for (const child of children) {
			for (const _ of this.removeTestCases(child, run)) {
				// Discard
			}
		}

		// Remove this item.
		parent.file.tests.remove(parent);
		rel.removeChild(parent);
	}
}
