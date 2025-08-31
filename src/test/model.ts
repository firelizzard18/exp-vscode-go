import { ConfigurationChangeEvent, Range, TestRun, Uri, WorkspaceFolder } from 'vscode';
import { Commands, Context } from '../utils/testing';
import { ItemEvent, ItemSet } from './itemSet';
import deepEqual from 'deep-equal';
import { RelationMap } from './relationMap';
import path from 'node:path';
import { ProfileContainer } from './profile';
import { WorkspaceConfig } from './workspaceConfig';

export type GoTestItem = Module | Workspace | Package | TestFile | TestCase;

export class GoTestItemProvider {
	readonly #context;
	readonly #pkgRel = new RelationMap<Package, Package | undefined>();
	readonly #testRel = new RelationMap<TestCase, TestCase | undefined>();
	readonly #items = new Map<string, GoTestItem>();
	readonly #roots = new ItemSet<Workspace>();
	readonly #requested = new Set<string>();
	readonly #config = new WeakMap<Workspace, WorkspaceConfig>();

	constructor(context: Context) {
		this.#context = context;
	}

	didChangeConfiguration(e: ConfigurationChangeEvent) {
		// Invalidate cached configuration values for all workspaces. It would
		// be better to directly iterate over the config cache, but weak maps
		// can't be iterated.
		for (const ws of this.#roots) {
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
				const pkgParent = this.#pkgRel.getParent(item);
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
				return this.#pkgRel.getParent(item) || item.parent;
			}

			case 'file': {
				if (item.package.isRootPkg) {
					return this.getParent(item.package);
				}
				return item.package;
			}

			default: {
				const config = this.#configFor(item);
				const parentTest = config.nestSubtests.get() && this.#testRel.getParent(item);
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
			for (const ws of this.#roots) {
				// If the workspace has discovery disabled and has _not_
				// been requested (e.g. by opening a file), skip it.
				const mode = this.#configFor(ws).discovery.get();
				if (mode !== 'on' && this.#requested.has(`${ws.uri}`)) {
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
					children.push(...(this.#pkgRel.getChildren(item) || []));
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
					return [...item.tests].filter((x) => !this.#testRel.getParent(x));
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
					children.push(...(this.#testRel.getChildren(item) || []));
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
		this.#roots.update(
			this.#context.workspace.workspaceFolders,
			(ws) => `${ws.uri}`,
			(ws) => new Workspace(ws),
			() => [], // Nothing to update
		);

		// Query gopls.
		const results = await Promise.all(
			[...this.#roots].map(async (ws) => {
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
			ws.update(
				Modules.filter((m) => {
					const p = path.relative(ws.uri.fsPath, m.Path);
					return !exclude.some((x) => x.match(p));
				}),
			);
		}
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

	get root(): Uri {
		return this.ws.uri;
	}

	get key() {
		return `${this.uri}`;
	}

	update(modules: Commands.Module[]) {
		this.modules.update(
			modules,
			(x) => x.Path,
			(x) => new Module(this, this.uri, x),
			() => [], // Nothing to update
		);
	}
}

export class Module {
	readonly kind = 'module';
	readonly root;
	readonly uri;
	readonly path;
	readonly workspace;
	readonly packages = new ItemSet<Package>();

	constructor(workspace: Workspace, root: Uri, mod: Commands.Module) {
		this.workspace = workspace;
		this.root = root;
		this.uri = Uri.parse(mod.GoMod);
		this.path = mod.Path;
	}

	get dir(): Uri {
		return Uri.joinPath(this.uri, '..');
	}

	get key() {
		return this.path;
	}
}

export class Package {
	readonly kind = 'package';
	readonly parent;
	readonly uri;
	readonly path;
	readonly files = new ItemSet<TestFile>();
	readonly testRelations = new RelationMap<TestCase, TestCase | undefined>();

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
		// Apply the update
		const changes = this.files.update(
			src.TestFiles!.filter((x) => x.Tests.length),
			(src) => src.URI,
			(src) => new TestFile(this, src),
			(src, file) => file.update(src, ranges[`${file.uri}`] || []),
		);
		if (!changes.length) {
			return [];
		}

		// Recalculate test-subtest relations
		const allTests = Array.from(this.allTests());
		this.testRelations.replace(
			allTests.map((test): [TestCase, TestCase | undefined] => [test, findParentTestCase(allTests, test.name)]),
		);
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

	/**
	 * Create a new {@link DynamicTestCase} as a child of this test case.
	 */
	addTestCase(name: string, run: TestRun) {
		const child = new DynamicTestCase(this, name, run);
		this.file.tests.add(child);
		this.file.package.testRelations.add(this, child);
		return child;
	}

	/**
	 * Deletes all {@link DynamicTestCase}s that are children of this test case.
	 * If a test run is specified, only items from that run are removed.
	 * @returns The items that should be reloaded.
	 */
	abstract removeTestCases(run?: TestRun): Iterable<TestCase>;
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

	*removeTestCases(run?: TestRun) {
		const children = this.file.package.testRelations.getChildren(this) ?? [];
		for (const child of children) {
			yield* child.removeTestCases(run);
		}
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

	*removeTestCases(run?: TestRun) {
		// If `run` is specified, only remove this case if it belongs to `run`
		if (run && run !== this.run) {
			return;
		}

		// This item's parent should be refreshed.
		const rel = this.file.package.testRelations;
		yield rel.getParent(this)!;

		// Remove children.
		const children = rel.getChildren(this) ?? [];
		for (const child of children) {
			for (const _ of child.removeTestCases(run)) {
				// Discard
			}
		}

		// Remove this item.
		this.file.tests.remove(this);
		rel.removeChild(this);
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
