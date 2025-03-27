/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-namespace */
import { Uri, Range } from 'vscode';
import type { MarkdownString, ProviderResult, TestRun, WorkspaceFolder } from 'vscode';
import { Commands, Context } from '../utils/testing';
import path from 'path';
import { TestConfig } from './config';
import deepEqual from 'deep-equal';
import { ProfileContainer } from './profile';

export namespace GoTestItem {
	/**
	 * Indicates the Go construct represented by a test item.
	 *
	 * - A 'module' is a folder that contains a go.mod file
	 * - A 'workspace' is a VSCode workspace folder that contains .go files outside
	 *   of a module
	 * - A 'package' is a folder that contains .go files (and is not a module)
	 * - A 'file' is a file ending with _test.go
	 * - A 'test' is a Go test, e.g. func TestXxx(t *testing.T)
	 * - A 'benchmark' is a Go benchmark, e.g. func BenchmarkXxx(t *testing.B)
	 * - A 'fuzz' is a Fuzz test, e.g., func TestFuzz(f *testing.F)
	 * - An 'example' is a Go example, e.g. func ExampleXxx()
	 *
	 * The top-level test item for a workspace folder is always either a module or a
	 * workspace. If the user opens a file (containing tests) that is not contained
	 * within any workspace folder, a top-level package will be created as a parent
	 * of that file.
	 */
	export type Kind =
		| 'module'
		| 'workspace'
		| 'package'
		| 'file'
		| 'test'
		| 'benchmark'
		| 'fuzz'
		| 'example'
		| 'profile-container'
		| 'profile-set'
		| 'profile';
}

export interface GoTestItem {
	// TODO(ethan.reesor): Replace with a union.

	readonly uri?: Uri;
	readonly kind: GoTestItem.Kind;
	readonly label: string;
	readonly name?: string;
	readonly range?: Range;
	hasChildren: boolean;
	error?: string | MarkdownString;

	getParent?(): ProviderResult<GoTestItem>;
	getChildren(): GoTestItem[] | Promise<GoTestItem[]>;
}

/**
 * Contains the top-level items for all workspaces.
 */
export class RootSet {
	#didLoad = false;
	readonly #context: Context;
	readonly #roots = new Map<string, ItemSet<RootItem>>();
	readonly #requested = new Set<string>();

	constructor(context: Context) {
		this.#context = context;
	}

	*[Symbol.iterator]() {
		for (const ws of this.#roots.values()) {
			yield* ws;
		}
	}

	/**
	 * Marks the root as requested so that it is included by getChildren when
	 * discovery is off.
	 */
	markRequested(root: RootItem) {
		this.#requested.add(`${root.uri}`);
	}

	async getChildren(): Promise<RootItem[]> {
		// The discovery mode may be different for different roots, so this
		// logic is less straightforward than it otherwise would be.
		const items = [];
		for (const root of await this.#getChildren(true)) {
			// If a root has discovery disabled and has _not_ been requested
			// (e.g. by opening a file), skip it.
			const mode = root.config.discovery();
			if (mode === 'on' || this.#requested.has(`${root.uri}`)) {
				items.push(root);
			}
		}
		return items;
	}

	/**
	 * Called when a file is updated.
	 *
	 * @param ws - The workspace folder of the file.
	 * @param uri - The updated file.
	 */
	async didUpdate(ws: WorkspaceFolder, uri: Uri, ranges: Record<string, Range[]> = {}) {
		// Ask gopls for package and test info
		const packages = Package.resolve(
			ws.uri,
			new TestConfig(this.#context.workspace, uri),
			await this.#context.commands.packages({
				Files: [uri.toString()],
				Mode: 1,
			}),
		);

		// An alternative build system may allow a file to be part of multiple
		// packages, so process all results
		const findOpts = { tryReload: true };
		const updated = [];
		for (const pkg of packages) {
			// This shouldn't happen, but just in case
			if (!pkg.TestFiles?.length) continue;

			// Find the module or workspace that owns this package
			const root = await this.getRootFor(pkg, findOpts);
			if (!root) continue; // TODO: Handle tests from external packages?

			// Mark the package as requested
			this.markRequested(root);
			root.markRequested(pkg);

			// Update the package
			updated.push(...root.updatePackage(pkg, ranges));
		}

		return updated;
	}

	/**
	 * Retrieves root items for all workspace folders, before applying discovery
	 * mode.
	 */
	async #getChildren(reload = false): Promise<RootItem[]> {
		// Use the cached roots when possible
		if ((!reload && this.#didLoad) || !this.#context.workspace.workspaceFolders) {
			return [...this.#roots.values()].flatMap((x) => [...x.values()]);
		}
		this.#didLoad = true;

		// For each workspace folder
		await Promise.all(
			this.#context.workspace.workspaceFolders.map(async (ws) => {
				// Get and store its roots
				const roots = await this.#getWorkspaceRoots(ws);
				const set = this.#roots.get(`${ws.uri}`);
				if (set) {
					set.replace(roots);
				} else {
					this.#roots.set(`${ws.uri}`, new ItemSet(roots));
				}
			}),
		);

		// Return a flat list of roots. Do not separate by workspace folder.
		return [...this.#roots.values()].flatMap((x) => [...x.values()]);
	}

	/**
	 * Retrieves the workspace roots for a given workspace folder.
	 *
	 * @param ws - The workspace folder to retrieve the roots for.
	 * @returns An array of `RootItem` objects representing the workspace roots.
	 */
	async #getWorkspaceRoots(ws: WorkspaceFolder) {
		// Ask gopls
		const config = new TestConfig(this.#context.workspace, ws.uri);
		const modules = Module.resolve(
			ws.uri,
			config,
			await this.#context.commands.modules({
				Dir: ws.uri.toString(),
				MaxDepth: -1,
			}),
		);

		// If the workspace is not a module, make an item for it
		const roots: RootItem[] = [];
		if (!modules.some((x) => Uri.joinPath(Uri.parse(x.GoMod), '..').toString() === ws.uri.toString())) {
			roots.push(new WorkspaceItem(config, this.#context, ws));
		}

		// Make an item for each module
		roots.push(...modules.map((x) => new Module(ws.uri, config, this.#context, x)));

		return roots;
	}

	/**
	 * Retrieves the root a given package belongs to.
	 *
	 * @param pkg - The package for which to retrieve the root.
	 * @param opts - Options for retrieving the root.
	 * @param opts.tryReload - Specifies whether to try reloading the roots.
	 * @returns The root for the package or undefined if the package does not belong to any workspace.
	 * @throws Error if the package contains no test files.
	 */
	async getRootFor(pkg: Commands.Package, opts: { tryReload: boolean }) {
		if (!pkg.TestFiles?.length) {
			throw new Error('package contains no test files');
		}

		const ws = this.#context.workspace.getWorkspaceFolder(Uri.parse(pkg.TestFiles[0].URI));
		if (!ws) {
			return;
		}

		// If the roots haven't been loaded, load them
		if (!this.#didLoad) {
			opts.tryReload = false;
			await this.#getChildren();
		}

		if (pkg.ModulePath) {
			// Does the package belong to a module and do we have it?
			let mod = this.#getModule(pkg.ModulePath);
			if (mod) return mod;

			// If not, reload the roots and check again, but only reload once
			// per reloadPackages call
			if (opts.tryReload) {
				opts.tryReload = false;
				await this.#getChildren(true);
			}

			// Check again
			mod = this.#getModule(pkg.ModulePath);
			if (mod) return mod;
		}

		const config = new TestConfig(this.#context.workspace, ws.uri);
		return this.#getWorkspace(new WorkspaceItem(config, this.#context, ws));
	}

	/**
	 * Retrieves a module with the specified path.
	 *
	 * @param path - The path of the module to retrieve.
	 * @returns The module with the specified path, or `undefined` if not found.
	 */
	#getModule(path: string) {
		for (const items of this.#roots.values()) {
			for (const item of items.values()) {
				if (item instanceof Module && item.path === path) {
					return item;
				}
			}
		}
	}

	/**
	 * Get or create an item for the root directory of a workspace.
	 */
	#getWorkspace(item: WorkspaceItem) {
		const wsKey = item.uri.toString();
		const roots = this.#roots.get(wsKey);
		if (!roots) {
			this.#roots.set(wsKey, new ItemSet([item]));
			return item;
		}

		if (roots.has(item)) {
			return roots.get(item)!;
		}

		roots.add(item);
		return item;
	}
}

/**
 * Common ancestor of {@link Module} and {@link WorkspaceItem}.
 */
export abstract class RootItem implements GoTestItem {
	abstract readonly uri: Uri;
	abstract readonly kind: GoTestItem.Kind;
	abstract readonly label: string;
	abstract readonly dir: Uri;
	abstract readonly root: Uri;
	readonly config: TestConfig;
	readonly hasChildren = true;
	readonly pkgRelations = new RelationMap<Package, Package | undefined>();

	#didLoad = false;
	readonly #context: Context;
	readonly #requested = new Set<string>();
	readonly #packages = new ItemSet<Package>();

	constructor(config: TestConfig, context: Context) {
		this.config = config;
		this.#context = context;
	}

	get key() {
		return `${this.uri}`;
	}

	/**
	 * Marks a package as requested by the user (e.g. by opening a file).
	 */
	markRequested(pkg: Commands.Package) {
		this.#requested.add(pkg.Path);
	}

	/**
	 * Retrieves the children of the root item. If this item has a root package,
	 * the children of that package are returned instead of the package itself.
	 * If package nesting is enabled, nested packages are excluded.
	 */
	async getChildren(): Promise<GoTestItem[]> {
		const allPkgs = await this.getPackages(true);
		const packages = (this.config.nestPackages() && this.pkgRelations.getChildren(undefined)) || allPkgs;
		const rootPkg = packages.find((x) => x.isRootPkg);
		return [...packages.filter((x) => x !== rootPkg), ...(rootPkg?.getChildren() || [])];
	}

	/**
	 * Creates or updates a {@link Package} with data from gopls.
	 * @param pkg The data from gopls.
	 * @param ranges Modified file ranges.
	 * @returns A list of update events.
	 */
	updatePackage(pkg: Commands.Package, ranges: Record<string, Range[]>) {
		const existing = this.#packages.get(pkg.Path);
		if (existing) {
			return existing.update(pkg, ranges);
		}

		const newPkg = new Package(this.config, this, pkg);
		this.#packages.add(newPkg);
		this.#rebuildPackageRelations();
		return [{ item: newPkg, type: 'added' }, ...newPkg.update(pkg, ranges)];
	}

	/**
	 * Returns packages, reloading if necessary or requested. If discovery is
	 * disabled, only requested packages are returned.
	 */
	async getPackages(reload = false) {
		if (reload || !this.#didLoad) {
			// (Re)load packages
			this.#didLoad = true;
			this.#packages.update(
				Package.resolve(
					this.root,
					this.config,
					await this.#context.commands.packages({
						Files: [this.dir.toString()],
						Mode: 1,
						Recursive: true,
					}),
				),
				(src) => src.Path,
				(src) => new Package(this.config, this, src),
				(src, pkg) => pkg.update(src, {}),
			);

			this.#rebuildPackageRelations();
		}

		const mode = this.config.discovery();
		switch (mode) {
			case 'on':
				// Return all packages
				return [...this.#packages.values()];

			default: {
				// Return only specifically requested packages
				const packages = [];
				for (const pkg of this.#packages.values()) {
					if (this.#requested.has(pkg.path)) {
						packages.push(pkg);
					}
				}
				return packages;
			}
		}
	}

	/**
	 * Rebuilds the package relations map used for nesting packages.
	 */
	#rebuildPackageRelations() {
		const pkgs = [...this.#packages.values()];
		this.pkgRelations.replace(
			pkgs.map((pkg): [Package, Package | undefined] => {
				const ancestors = pkgs.filter((x) => pkg.path.startsWith(`${x.path}/`));
				ancestors.sort((a, b) => a.path.length - b.path.length);
				return [pkg, ancestors[0]];
			}),
		);
	}
}

export class Module extends RootItem {
	readonly root: Uri;
	readonly uri: Uri;
	readonly path: string;
	readonly kind = 'module';

	/**
	 * Filters out excluded modules from a list of modules provided by gopls.
	 * @param root The root URI to use for relative path patterns.
	 * @param config The user's configuration.
	 * @param modules The modules provided by gopls.
	 * @returns The filtered modules.
	 */
	static resolve(root: Uri, config: TestConfig, { Modules }: Commands.ModulesResult) {
		if (!Modules) return [];

		const exclude = config.exclude() || [];
		return Modules.filter((m) => {
			const p = path.relative(root.fsPath, m.Path);
			return !exclude.some((x) => x.match(p));
		});
	}

	constructor(root: Uri, config: TestConfig, context: Context, mod: Commands.Module) {
		super(config, context);
		this.root = root;
		this.uri = Uri.parse(mod.GoMod);
		this.path = mod.Path;
	}

	get label() {
		return this.path;
	}

	get dir(): Uri {
		return Uri.joinPath(this.uri, '..');
	}
}

export class WorkspaceItem extends RootItem {
	readonly ws: WorkspaceFolder;
	readonly kind = 'workspace';

	constructor(config: TestConfig, context: Context, ws: WorkspaceFolder) {
		super(config, context);
		this.ws = ws;
	}

	get uri() {
		return this.ws.uri;
	}

	get dir(): Uri {
		return this.ws.uri;
	}

	get root(): Uri {
		return this.ws.uri;
	}

	get label() {
		return `${this.ws.name} (workspace)`;
	}
}

export class Package implements GoTestItem {
	/**
	 * Consolidates test and source package data from gopls and filters out
	 * excluded packages.
	 *
	 * If a directory contains `foo.go`, `foo_test.go`, and `foo2_test.go` with
	 * package directives `foo`, `foo`, and `foo_test`, respectively, gopls will
	 * report those as three separate packages. This function consolidates them
	 * into a single package.
	 * @param root The root URI to use for relative path patterns.
	 * @param config The user's configuration.
	 * @param packages Data provided by gopls.
	 * @returns The consolidated and filtered package data.
	 */
	static resolve(root: Uri, config: TestConfig, { Packages: all = [] }: Commands.PackagesResults) {
		if (!all) return [];

		// Consolidate `foo` and `foo_test` into a single Package
		const paths = new Set(all.filter((x) => x.TestFiles).map((x) => x.ForTest || x.Path));
		const results: Commands.Package[] = [];
		const exclude = config.exclude() || [];
		for (const pkgPath of paths) {
			const pkgs = all.filter((x) => x.Path === pkgPath || x.ForTest === pkgPath);
			const files = pkgs
				.flatMap((x) => x.TestFiles || [])
				.filter((m) => {
					const p = path.relative(root.fsPath, Uri.parse(m.URI).fsPath);
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

	readonly #config: TestConfig;
	readonly parent: RootItem;
	readonly uri: Uri;
	readonly path: string;
	readonly kind = 'package';
	readonly hasChildren = true;
	readonly files = new ItemSet<TestFile>();
	readonly testRelations = new RelationMap<TestCase, TestCase | undefined>();
	readonly profiles = new ProfileContainer(this);

	constructor(config: TestConfig, parent: RootItem, src: Commands.Package) {
		this.#config = config;
		this.parent = parent;
		this.path = src.Path;
		this.uri = Uri.joinPath(Uri.parse(src.TestFiles![0].URI), '..');
	}

	/**
	 * Updates the package with data from gopls.
	 * @param src The data from gopls.
	 * @param ranges Modified file ranges.
	 * @returns Update events. See {@link ItemEvent}.
	 */
	update(src: Commands.Package, ranges: Record<string, Range[]>) {
		// Apply the update
		const changes = this.files.update(
			src.TestFiles!.filter((x) => x.Tests.length),
			(src) => src.URI,
			(src) => new TestFile(this.#config, this, src),
			(src, file) => file.update(src, ranges[`${file.uri}`] || []),
		);
		if (!changes.length) {
			return [];
		}

		// Recalculate test-subtest relations
		const allTests = this.getTests();
		this.testRelations.replace(
			allTests.map((test): [TestCase, TestCase | undefined] => [test, findParentTestCase(allTests, test.name)]),
		);
		return changes;
	}

	get key() {
		return this.path;
	}

	/**
	 * Returns the package path, excluding the part that is shared with the
	 * parent.
	 */
	get label() {
		const pkgParent = this.parent.pkgRelations.getParent(this);
		if (pkgParent && this.#config.nestPackages()) {
			return this.path.substring(pkgParent.path.length + 1);
		}
		if (this.parent instanceof Module && this.path.startsWith(`${this.parent.path}/`)) {
			return this.path.substring(this.parent.path.length + 1);
		}
		return this.path;
	}

	/**
	 * Returns whether the package is the root package of the parent.
	 */
	get isRootPkg() {
		return `${this.uri}` === `${this.parent.dir}`;
	}

	/**
	 * Returns the module or folder this package belongs to, or its parent
	 * package if package nesting is enabled.
	 */
	getParent() {
		if (!this.#config.nestPackages()) {
			return this.parent;
		}
		return this.parent.pkgRelations.getParent(this) || this.parent;
	}

	/**
	 * Returns the package's children. If show files is enabled, this includes
	 * the package's test files, otherwise it includes the children of those
	 * files. If package nesting is enabled, this includes the package's child
	 * packages.
	 */
	getChildren() {
		const children: GoTestItem[] = [];
		const tests = this.#config.showFiles() ? [...this.files] : [...this.files].flatMap((x) => x.getChildren());
		if (this.#config.nestPackages()) {
			children.push(...(this.parent.pkgRelations.getChildren(this) || []));
		}

		children.push(...tests);

		if (this.profiles.hasChildren) {
			children.push(this.profiles);
		}
		return children;
	}

	/**
	 * @returns All tests in the package in a flat list.
	 */
	getTests() {
		return [...this.files].flatMap((x) => [...x.tests]);
	}

	/**
	 * Finds a test with the specified name.
	 *
	 * @param name - The name of the test to find.
	 * @param create - Specifies whether to create a dynamic subtest if it doesn't exist.
	 * @param run - If an item is created, the {@link TestRun} it should be associated with.
	 * @returns The found test, if found or successfully created.
	 */
	findTest(name: string, create?: false, run?: TestRun): TestCase | undefined;
	findTest(name: string, create: true, run: TestRun): TestCase;
	findTest(name: string, create = false, run?: TestRun) {
		// Check for an exact match
		for (const file of this.files) {
			for (const test of file.tests) {
				if (test.name === name) {
					// If the test is a dynamic test case and a test run is
					// provided, reassociate the test with the run
					if (run && test instanceof DynamicTestCase) {
						test.run = run;
					}
					return test;
				}
			}
		}

		if (create !== true || !run) return;

		// Find the parent test case and create a dynamic subtest
		const parent = findParentTestCase(this.getTests(), name);
		return parent?.makeDynamicTestCase(name, run);
	}
}

export class TestFile implements GoTestItem {
	readonly #config: TestConfig;
	readonly package: Package;
	readonly uri: Uri;
	readonly kind = 'file';
	readonly hasChildren = true;
	readonly tests = new ItemSet<TestCase>();

	constructor(config: TestConfig, pkg: Package, src: Commands.TestFile) {
		this.#config = config;
		this.package = pkg;
		this.uri = Uri.parse(src.URI);
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
			(src) => new StaticTestCase(this.#config, this, src),
			(src, test) => (test instanceof StaticTestCase ? test.update(src, ranges) : []),
			(test) => test instanceof DynamicTestCase,
		);
	}

	get key() {
		return `${this.uri}`;
	}

	get label() {
		return path.basename(this.uri.fsPath);
	}

	/**
	 * Returns the file's package, or the package's parent if it is a root
	 * package.
	 */
	getParent() {
		if (this.package.isRootPkg) {
			return this.package.getParent();
		}
		return this.package;
	}

	/**
	 * Returns top-level tests if subtests nesting is enabled, otherwise all
	 * tests.
	 */
	getChildren(): TestCase[] {
		if (this.#config.nestSubtests()) {
			return [...this.tests].filter((x) => !this.package.testRelations.getParent(x));
		}
		return [...this.tests];
	}
}

export abstract class TestCase implements GoTestItem {
	readonly #config: TestConfig;
	readonly file: TestFile;
	readonly uri: Uri;
	readonly kind: GoTestItem.Kind;
	readonly name: string;

	constructor(config: TestConfig, file: TestFile, uri: Uri, kind: GoTestItem.Kind, name: string) {
		this.#config = config;
		this.file = file;
		this.uri = uri;
		this.kind = kind;
		this.name = name;
	}

	get key() {
		return this.name;
	}

	get label(): string {
		// If we are a subtest, remove the parent's name from the label
		const parent = this.getParent();
		if (parent instanceof TestCase) {
			return this.name.replace(`${parent.name}/`, '');
		}
		return this.name;
	}

	get hasChildren() {
		return this.getChildren().length > 0;
	}

	/**
	 * Returns the parent test case if the test is a subtest and nesting is
	 * enabled. Otherwise, returns the file if files are shown or the file's
	 * parent.
	 */
	getParent() {
		const parentTest = this.#config.nestSubtests() && this.file.package.testRelations.getParent(this);
		if (parentTest) {
			return parentTest;
		}
		if (this.#config.showFiles()) {
			return this.file;
		}
		return this.file.getParent();
	}

	/**
	 * Returns subtests if nesting is enabled, otherwise nothing.
	 */
	getChildren() {
		const children: (ProfileContainer | TestCase)[] = [];
		if (this instanceof StaticTestCase && this.profiles.hasChildren) {
			children.push(this.profiles);
		}
		if (this.#config.nestSubtests()) {
			children.push(...(this.file.package.testRelations.getChildren(this) || []));
		}

		return children;
	}

	/**
	 * Create a new {@link DynamicTestCase} as a child of this test case. If the
	 * total number of this test's children exceeds the limit, no test is
	 * created.
	 */
	makeDynamicTestCase(name: string, run: TestRun) {
		const limit = this.#config.dynamicSubtestLimit();
		if (limit && limit > 0 && (this.file.package.testRelations.getChildren(this)?.length || 0) >= limit) {
			// TODO: Give some indication to the user?
			return;
		}

		const child = new DynamicTestCase(this.#config, this, name, run);
		this.file.tests.add(child);
		this.file.package.testRelations.add(this, child);
		return child;
	}

	/**
	 * Deletes all {@link DynamicTestCase}s that are children of this test case.
	 * This is called at the start of a test run.
	 * @returns The items that should be reloaded.
	 */
	removeDynamicTestCases(run?: TestRun): ReturnType<typeof this.getParent>[] {
		return this.file.package.testRelations.getChildren(this)?.flatMap((x) => x.removeDynamicTestCases(run)) ?? [];
	}
}

export class StaticTestCase extends TestCase {
	readonly profiles = new ProfileContainer(this);

	range?: Range;
	#src?: Commands.TestCase;

	constructor(config: TestConfig, file: TestFile, src: Commands.TestCase) {
		const uri = Uri.parse(src.Loc.uri);
		const kind = src.Name.match(/^(Test|Fuzz|Benchmark|Example)/)![1].toLowerCase() as GoTestItem.Kind;
		super(config, file, uri, kind, src.Name);
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
	run: TestRun;

	constructor(config: TestConfig, parent: TestCase, name: string, run: TestRun) {
		super(config, parent.file, parent.uri, parent.kind, name);
		this.run = run;
	}

	removeDynamicTestCases(run?: TestRun) {
		// If `run` is specified, only remove this case if it belongs to `run`
		if (run && run !== this.run) {
			return [];
		}

		const parent = this.getParent();
		super.removeDynamicTestCases(run);
		this.file.tests.remove(this);
		this.file.package.testRelations.removeChild(this);
		return [parent];
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

/**
 * Represents an update to a test item.
 *  - `added` indicates that the item was added.
 *  - `removed` indicates that the item was removed.
 *  - `moved` indicates that the item's range changed without changing its contents.
 *  - `modified` indicates that the item's contents and possibly its range changed.
 */
type ItemEvent<T> = { item: T; type: 'added' | 'removed' | 'moved' | 'modified' };

export class ItemSet<T extends { key: string }> {
	readonly #items: Map<string, T>;

	constructor(items: T[] = []) {
		this.#items = new Map(items.map((x) => [x.key, x]));
	}

	*keys() {
		yield* this.#items.keys();
	}

	*values() {
		yield* this.#items.values();
	}

	[Symbol.iterator]() {
		return this.#items.values();
	}

	get size() {
		return this.#items.size;
	}

	has(item: string | T) {
		return this.#items.has(typeof item === 'string' ? item : item.key);
	}

	get(item: string | T) {
		return this.#items.get(typeof item === 'string' ? item : item.key);
	}

	add(...items: T[]) {
		for (const item of items) {
			if (this.has(item)) continue;
			this.#items.set(item.key, item);
		}
	}

	remove(item: string | T) {
		this.#items.delete(typeof item === 'string' ? item : item.key);
	}

	/**
	 * Replaces the set of items with a new set. If the existing set has items
	 * with the same key, the original items are preserved.
	 */
	replace(items: T[]) {
		// Insert new items
		this.add(...items);

		// Delete items that are no longer present
		const keep = new Set(items.map((x) => x.key));
		for (const key of this.keys()) {
			if (!keep.has(key)) {
				this.remove(key);
			}
		}
	}

	/**
	 * Replaces the set of items with a new set. For each value in source, if an
	 * item with the same key exists in the set, the item is updated. Otherwise,
	 * a new item is created.
	 * @param src The sources to create items from.
	 * @param id A function that returns the item key of a source value.
	 * @param make A function that creates a new item from a source value.
	 * @param update A function that updates an existing item with a source value.
	 */
	update<S, R>(
		src: S[],
		id: (_: S) => string,
		make: (_: S) => T,
		update: (_1: S, _2: T) => Iterable<ItemEvent<R>>,
		keep: (_: T) => boolean = () => false,
	): ItemEvent<T | R>[] {
		// Delete items that are no longer present
		const changed: ItemEvent<T | R>[] = [];
		const srcKeys = new Set(src.map(id));
		for (const [key, item] of this.#items.entries()) {
			if (!srcKeys.has(key) && !keep(item)) {
				changed.push({ item, type: 'removed' });
				this.remove(key);
			}
		}

		// Update and insert items
		for (const value of src) {
			const key = id(value);
			let item = this.get(key);
			if (!item) {
				item = make(value);
				this.add(item);
				changed.push({ item, type: 'added' });
			}

			changed.push(...update(value, item));
		}
		return changed;
	}
}
