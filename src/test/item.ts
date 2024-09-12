/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-namespace */
import { Uri, Range } from 'vscode';
import type { MarkdownString, ProviderResult, WorkspaceFolder } from 'vscode';
import { Commands, Context } from './testing';
import path from 'path';
import { TestConfig } from './config';
import deepEqual from 'deep-equal';
import { CapturedProfile, ItemWithProfiles, ProfileType } from './profile';

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
		| 'profile';

	/**
	 * Constructs an ID for an item. The ID of a test item consists of the URI
	 * for the relevant file or folder with the URI query set to the test item
	 * kind (see Kind) and the URI fragment set to the function name, if the
	 * item represents a test, benchmark, or example function.
	 *
	 * - Module:    file:///path/to/mod?module
	 * - Workspace: file:///path/to/src?workspace
	 * - Package:   file:///path/to/mod/pkg?package
	 * - File:      file:///path/to/mod/file.go?file
	 * - Test:      file:///path/to/mod/file.go?test#TestXxx
	 * - Benchmark: file:///path/to/mod/file.go?benchmark#BenchmarkXxx
	 * - Fuzz:      file:///path/to/mod/file.go?test#FuzzXxx
	 * - Example:   file:///path/to/mod/file.go?example#ExampleXxx
	 */
	export function id(uri: Uri, kind: Kind, name?: string): string {
		// TODO: Simplify the ID to just JSON or a hash or something?

		uri = uri.with({ query: kind });
		if (name) uri = uri.with({ fragment: name });
		return uri.toString();
	}

	/**
	 * Parses the ID as a URI and extracts the kind and name.
	 *
	 * The URI of the relevant file or folder should be retrieved wil
	 * TestItem.uri.
	 */
	export function parseId(id: string): { kind: Kind; name?: string } {
		const u = Uri.parse(id);
		const kind = u.query as Kind;
		const name = u.fragment;
		return { kind, name };
	}
}

export interface GoTestItem {
	readonly uri: Uri;
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
		// Return a given root if discovery is on or the root (or more
		// likely one of its children) has been explicitly requested
		const items = [];
		for (const root of await this.#getChildren(true)) {
			const mode = root.config.discovery();
			if (mode === 'on' || this.#requested.has(`${root.uri}`)) {
				items.push(root);
			}
		}
		return items;
	}

	async #getChildren(reload = false): Promise<RootItem[]> {
		// Use the cached roots when possible
		if ((!reload && this.#didLoad) || !this.#context.workspace.workspaceFolders) {
			return [...this.#roots.values()].flatMap((x) => [...x.values()]);
		}

		// Load the roots for each workspace folder
		this.#didLoad = true;
		await Promise.all(
			this.#context.workspace.workspaceFolders.map(async (ws) => {
				const roots = await this.#getWorkspaceRoots(ws);
				const set = this.#roots.get(`${ws.uri}`);
				if (set) {
					set.replace(roots);
				} else {
					this.#roots.set(`${ws.uri}`, new ItemSet(roots));
				}
			})
		);

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
				MaxDepth: -1
			})
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
	 * Returns packages, reloading if necessary or requested. If discovery is
	 * disabled, only requested packages are returned.
	 */
	async getPackages(reload = false) {
		if (reload || !this.#didLoad) {
			// (Re)load packages
			this.#didLoad = true;
			this.#packages.replaceWith(
				Package.resolve(
					this.root,
					this.config,
					await this.#context.commands.packages({
						Files: [this.dir.toString()],
						Mode: 1,
						Recursive: true
					})
				),
				(src) => src.Path,
				(src) => new Package(this.config, this, src),
				(src, pkg) => pkg.update(src)
			);

			// Rebuild package relations
			const pkgs = [...this.#packages.values()];
			this.pkgRelations.replace(
				pkgs.map((pkg): [Package, Package | undefined] => {
					const ancestors = pkgs.filter((x) => pkg.path.startsWith(`${x.path}/`));
					ancestors.sort((a, b) => a.path.length - b.path.length);
					return [pkg, ancestors[0]];
				})
			);
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
}

export class Module extends RootItem {
	readonly root: Uri;
	readonly uri: Uri;
	readonly path: string;
	readonly kind = 'module';

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

export class Package implements GoTestItem, ItemWithProfiles {
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
				TestFiles: files
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
	readonly profiles = new Set<CapturedProfile>();

	#src?: Commands.Package;

	constructor(config: TestConfig, parent: RootItem, src: Commands.Package) {
		this.#config = config;
		this.parent = parent;
		this.path = src.Path;
		this.uri = Uri.joinPath(Uri.parse(src.TestFiles![0].URI), '..');
		this.update(src);
	}

	update(src: Commands.Package) {
		if (deepEqual(src, this.#src)) {
			return [];
		}
		this.#src = src;

		const changes = this.files.replaceWith(
			src.TestFiles!.filter((x) => x.Tests.length),
			(src) => src.URI,
			(src) => new TestFile(this.#config, this, src),
			(src, file) => file.update(src)
		);

		const allTests = this.getTests();
		this.testRelations.replace(
			allTests.map((test): [TestCase, TestCase | undefined] => [test, findParentTestCase(allTests, test.name)])
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
	getChildren(): GoTestItem[] {
		const tests = this.#config.showFiles() ? [...this.files] : [...this.files].flatMap((x) => x.getChildren());
		if (!this.#config.nestPackages()) {
			return [...tests, ...this.profiles];
		}

		return [...(this.parent.pkgRelations.getChildren(this) || []), ...tests, ...this.profiles];
	}

	getTests() {
		return [...this.files].flatMap((x) => [...x.tests]);
	}

	/**
	 * Finds a test with the specified name.
	 *
	 * @param name - The name of the test to find.
	 * @param create - Specifies whether to create a dynamic subtest if it doesn't exist.
	 * @returns The found test, if found or successfully created.
	 */
	findTest(name: string, create = false) {
		// Check for an exact match
		for (const file of this.files) {
			for (const test of file.tests) {
				if (test.name === name) {
					return test;
				}
			}
		}

		if (!create) return;

		// Find the parent test case and create a dynamic subtest
		const parent = findParentTestCase(this.getTests(), name);
		return parent?.makeDynamicTestCase(name);
	}

	async addProfile(dir: Uri, type: ProfileType, time: Date) {
		const profile = await CapturedProfile.new(this, dir, type, time);
		this.profiles.add(profile);
		return profile;
	}

	removeProfile(profile: CapturedProfile) {
		this.profiles.delete(profile);
	}
}

export class TestFile implements GoTestItem {
	readonly #config: TestConfig;
	readonly package: Package;
	readonly uri: Uri;
	readonly kind = 'file';
	readonly hasChildren = true;
	readonly tests = new ItemSet<TestCase>();

	#src?: Commands.TestFile;

	constructor(config: TestConfig, pkg: Package, src: Commands.TestFile) {
		this.#config = config;
		this.package = pkg;
		this.uri = Uri.parse(src.URI);
		this.update(src);
	}

	update(src: Commands.TestFile) {
		if (deepEqual(src, this.#src)) {
			return [];
		}
		this.#src = src;

		return this.tests.replaceWith(
			src.Tests,
			(src) => src.Name,
			(src) => new StaticTestCase(this.#config, this, src),
			(src, test) => (test as StaticTestCase).update(src)
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

export abstract class TestCase implements GoTestItem, ItemWithProfiles {
	readonly #config: TestConfig;
	readonly file: TestFile;
	readonly uri: Uri;
	readonly kind: GoTestItem.Kind;
	readonly name: string;
	readonly profiles = new Set<CapturedProfile>();

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
	getChildren(): (TestCase | CapturedProfile)[] {
		const subtests = this.#config.nestSubtests() ? this.file.package.testRelations.getChildren(this) || [] : [];
		return [...this.profiles, ...subtests];
	}

	makeDynamicTestCase(name: string) {
		const limit = this.#config.dynamicSubtestLimit();
		if (limit && limit > 0 && (this.file.package.testRelations.getChildren(this)?.length || 0) >= limit) {
			// TODO: Give some indication to the user?
			return;
		}
		const child = new DynamicTestCase(this.#config, this, name);
		this.file.tests.add(child);
		this.file.package.testRelations.add(this, child);
		return child;
	}

	removeDynamicTestCases() {
		for (const item of this.file.package.testRelations.getChildren(this) || []) {
			item.removeDynamicTestCases();
			this.file.tests.remove(item);
		}
		this.file.package.testRelations.removeChildren(this);
	}

	async addProfile(dir: Uri, type: ProfileType, time: Date) {
		const profile = await CapturedProfile.new(this, dir, type, time);
		this.profiles.add(profile);
		return profile;
	}

	removeProfile(profile: CapturedProfile) {
		this.profiles.delete(profile);
	}
}

export class StaticTestCase extends TestCase {
	range?: Range;
	#src?: Commands.TestCase;

	constructor(config: TestConfig, file: TestFile, src: Commands.TestCase) {
		const uri = Uri.parse(src.Loc.uri);
		const kind = src.Name.match(/^(Test|Fuzz|Benchmark|Example)/)![1].toLowerCase() as GoTestItem.Kind;
		super(config, file, uri, kind, src.Name);
		this.update(src);
	}

	update(src: Commands.TestCase) {
		if (deepEqual(src, this.#src)) {
			return [];
		}

		const { start, end } = src.Loc.range;
		this.#src = src;
		this.range = new Range(start.line, start.character, end.line, end.character);
		return [this];
	}

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
	constructor(config: TestConfig, parent: TestCase, name: string) {
		super(config, parent.file, parent.uri, parent.kind, name);
	}
}

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
	readonly #parentChild = new Map<Parent, Child[]>();

	constructor(relations: Iterable<[Child, Parent]> = []) {
		for (const [child, parent] of relations) {
			this.add(parent, child);
		}
	}

	add(parent: Parent, child: Child) {
		this.#childParent.set(child, parent);
		const children = this.#parentChild.get(parent);
		if (children) {
			children.push(child);
		} else {
			this.#parentChild.set(parent, [child]);
		}
	}

	replace(relations: Iterable<[Child, Parent]>) {
		this.#childParent.clear();
		this.#parentChild.clear();
		for (const [child, parent] of relations) {
			this.add(parent, child);
		}
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
		return this.#parentChild.get(parent);
	}
}

export class ItemSet<T extends GoTestItem & { key: string }> {
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
		const keep = new Set(items.map((x) => `${x.uri}`));
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
	replaceWith<S, R>(
		src: S[],
		id: (_: S) => string,
		make: (_: S) => T,
		update: (_1: S, _2: T) => Iterable<R>
	): Iterable<R | T> {
		// Delete items that are no longer present
		const keep = new Set(src.map(id));
		for (const key of this.keys()) {
			if (!keep.has(key)) {
				this.remove(key);
			}
		}

		// Update and insert items
		const changed = [];
		for (const item of src) {
			const key = id(item);
			const existing = this.get(key);
			if (existing) {
				changed.push(...update(item, existing));
			} else {
				const x = make(item);
				this.add(x);
				changed.push(x);
			}
		}
		return changed;
	}
}
