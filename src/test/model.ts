import { ConfigurationChangeEvent, Range, TestRun, Uri, WorkspaceFolder } from 'vscode';
import { Commands, Context } from '../utils/testing';
import { ItemEvent, ItemSet } from './itemSet';
import deepEqual from 'deep-equal';
import { RelationMap } from './relationMap';
import path from 'node:path';
import { WorkspaceConfig } from './workspaceConfig';
import { WeakMapWithDefault } from '../utils/map';

export type GoTestItem = Module | Workspace | Package | TestFile | TestCase;

export class GoTestItemProvider {
	readonly #context;
	readonly #pkgRel = new WeakMapWithDefault<Workspace | Module, RelationMap<Package, Package | undefined>>(
		() => new RelationMap(),
	);
	readonly #testRel = new WeakMapWithDefault<Package, RelationMap<TestCase, TestCase | undefined>>(
		() => new RelationMap(),
	);
	readonly #workspaces = new ItemSet<Workspace>();
	readonly #config = new WeakMap<Workspace, WorkspaceConfig>();
	readonly #requested = new WeakSet<Workspace | Module | Package>();

	constructor(context: Context) {
		this.#context = context;
	}

	didChangeConfiguration(e: ConfigurationChangeEvent) {
		// Invalidate cached configuration values for all workspaces. It would
		// be better to directly iterate over the config cache, but weak maps
		// can't be iterated.
		for (const ws of this.#workspaces) {
			this.#config.get(ws)?.invalidate(e);
		}
	}

	labelFor(item: GoTestItem) {
		switch (item.kind) {
			case 'workspace':
				return `${item.ws.name} (workspace)`;
			case 'module':
				return item.path;

			case 'package': {
				const config = this.#configFor(item);
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
		}
	}

	getParent(item: GoTestItem): GoTestItem | undefined {
		switch (item.kind) {
			case 'workspace':
			case 'module':
				// Modules are root items in the view.
				return undefined;

			case 'package': {
				const config = this.#configFor(item);
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

			default: {
				const config = this.#configFor(item);
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

			default:
				return this.getChildren(item).length > 0;
		}
	}

	getChildren(item?: GoTestItem): GoTestItem[] {
		if (!item) {
			const children = [];
			for (const ws of this.#workspaces) {
				// If the workspace has discovery disabled and has _not_
				// been requested (e.g. by opening a file), skip it.
				const mode = this.#configFor(ws).discovery.get();
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
				const config = this.#configFor(item);
				const children: GoTestItem[] = [];
				const tests = config.showFiles.get()
					? [...item.files]
					: [...item.files].flatMap((x) => this.getChildren(x));
				if (config.nestPackages.get()) {
					children.push(...(this.#pkgRel.get(item.parent).getChildren(item) || []));
				}

				children.push(...tests);

				// if (this.profiles.hasChildren) {
				// 	children.push(this.profiles);
				// }
				return children;
			}

			case 'file': {
				const config = this.#configFor(item);
				if (config.nestSubtests.get()) {
					return [...item.tests].filter((x) => !this.#testRel.get(item.package).getParent(x));
				}
				return [...item.tests];
			}

			default: {
				const config = this.#configFor(item);
				const children: TestCase[] = [];
				// if (this instanceof StaticTestCase && this.profiles.hasChildren) {
				// 	children.push(this.profiles);
				// }
				if (config.nestSubtests.get()) {
					children.push(...(this.#testRel.get(item.file.package).getChildren(item) || []));
				}

				return children;
			}
		}
	}

	/** Reloads workspaces and modules. */
	async resolveRoots() {
		if (!this.#context.workspace.workspaceFolders) {
			return;
		}

		// Update the workspace item set.
		this.#workspaces.update(
			this.#context.workspace.workspaceFolders,
			(ws) => `${ws.uri}`,
			(ws) => new Workspace(ws),
			() => [], // Nothing to update
		);

		// Query gopls.
		const results = await Promise.all(
			[...this.#workspaces].map(async (ws) => {
				const r = await this.#context.commands.modules({
					Dir: `${ws.uri}`,
					MaxDepth: -1,
				});
				return [ws, r] as const;
			}),
		);

		// Update the workspaces' modules list.
		for (const [ws, { Modules }] of results) {
			if (!Modules) continue;

			const config = this.#configFor(ws);
			const exclude = config.exclude.get() || [];
			ws.updateModules(
				Modules.filter((m) => {
					const p = path.relative(ws.uri.fsPath, m.Path);
					return !exclude.some((x) => x.match(p));
				}),
			);
		}
	}

	async resolvePackages(root: Workspace | Module) {
		// Query gopls.
		const result = await this.#context.commands.packages({
			Files: [`${root.dir}`],
			Mode: 1,
			Recursive: true,
		});

		// Consolidate `foo` and `foo_test`.
		const ws = root instanceof Workspace ? root : root.workspace;
		const packages = this.#consolidatePackages(ws, result);

		// Update.
		root.updatePackages(packages);
		this.#rebuildRelations(root);
	}

	async didUpdateFile(wsf: WorkspaceFolder, file: Uri, ranges: Record<string, Range[]> = {}) {
		// Resolve or create the workspace.
		let ws = this.#workspaces.get(`${wsf.uri}`);
		if (!ws) {
			ws = new Workspace(wsf);
			this.#workspaces.add(ws);
		}

		// Query gopls.
		const packages = this.#consolidatePackages(
			ws,
			await this.#context.commands.packages({
				Files: [`${file}`],
				Mode: 1,
			}),
		);

		// A helper to get the root for a package. If the package belongs to a
		// module and there is no corresponding module, try reloading. Fallback
		// to the workspace, for example when the workspace is a subdirectory of
		// a module.
		let didReload = false;
		const getRoot = async (pkg: Commands.Package) => {
			if (!pkg.ModulePath) return ws;

			const mod = ws.modules.get(pkg.ModulePath);
			if (mod || didReload) return mod ?? ws;

			// Try reloading, maybe the module will appear.
			didReload = true;
			await this.resolveRoots();
			return ws.modules.get(pkg.ModulePath) ?? ws;
		};

		// Process packages. An alternative build system may allow a file to be
		// part of multiple packages, so we can't assume there's only one
		// package.
		const updated = [];
		const roots = new Set<Workspace | Module>([ws]);
		for (const src of packages) {
			// Sanity check.
			if (!src.TestFiles?.length) continue;

			// Get the workspace or module that owns this package.
			const root = await getRoot(src);
			roots.add(root);

			// Get or create the package.
			let pkg = root.packages.get(src.Path);
			if (!pkg) {
				pkg = new Package(root, src);
				root.packages.add(pkg);
				updated.push({ item: pkg, type: 'added' });
			}

			// Update the package.
			updated.push(...pkg.update(src, ranges));

			// Mark the root and the package as requested.
			this.#requested.add(root);
			this.#requested.add(pkg);
		}

		// If anything changed, rebuild relations.
		if (updated.length > 0) {
			for (const root of roots) {
				this.#rebuildRelations(root);
			}
		}

		return updated;
	}

	/**
	 * Consolidates test and source package data from gopls and filters out
	 * excluded packages.
	 *
	 * If a directory contains `foo.go`, `foo_test.go`, and `foo2_test.go` with
	 * package directives `foo`, `foo`, and `foo_test`, respectively, gopls will
	 * report those as three separate packages. This function consolidates them
	 * into a single package.
	 * @param ws The workspace.
	 * @param packages Data provided by gopls.
	 * @returns The consolidated and filtered package data.
	 */
	#consolidatePackages(ws: Workspace, { Packages: all = [] }: Commands.PackagesResults) {
		if (!all) return [];

		const exclude = this.#configFor(ws).exclude.get() || [];
		const paths = new Set(all.filter((x) => x.TestFiles).map((x) => x.ForTest || x.Path));
		const results: Commands.Package[] = [];
		for (const pkgPath of paths) {
			const pkgs = all.filter((x) => x.Path === pkgPath || x.ForTest === pkgPath);
			const files = pkgs
				.flatMap((x) => x.TestFiles || [])
				.filter((m) => {
					const p = path.relative(ws.dir.fsPath, Uri.parse(m.URI).fsPath);
					return !exclude.some((x) => x.match(p));
				});
			if (!files.length) {
				continue;
			}
			results.push({
				Path: pkgPath,
				ModulePath: pkgs[0].ModulePath,
				TestFiles: files,
			});
		}
		return results;
	}

	/** Rebuilds the package and test relations maps. */
	#rebuildRelations(root: Workspace | Module) {
		const pkgs = [...root.packages];
		this.#pkgRel.get(root).replace(
			pkgs.map((pkg): [Package, Package | undefined] => {
				const ancestors = pkgs.filter((x) => pkg.path.startsWith(`${x.path}/`));
				ancestors.sort((a, b) => a.path.length - b.path.length);
				return [pkg, ancestors[0]];
			}),
		);

		for (const pkg of pkgs) {
			const tests = [...pkg.allTests()];
			this.#testRel.get(pkg).replace(tests.map((test) => [test, findParentTestCase(tests, test.name)]));
		}
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

	/** Returns a {@link TestConfig} for the workspace of the given item. */
	#configFor(item: GoTestItem) {
		for (;;) {
			switch (item.kind) {
				case 'workspace':
					break;

				case 'module':
					item = item.workspace;
					continue;
				case 'package':
					item = item.parent;
					continue;
				case 'file':
					item = item.package;
					continue;
				default:
					item = item.file;
					continue;
			}

			// Cache config objects.
			const existing = this.#config.get(item);
			if (existing) return existing;

			const config = new WorkspaceConfig(this.#context.workspace, item.ws);
			this.#config.set(item, config);
			return config;
		}
	}
}

export class Workspace {
	readonly kind = 'workspace';
	readonly ws;
	readonly modules = new ItemSet<Module>();
	readonly packages = new ItemSet<Package>();

	constructor(ws: WorkspaceFolder) {
		this.ws = ws;
	}

	get uri() {
		return this.ws.uri;
	}

	get dir(): Uri {
		return this.ws.uri;
	}

	get key() {
		return `${this.uri}`;
	}

	updateModules(modules: Commands.Module[]) {
		this.modules.update(
			modules,
			(x) => x.Path,
			(x) => new Module(this, x),
			() => [], // Nothing to update
		);
	}

	updatePackages(packages: Commands.Package[]) {
		this.packages.update(
			packages,
			(x) => x.Path,
			(x) => new Package(this, x),
			(x, pkg) => pkg.update(x, {}),
		);
	}
}

export class Module {
	readonly kind = 'module';
	readonly uri;
	readonly path;
	readonly workspace;
	readonly packages = new ItemSet<Package>();

	constructor(workspace: Workspace, mod: Commands.Module) {
		this.workspace = workspace;
		this.uri = Uri.parse(mod.GoMod);
		this.path = mod.Path;
	}

	get dir(): Uri {
		return Uri.joinPath(this.uri, '..');
	}

	get key() {
		return this.path;
	}

	updatePackages(packages: Commands.Package[]) {
		this.packages.update(
			packages,
			(x) => x.Path,
			(x) => new Package(this, x),
			(x, pkg) => pkg.update(x, {}),
		);
	}
}

export class Package {
	readonly kind = 'package';
	readonly parent;
	readonly uri;
	readonly path;
	readonly files = new ItemSet<TestFile>();

	constructor(parent: Module | Workspace, pkg: Commands.Package) {
		this.parent = parent;
		this.path = pkg.Path;
		this.uri = Uri.joinPath(Uri.parse(pkg.TestFiles![0].URI), '..');
	}

	get key() {
		return this.path;
	}

	/**
	 * Returns whether the package is the root package of the parent.
	 */
	get isRootPkg() {
		return `${this.uri}` === `${this.parent.dir}`;
	}

	/**
	 * Updates the package with data from gopls.
	 * @param src The data from gopls.
	 * @param ranges Modified file ranges.
	 * @returns Update events. See {@link ItemEvent}.
	 */
	update(src: Commands.Package, ranges: Record<string, Range[]>) {
		const changes = this.files.update(
			src.TestFiles!.filter((x) => x.Tests.length),
			(src) => src.URI,
			(src) => new TestFile(this, src),
			(src, file) => file.update(src, ranges[`${file.uri}`] || []),
		);
		if (!changes.length) {
			return [];
		}
		return changes;
	}

	*allTests() {
		for (const file of this.files) {
			yield* file.tests;
		}
	}
}

export class TestFile {
	readonly kind = 'file';
	readonly package;
	readonly uri;
	readonly tests = new ItemSet<TestCase>();

	constructor(pkg: Package, file: Commands.TestFile) {
		this.package = pkg;
		this.uri = Uri.parse(file.URI);
	}

	get key() {
		return `${this.uri}`;
	}

	/**
	 * Updates the file with data from gopls.
	 * @param src The data from gopls.
	 * @param ranges Modified file ranges.
	 * @returns Update events. See {@link ItemEvent}.
	 */
	update(src: Commands.TestFile, ranges: Range[]) {
		return this.tests.update(
			src.Tests,
			(src) => src.Name,
			(src) => new StaticTestCase(this, src),
			(src, test) => (test instanceof StaticTestCase ? test.update(src, ranges) : []),
			(test) => test instanceof DynamicTestCase,
		);
	}
}

export abstract class TestCase {
	readonly kind;
	readonly file;
	readonly uri;
	readonly name;

	constructor(file: TestFile, uri: Uri, kind: 'test' | 'benchmark' | 'fuzz' | 'example', name: string) {
		this.file = file;
		this.uri = uri;
		this.kind = kind;
		this.name = name;
	}

	get key() {
		return this.name;
	}
}

export class StaticTestCase extends TestCase {
	range?: Range;
	#src;

	constructor(file: TestFile, test: Commands.TestCase) {
		const kind = test.Name.match(/^(Test|Fuzz|Benchmark|Example)/)![1].toLowerCase();
		super(file, Uri.parse(test.Loc.uri), kind as TestCase['kind'], test.Name);
		this.#src = test;
		this.range = new Range(
			test.Loc.range.start.line,
			test.Loc.range.start.character,
			test.Loc.range.end.line,
			test.Loc.range.end.character,
		);
	}

	/**
	 * Updates the test case with data from gopls.
	 * @param src The data from gopls.
	 * @param ranges Modified file ranges.
	 * @returns Update events. See {@link ItemEvent}.
	 */
	update(src: Commands.TestCase, ranges: Range[]): Iterable<ItemEvent<TestCase>> {
		// Did the metadata (range) change?
		const metadata = !deepEqual(src, this.#src);

		// Did the contents change?
		const contents = ranges.some((x) => this.contains(x));

		if (!metadata && !contents) {
			return [];
		}

		// Update the range
		if (metadata) {
			const { start, end } = src.Loc.range;
			this.#src = src;
			this.range = new Range(start.line, start.character, end.line, end.character);
		}

		// Return the appropriate event
		return [{ item: this, type: contents ? 'modified' : 'moved' }];
	}

	/**
	 * Determines whether the test case contains a given range. The range must
	 * be strictly contained within the test's range. If the intersection
	 * includes regions outside of the test, or intersects the end or the
	 * beginning but has a size of zero, this will return false.
	 */
	contains(range: Range): boolean {
		// The range of the test must be defined
		if (!this.range) return false;

		// The test must contain the given range
		if (!this.range.contains(range)) return false;

		// The intersection must be strictly within the test range. If the
		// intersection is an empty range at the very start or end of the test's
		// range, reject it.
		const r = this.range.intersection(range)!;
		if (!r.isEmpty) return true;
		return !r.start.isEqual(this.range.start) && !r.end.isEqual(this.range.end);
	}
}

export class DynamicTestCase extends TestCase {
	/**
	 * The {@link TestRun} that created this dynamic test case.
	 */
	run;

	constructor(parent: TestCase, name: string, run: TestRun) {
		super(parent.file, parent.uri, parent.kind, name);
		this.run = run;
	}
}

/**
 * Searches a set of tests for a test case that is the parent of the given test
 * name.
 */
export function findParentTestCase(allTests: TestCase[], name: string) {
	for (;;) {
		const i = name.lastIndexOf('/');
		if (i < 0) return;
		name = name.substring(0, i);
		for (const test of allTests) {
			if (test.name === name) {
				return test;
			}
		}
	}
}
