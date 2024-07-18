/* eslint-disable @typescript-eslint/no-namespace */
import { MarkdownString, Range, Uri } from 'vscode';
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

export class GoTestItemProvider implements TestItemProvider<GoTestItem> {
	readonly #workspace: Workspace;
	readonly #commands: Commands;

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

		const items: GoTestItem[] = [];
		for (const ws of this.#workspace.workspaceFolders || []) {
			const { Modules } = await this.#commands.modules({ Dir: ws.uri.toString(), MaxDepth: -1 });
			if (Modules?.length) {
				items.push(...Modules.map((x) => new Module(this.#commands, x)));
			} else {
				items.push(new WorkspaceItem(this.#commands, ws.uri, ws.name));
			}
		}
		return items;
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

	getChildren(): GoTestItem[] | Thenable<GoTestItem[]>;
}

class Module implements GoTestItem {
	readonly uri: Uri;
	readonly path: string;
	readonly kind = 'module';
	readonly hasChildren = true;

	readonly #commands: Commands;

	constructor(commands: Commands, mod: Commands.Module) {
		this.uri = Uri.parse(mod.GoMod);
		this.path = mod.Path;
		this.#commands = commands;
	}

	get label() {
		return this.path;
	}

	async getChildren(): Promise<GoTestItem[]> {
		return await Package.resolve(
			this,
			this.#commands.packages({
				Files: [Uri.joinPath(this.uri, '..').toString()],
				Mode: 1,
				Recursive: true
			})
		);
	}
}

class WorkspaceItem implements GoTestItem {
	readonly uri: Uri;
	readonly label: string;
	readonly kind = 'module';
	readonly hasChildren = true;

	readonly #commands: Commands;

	constructor(commands: Commands, uri: Uri, label: string) {
		this.uri = uri;
		this.label = label;
		this.#commands = commands;
	}

	async getChildren(): Promise<GoTestItem[]> {
		return await Package.resolve(
			this,
			this.#commands.packages({
				Files: [this.uri.toString()],
				Mode: 1,
				Recursive: true
			})
		);
	}
}

class Package implements GoTestItem {
	static async resolve(parent: Module | WorkspaceItem, p: Thenable<Commands.PacakgesResults>) {
		const { Packages = [] } = await p;

		// Consolidate `foo` and `foo_test` into a single Package
		const paths = new Set(Packages.filter((x) => x.TestFiles).map((x) => x.ForTest || x.Path));
		const children: Package[] = [];
		for (const path of paths) {
			const files = Packages.filter((x) => x.Path === path || x.ForTest === path).flatMap(
				(x) => x.TestFiles || []
			);
			if (!files.length) {
				continue;
			}

			children.push(new Package(parent, path, files));
		}
		return children;
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
	readonly package: Package;
	readonly uri: Uri;
	readonly kind = 'file';
	readonly hasChildren = true;
	readonly tests: TestCase[];

	constructor(pkg: Package, file: Commands.TestFile) {
		this.package = pkg;
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
	readonly file: TestFile;
	readonly uri: Uri;
	readonly kind: GoTestItem.Kind;
	readonly name: string;
	readonly range: Range | undefined;
	readonly hasChildren = false;
	// TODO: subtests

	constructor(file: TestFile, test: Commands.TestCase) {
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

	getChildren(): GoTestItem[] {
		return [];
	}
}
