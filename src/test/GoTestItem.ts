/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-namespace */
import { EventEmitter, MarkdownString, Range, Uri } from 'vscode';
import { TestItemData, TestItemProvider } from './TestItemResolver';
import { Commands, Workspace } from './testSupport';
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

	readonly #workspace: Workspace;
	readonly #commands: Commands;
	readonly #requested = new Map<string, Module | WorkspaceItem>();
	#roots?: (Module | WorkspaceItem)[];

	constructor(workspace: Workspace, commands: Commands) {
		this.#workspace = workspace;
		this.#commands = commands;
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

	async getChildren(element?: GoTestItem | undefined): Promise<GoTestItem[] | undefined> {
		if (element) {
			return element.getChildren?.();
		}

		return (await this.#loadRoots(true)).filter((x) => {
			// Return a given root if discovery is on or the root (or more
			// likely one of its children) has been explicitly requested
			const mode = this.#workspace.getConfiguration('goExp', x.uri).get<DiscoveryMode>('testExplorer.discovery');
			return mode === 'on' || this.#requested.has(x.uri.toString());
		});
	}

	async reloadAll() {
		this.#didChangeTestItem.fire();
	}

	async reloadPackages(uri: Uri) {
		const ws = this.#workspace.getWorkspaceFolder(uri);
		if (!ws) {
			// TODO: Handle tests from external packages?
			return;
		}

		const roots = await this.#loadRoots();
		const packages = Package.resolve(
			await this.#commands.packages({
				Files: [uri.toString()],
				Mode: 1
			})
		);

		const items: GoTestItem[] = [];
		for (const pkg of packages) {
			const parent =
				roots.find((x) => x instanceof Module && x.path === pkg.ModulePath) ||
				roots.find((x) => x instanceof WorkspaceItem && x.uri.toString() === ws.uri.toString());
			if (!parent) {
				continue; // TODO?
			}

			this.#requested.set(parent.uri.toString(), parent);
			items.push(parent.resolvePackage(pkg));
		}

		this.#didChangeTestItem.fire(items);
	}

	async #loadRoots(force = false) {
		if (!force && this.#roots) {
			return this.#roots;
		}
		if (!this.#workspace.workspaceFolders) {
			return [];
		}

		this.#roots = (
			await Promise.all(
				this.#workspace.workspaceFolders.map(async (ws) => {
					const r = await this.#commands.modules({ Dir: ws.uri.toString(), MaxDepth: -1 });
					return { ws, ...r };
				})
			)
		).flatMap(({ ws, Modules }): (Module | WorkspaceItem)[] => {
			if (Modules?.length) {
				return Modules.map((x) => {
					const mod = new Module(this.#workspace, this.#commands, x);
					return this.#requested.get(mod.uri.toString()) || mod;
				});
			}
			return [
				this.#requested.get(ws.uri.toString()) ||
					new WorkspaceItem(this.#workspace, this.#commands, ws.uri, ws.name)
			];
		});
		return this.#roots;
	}
}

export interface GoTestItem {
	readonly parent?: GoTestItem;
	readonly uri: Uri;
	readonly kind: GoTestItem.Kind;
	readonly label: string;
	readonly name?: string;
	readonly range?: Range;
	hasChildren: boolean;
	error?: string | MarkdownString;

	getChildren(): GoTestItem[] | undefined | Thenable<GoTestItem[] | undefined>;
}

abstract class RootItem {
	abstract readonly uri: Uri;

	readonly #workspace: Workspace;
	readonly #commands: Commands;
	readonly #requested = new Map<string, Package>();

	constructor(workspace: Workspace, commands: Commands) {
		this.#workspace = workspace;
		this.#commands = commands;
	}

	get #dir(): Uri {
		if (this instanceof Module) {
			return Uri.joinPath(this.uri, '..');
		}
		return this.uri;
	}

	contains(uri: Uri) {
		const a = this.#dir.fsPath;
		const b = uri.fsPath;
		return b === a || b.startsWith(`${a}/`);
	}

	resolvePackage(pkg: Commands.Package) {
		const item = new Package(this as any, pkg.Path, pkg.TestFiles!);
		this.#requested.set(pkg.Path, item);
		return item;
	}

	async getChildren(): Promise<GoTestItem[] | undefined> {
		const mode = this.#workspace.getConfiguration('goExp', this.uri).get<DiscoveryMode>('testExplorer.discovery');
		switch (mode) {
			case 'on': // Discover all packages
				return Package.resolve(
					await this.#commands.packages({
						Files: [this.#dir.toString()],
						Mode: 1,
						Recursive: true
					})
				).map((x) => new Package(this as any, x.Path, x.TestFiles!));

			default: // Return only specifically requested packages
				return [...this.#requested.values()];
		}
	}
}

class Module extends RootItem implements GoTestItem {
	readonly uri: Uri;
	readonly path: string;
	readonly kind = 'module';
	readonly hasChildren = true;

	constructor(workspace: Workspace, commands: Commands, mod: Commands.Module) {
		super(workspace, commands);
		this.uri = Uri.parse(mod.GoMod);
		this.path = mod.Path;
	}

	get label() {
		return this.path;
	}
}

class WorkspaceItem extends RootItem implements GoTestItem {
	readonly uri: Uri;
	readonly label: string;
	readonly kind = 'module';
	readonly hasChildren = true;

	constructor(workspace: Workspace, commands: Commands, uri: Uri, label: string) {
		super(workspace, commands);
		this.uri = uri;
		this.label = label;
	}
}

class Package implements GoTestItem {
	static resolve({ Packages: all = [] }: Commands.PackagesResults) {
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

	readonly parent: Module | WorkspaceItem;
	readonly uri: Uri;
	readonly label: string;
	readonly kind = 'package';
	readonly hasChildren = true;
	readonly files: TestFile[];

	constructor(parent: Module | WorkspaceItem, path: string, files: Commands.TestFile[]) {
		this.parent = parent;
		this.label =
			parent instanceof Module && path.startsWith(`${parent.path}/`)
				? path.substring(parent.path.length + 1)
				: path;
		this.uri = Uri.joinPath(Uri.parse(files[0].URI), '..');
		this.files = files.filter((x) => x.Tests.length).map((x) => new TestFile(this, x));
	}

	getChildren(): GoTestItem[] {
		return this.files;
	}
}

class TestFile implements GoTestItem {
	readonly parent: Package;
	readonly uri: Uri;
	readonly kind = 'file';
	readonly hasChildren = true;
	readonly tests: TestCase[];

	constructor(pkg: Package, file: Commands.TestFile) {
		this.parent = pkg;
		this.uri = Uri.parse(file.URI);
		this.tests = file.Tests.map((x) => new TestCase(this, x));
	}

	get label() {
		return path.basename(this.uri.fsPath);
	}

	getChildren(): GoTestItem[] {
		return this.tests;
	}
}

class TestCase implements GoTestItem {
	readonly parent: TestFile;
	readonly uri: Uri;
	readonly kind: GoTestItem.Kind;
	readonly name: string;
	readonly range: Range | undefined;
	readonly hasChildren = false;
	// TODO: subtests

	constructor(file: TestFile, test: Commands.TestCase) {
		this.parent = file;
		this.uri = Uri.parse(test.Loc.uri);
		this.name = test.Name;
		this.kind = test.Name.match(/^(Test|Fuzz|Benchmark|Example)/)![1].toLowerCase() as GoTestItem.Kind;

		const { start, end } = test.Loc.range;
		this.range = new Range(start.line, start.character, end.line, end.character);
	}

	get label() {
		return this.name;
	}

	getChildren(): GoTestItem[] {
		return [];
	}
}
