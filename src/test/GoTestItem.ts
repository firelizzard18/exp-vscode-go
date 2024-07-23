/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-namespace */
import { Uri, EventEmitter, Range } from 'vscode';
import type { ConfigurationScope, MarkdownString, ProviderResult, WorkspaceFolder } from 'vscode';
import { TestItemData, TestItemProvider } from './TestItemResolver';
import { Commands, Context } from './testSupport';
import path from 'path';

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
	export type Kind = 'module' | 'workspace' | 'package' | 'file' | 'test' | 'benchmark' | 'fuzz' | 'example';

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

type DiscoveryMode = 'on' | 'off';

export class GoTestItemProvider implements TestItemProvider<GoTestItem> {
	readonly #didChangeTestItem = new EventEmitter<GoTestItem[] | void>();
	readonly onDidChangeTestItem = this.#didChangeTestItem.event;
	readonly #didInvalidateTestResults = new EventEmitter<GoTestItem[] | void>();
	readonly onDidInvalidateTestResults = this.#didInvalidateTestResults.event;

	readonly #context: Context;
	readonly #requested = new Map<string, Module | WorkspaceItem>();
	#roots?: (Module | WorkspaceItem)[];

	constructor(context: Context) {
		this.#context = context;
	}

	getConfig<T>(name: string, scope?: ConfigurationScope): T | undefined {
		return this.#context.workspace.getConfiguration('goExp', scope)?.get<T>(name);
	}

	getPackages(args: Commands.PackagesArgs) {
		return this.#context.commands.packages(args);
	}

	getTestItem(element: GoTestItem): TestItemData | Thenable<TestItemData> {
		return {
			id: GoTestItem.id(element.uri, element.kind, element.name),
			label: element.label,
			uri: element.uri,
			hasChildren: element.hasChildren,
			range: element.range,
			error: element.error
		};
	}

	getParent(element: GoTestItem) {
		return element.getParent();
	}

	async getChildren(element?: GoTestItem | undefined) {
		if (element) {
			return element.getChildren();
		}

		return (await this.#loadRoots(true)).filter((x) => {
			// Return a given root if discovery is on or the root (or more
			// likely one of its children) has been explicitly requested
			const mode = this.getConfig<DiscoveryMode>('testExplorer.discovery', x.uri);
			return mode === 'on' || this.#requested.has(x.uri.toString());
		});
	}

	async reload(uri?: Uri, invalidate = false) {
		if (!uri) {
			await this.#didChangeTestItem.fire();
			if (invalidate) {
				await this.#didInvalidateTestResults.fire();
			}
			return;
		}

		if (!uri.path.endsWith('.go')) {
			return;
		}

		const ws = this.#context.workspace.getWorkspaceFolder(uri);
		if (!ws) {
			// TODO: Handle tests from external packages?
			return;
		}

		// Load tests for the given URI
		const packages = Package.resolve(
			await this.#context.commands.packages({
				Files: [uri.toString()],
				Mode: 1
			})
		);

		// Find the Module a package belongs to.
		const findModuleFor = (roots: (Module | WorkspaceItem)[], pkg: Commands.Package) => {
			return roots.find((x) => x instanceof Module && x.path === pkg.ModulePath);
		};

		// Find the Module or WorkspaceItem a package belongs to.
		let didLoad = false;
		const findParent = async (pkg: Commands.Package) => {
			// If the roots haven't been loaded, load them
			if (!this.#roots) {
				didLoad = true;
				this.#roots = await this.#loadRoots();
			}

			// Does the package belong to a module and do we have it?
			let mod = findModuleFor(this.#roots, pkg);
			if (mod) return mod;

			// If not, reload the roots and check again, but only reload once
			// per reloadPackages call
			if (!didLoad) {
				didLoad = true;
				this.#roots = await this.#loadRoots(true);
			}

			// Check again
			mod = findModuleFor(this.#roots, pkg);
			if (mod) return mod;

			// Find the WorkspaceItem for this workspace
			let wsi = this.#roots.find((x) => x instanceof WorkspaceItem && x.uri.toString() === ws.uri.toString());
			if (wsi) return wsi;

			// If that doesn't exist somehow, create it
			wsi = new WorkspaceItem(this, ws);
			this.#roots.push(wsi);
			return wsi;
		};

		// With one URI and no recursion there *should* only be one result, but
		// process in a loop regardless
		const items: GoTestItem[] = [];
		for (const pkg of packages) {
			// Find the module or workspace that owns this package
			const parent = await findParent(pkg);

			// Mark the package as requested
			this.#requested.set(parent.uri.toString(), parent);

			// Update the data model
			items.push(parent.resolvePackage(pkg));
		}

		await this.#didChangeTestItem.fire(items);
		if (invalidate) {
			await this.#didInvalidateTestResults.fire(items);
		}
	}

	async #loadRoots(force = false) {
		if (!force && this.#roots) {
			return this.#roots;
		}
		if (!this.#context.workspace.workspaceFolders) {
			return [];
		}

		// Ask gopls for a list of modules for each workspace folder
		const modules = await Promise.all(
			this.#context.workspace.workspaceFolders.map(async (ws) => {
				const r = await this.#context.commands.modules({ Dir: ws.uri.toString(), MaxDepth: -1 });
				return { ws, ...r };
			})
		);

		// Make the root module and/or workspace items
		this.#roots = modules.flatMap(({ ws, Modules }): (Module | WorkspaceItem)[] => {
			const modules = (Modules || []).map((x) => {
				const mod = new Module(this, x);
				return this.#requested.get(mod.uri.toString()) || mod;
			});

			// If the workspace is not a module, create a WorkspaceItem for it
			if (modules.some((x) => x.dir.toString() === ws.uri.toString())) {
				return modules;
			}
			return [this.#requested.get(ws.uri.toString()) || new WorkspaceItem(this, ws), ...modules];
		});
		return this.#roots;
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

	getParent(): ProviderResult<GoTestItem>;
	getChildren(): ProviderResult<GoTestItem[]>;
}

export abstract class RootItem implements GoTestItem {
	abstract readonly uri: Uri;
	abstract readonly kind: GoTestItem.Kind;
	abstract readonly label: string;
	readonly hasChildren = true;

	readonly #provider: GoTestItemProvider;
	readonly #requested = new Map<string, Package>();

	pkgChildParent?: Map<Package, Package | undefined>;
	pkgParentChild?: Map<Package | undefined, Package[]>;

	constructor(provider: GoTestItemProvider) {
		this.#provider = provider;
	}

	get dir(): Uri {
		if (this instanceof Module) {
			return Uri.joinPath(this.uri, '..');
		}
		return this.uri;
	}

	contains(uri: Uri) {
		const a = this.dir.fsPath;
		const b = uri.fsPath;
		return b === a || b.startsWith(`${a}/`);
	}

	resolvePackage(pkg: Commands.Package) {
		// TODO: testExplorer.nestPackages
		const item = new Package(this.#provider, this as any, pkg.Path, pkg.TestFiles!);
		this.#requested.set(pkg.Path, item);
		return item;
	}

	getParent() {
		return null;
	}

	async getChildren(): Promise<GoTestItem[]> {
		const children = await this.getPackages();
		const i = children.findIndex((x) => x.uri.toString() === this.dir.toString());
		if (i < 0) return children;

		const selfPkg = children[i];
		children.splice(i, 1);
		return [...children, ...selfPkg.getChildren()];
	}

	async getPackages() {
		this.pkgChildParent = undefined;
		this.pkgParentChild = undefined;

		const packages = await this.#getPackages();
		if (!this.#provider.getConfig<boolean>('testExplorer.nestPackages', this.uri)) {
			return packages;
		}

		this.pkgChildParent = new Map<Package, Package | undefined>();
		for (const pkg of packages) {
			const ancestors = packages.filter((x) => pkg.path.startsWith(`${x.path}/`));
			ancestors.sort((a, b) => a.path.length - b.path.length);
			this.pkgChildParent.set(pkg, ancestors[0]);
		}

		this.pkgParentChild = new Map<Package | undefined, Package[]>();
		for (const [child, parent] of this.pkgChildParent) {
			if (!this.pkgParentChild.has(parent)) {
				this.pkgParentChild.set(parent, []);
			}
			this.pkgParentChild.get(parent)!.push(child);
		}

		return this.pkgParentChild.get(undefined) || [];
	}

	async #getPackages() {
		const mode = this.#provider.getConfig<DiscoveryMode>('testExplorer.discovery', this.uri);
		switch (mode) {
			case 'on': // Discover all packages
				return Package.resolve(
					await this.#provider.getPackages({
						Files: [this.dir.toString()],
						Mode: 1,
						Recursive: true
					})
				).map((x) => new Package(this.#provider, this as any, x.Path, x.TestFiles!));

			default: // Return only specifically requested packages
				return [...this.#requested.values()];
		}
	}
}

class Module extends RootItem implements GoTestItem {
	readonly uri: Uri;
	readonly path: string;
	readonly kind = 'module';

	constructor(provider: GoTestItemProvider, mod: Commands.Module) {
		super(provider);
		this.uri = Uri.parse(mod.GoMod);
		this.path = mod.Path;
	}

	get label() {
		return this.path;
	}
}

class WorkspaceItem extends RootItem implements GoTestItem {
	readonly ws: WorkspaceFolder;
	readonly kind = 'workspace';

	constructor(provider: GoTestItemProvider, ws: WorkspaceFolder) {
		super(provider);
		this.ws = ws;
	}

	get uri() {
		return this.ws.uri;
	}

	get label() {
		return `${this.ws.name} (workspace)`;
	}
}

export class Package implements GoTestItem {
	static resolve({ Packages: all = [] }: Commands.PackagesResults) {
		if (!all) return [];

		// Consolidate `foo` and `foo_test` into a single Package
		const paths = new Set(all.filter((x) => x.TestFiles).map((x) => x.ForTest || x.Path));
		const results: Commands.Package[] = [];
		for (const path of paths) {
			const pkgs = all.filter((x) => x.Path === path || x.ForTest === path);
			const files = pkgs.flatMap((x) => x.TestFiles || []);
			if (!files.length) {
				continue;
			}
			results.push({
				Path: path,
				ModulePath: pkgs[0].ModulePath,
				TestFiles: files
			});
		}
		return results;
	}

	readonly #provider: GoTestItemProvider;
	readonly parent: RootItem;
	readonly uri: Uri;
	readonly path: string;
	readonly kind = 'package';
	readonly hasChildren = true;
	readonly files: TestFile[];

	constructor(provider: GoTestItemProvider, parent: RootItem, path: string, files: Commands.TestFile[]) {
		this.#provider = provider;
		this.parent = parent;
		this.path = path;
		this.uri = Uri.joinPath(Uri.parse(files[0].URI), '..');
		this.files = files.filter((x) => x.Tests.length).map((x) => new TestFile(this.#provider, this, x));
	}

	get label() {
		const pkgParent = this.parent.pkgChildParent?.get(this);
		if (pkgParent && this.#provider.getConfig<boolean>('testExplorer.nestPackages', this.uri)) {
			return this.path.substring(pkgParent.path.length + 1);
		}
		if (this.parent instanceof Module && this.path.startsWith(`${this.parent.path}/`)) {
			return this.path.substring(this.parent.path.length + 1);
		}
		return this.path;
	}

	getParent() {
		if (!this.#provider.getConfig<boolean>('testExplorer.nestPackages', this.uri)) {
			return this.parent;
		}
		return this.parent.pkgChildParent?.get(this) || this.parent;
	}

	getChildren(): GoTestItem[] {
		if (!this.#provider.getConfig<boolean>('testExplorer.nestPackages', this.uri)) {
			return this.#getChildren();
		}

		return [...(this.parent.pkgParentChild?.get(this) || []), ...this.#getChildren()];
	}

	#getChildren() {
		if (this.#provider.getConfig<boolean>('testExplorer.showFiles', this.uri)) {
			return this.files;
		}
		return this.files.flatMap((x) => x.getChildren());
	}

	getTests() {
		return this.files.flatMap((x) => x.getTests());
	}
}

export class TestFile implements GoTestItem {
	readonly #provider: GoTestItemProvider;
	readonly package: Package;
	readonly uri: Uri;
	readonly kind = 'file';
	readonly hasChildren = true;
	readonly tests: TestCase[];

	constructor(provider: GoTestItemProvider, pkg: Package, file: Commands.TestFile) {
		this.#provider = provider;
		this.package = pkg;
		this.uri = Uri.parse(file.URI);
		this.tests = file.Tests.map((x) => new TestCase(this.#provider, this, x));
	}

	get label() {
		return path.basename(this.uri.fsPath);
	}

	getParent() {
		return this.package;
	}

	getChildren(): GoTestItem[] {
		return this.tests;
	}

	getTests() {
		return this.tests;
	}
}

export class TestCase implements GoTestItem {
	readonly #provider: GoTestItemProvider;
	readonly file: TestFile;
	readonly uri: Uri;
	readonly kind: GoTestItem.Kind;
	readonly name: string;
	readonly range: Range | undefined;
	readonly hasChildren = false;
	// TODO: subtests

	constructor(provider: GoTestItemProvider, file: TestFile, test: Commands.TestCase) {
		this.#provider = provider;
		this.file = file;
		this.uri = Uri.parse(test.Loc.uri);
		this.name = test.Name;
		this.kind = test.Name.match(/^(Test|Fuzz|Benchmark|Example)/)![1].toLowerCase() as GoTestItem.Kind;

		const { start, end } = test.Loc.range;
		this.range = new Range(start.line, start.character, end.line, end.character);
	}

	get label() {
		return this.name;
	}

	getParent() {
		if (this.#provider.getConfig<boolean>('testExplorer.showFiles', this.uri)) {
			return this.file;
		}
		return this.file.package;
	}

	getChildren(): GoTestItem[] {
		return [];
	}
}
