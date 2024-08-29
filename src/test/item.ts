/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-namespace */
import { Uri, Range } from 'vscode';
import type { MarkdownString, ProviderResult, WorkspaceFolder } from 'vscode';
import { Commands } from './testing';
import path from 'path';
import { TestConfig } from './config';
import { Commander } from './commander';

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

	readonly #config: TestConfig;
	readonly #commander: Commander;
	readonly #requested = new Map<string, Package>();

	pkgRelations?: RelationMap<Package, Package | undefined>;

	constructor(config: TestConfig, retriever: Commander) {
		this.#config = config;
		this.#commander = retriever;
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

	markRequested(pkg: Commands.Package) {
		const item = new Package(this.#config, this as any, pkg.Path, pkg.TestFiles!);
		this.#requested.set(pkg.Path, item);
	}

	getParent() {
		return null;
	}

	async getChildren(): Promise<GoTestItem[]> {
		const packages = await this.#getPackages();
		const i = packages.findIndex((x) => x.uri.toString() === this.dir.toString());
		if (i < 0) return packages;

		const selfPkg = packages[i];
		packages.splice(i, 1);
		return [...packages, ...selfPkg.getChildren()];
	}

	async #getPackages() {
		const packages = await this.allPackages();

		// Rebuild package relations
		this.pkgRelations = undefined;
		if (this.#config.nestPackages()) {
			this.pkgRelations = new RelationMap(
				packages.map((pkg): [Package, Package | undefined] => {
					const ancestors = packages.filter((x) => pkg.path.startsWith(`${x.path}/`));
					ancestors.sort((a, b) => a.path.length - b.path.length);
					return [pkg, ancestors[0]];
				})
			);
		}

		return this.pkgRelations?.getChildren(undefined) || packages;
	}

	async allPackages() {
		const mode = this.#config.discovery();
		switch (mode) {
			case 'on': // Discover all packages
				return Package.resolve(
					await this.#commander.getPackages({
						Files: [this.dir.toString()],
						Mode: 1,
						Recursive: true
					})
				).map((x) => new Package(this.#config, this as any, x.Path, x.TestFiles!));

			default: // Return only specifically requested packages
				return [...this.#requested.values()];
		}
	}
}

export class Module extends RootItem implements GoTestItem {
	readonly uri: Uri;
	readonly path: string;
	readonly kind = 'module';

	constructor(config: TestConfig, retriever: Commander, mod: Commands.Module) {
		super(config, retriever);
		this.uri = Uri.parse(mod.GoMod);
		this.path = mod.Path;
	}

	get label() {
		return this.path;
	}
}

export class WorkspaceItem extends RootItem implements GoTestItem {
	readonly ws: WorkspaceFolder;
	readonly kind = 'workspace';

	constructor(config: TestConfig, retriever: Commander, ws: WorkspaceFolder) {
		super(config, retriever);
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

	readonly #config: TestConfig;
	readonly parent: RootItem;
	readonly uri: Uri;
	readonly path: string;
	readonly kind = 'package';
	readonly hasChildren = true;
	readonly files: TestFile[];

	testRelations?: RelationMap<TestCase, TestCase | undefined>;

	constructor(config: TestConfig, parent: RootItem, path: string, files: Commands.TestFile[]) {
		this.#config = config;
		this.parent = parent;
		this.path = path;
		this.uri = Uri.joinPath(Uri.parse(files[0].URI), '..');
		this.files = files.filter((x) => x.Tests.length).map((x) => new TestFile(this.#config, this, x));
	}

	get label() {
		const pkgParent = this.parent.pkgRelations?.getParent(this);
		if (pkgParent && this.#config.nestPackages()) {
			return this.path.substring(pkgParent.path.length + 1);
		}
		if (this.parent instanceof Module && this.path.startsWith(`${this.parent.path}/`)) {
			return this.path.substring(this.parent.path.length + 1);
		}
		return this.path;
	}

	getParent() {
		if (!this.#config.nestPackages()) {
			return this.parent;
		}
		return this.parent.pkgRelations?.getParent(this) || this.parent;
	}

	getChildren(): GoTestItem[] {
		if (!this.#config.nestPackages()) {
			return this.#getTests();
		}

		return [...(this.parent.pkgRelations?.getChildren(this) || []), ...this.#getTests()];
	}

	/**
	 * Returns the {@link TestCase} or {@link TestFile} children of this package, depending
	 * on configuration.
	 */
	#getTests() {
		// Rebuild test relations
		this.testRelations = undefined;
		if (this.#config.nestSubtests()) {
			const allTests = this.allTests();
			this.testRelations = new RelationMap(
				allTests.map((test): [TestCase, TestCase | undefined] => {
					const i = test.name.lastIndexOf('/');
					if (i < 0) return [test, undefined];
					const name = test.name.substring(0, i);
					const parent = allTests.find((x) => x.name === name);
					return [test, parent];
				})
			);
		}

		if (this.#config.showFiles()) {
			return this.files;
		}
		return this.files.flatMap((x) => x.getChildren());
	}

	/**
	 * Returns all of the package's tests, ignoring configuration.
	 */
	allTests() {
		return this.files.flatMap((x) => x.allTests());
	}
}

export class TestFile implements GoTestItem {
	readonly #config: TestConfig;
	readonly package: Package;
	readonly uri: Uri;
	readonly kind = 'file';
	readonly hasChildren = true;
	readonly tests: TestCase[];

	constructor(config: TestConfig, pkg: Package, file: Commands.TestFile) {
		this.#config = config;
		this.package = pkg;
		this.uri = Uri.parse(file.URI);
		this.tests = file.Tests.map((x) => new TestCase(this.#config, this, x));
	}

	get label() {
		return path.basename(this.uri.fsPath);
	}

	getParent() {
		return this.package;
	}

	getChildren(): GoTestItem[] {
		return this.package.testRelations?.getChildren(undefined) || this.tests;
	}

	/**
	 * Returns all of the file's tests, ignoring configuration.
	 */
	allTests() {
		return this.tests;
	}
}

export class TestCase implements GoTestItem {
	readonly #config: TestConfig;
	readonly file: TestFile;
	readonly uri: Uri;
	readonly kind: GoTestItem.Kind;
	readonly name: string;
	readonly range: Range | undefined;

	constructor(config: TestConfig, file: TestFile, test: Commands.TestCase) {
		this.#config = config;
		this.file = file;
		this.uri = Uri.parse(test.Loc.uri);
		this.name = test.Name;
		this.kind = test.Name.match(/^(Test|Fuzz|Benchmark|Example)/)![1].toLowerCase() as GoTestItem.Kind;

		const { start, end } = test.Loc.range;
		this.range = new Range(start.line, start.character, end.line, end.character);
	}

	get label() {
		const parent = this.file.package.testRelations?.getParent(this);
		if (!parent) {
			return this.name;
		}
		return this.name.replace(`${parent.name}/`, '');
	}

	get hasChildren() {
		return this.getChildren().length > 0;
	}

	getParent() {
		const parentTest = this.file.package.testRelations?.getParent(this);
		if (parentTest) {
			return parentTest;
		}
		if (this.#config.showFiles()) {
			return this.file;
		}
		return this.file.package;
	}

	getChildren(): TestCase[] {
		return this.file.package.testRelations?.getChildren(this) || [];
	}
}

class RelationMap<Child, Parent> {
	readonly #childParent = new Map<Child, Parent>();
	readonly #parentChild = new Map<Parent, Child[]>();

	constructor(relations: Iterable<[Child, Parent]>) {
		for (const [child, parent] of relations) {
			this.#childParent.set(child, parent);
			if (this.#parentChild.has(parent)) {
				this.#parentChild.get(parent)?.push(child);
			} else {
				this.#parentChild.set(parent, [child]);
			}
		}
	}

	getParent(child: Child) {
		return this.#childParent.get(child);
	}

	getChildren(parent: Parent) {
		return this.#parentChild.get(parent);
	}
}
