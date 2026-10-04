import path from 'node:path';
import { type Event, EventEmitter, type Location, type Range, type TestRun, Uri, type WorkspaceFolder } from 'vscode';

import { Commands, type Context } from '@/utils/common';
import { Disposer } from '@/utils/disposable';
import { MapWithDefault, WeakMapWithDefault } from '@/utils/map';
import { pathContains } from '@/utils/util';

import { type GoTestItem, type ItemEvent } from '.';
import { type WorkspaceConfig } from '../config';
import { type RunEvent } from '../run/controller';
import { DynamicTestCase, StaticTestCase, type TestCase } from './case';
import { TestFile } from './file';
import { Module } from './module';
import { Package } from './package';
import { ItemSet } from './set';
import { Workspace } from './workspace';

export class ModelController extends Disposer {
	readonly #didUpdate = new EventEmitter<ItemEvent<GoTestItem>[]>();
	readonly #testRuns = new WeakMapWithDefault((_: TestRun) => new Set<DynamicTestCase>());

	readonly onDidUpdate = this.#didUpdate.event;
	readonly workspaces = new ItemSet<Workspace>();

	readonly #context;
	readonly #config;

	constructor(context: Context, config: WorkspaceConfig, runEvents: Event<RunEvent>) {
		super();
		this.#context = context;
		this.#config = config;
		this.disposeOf = runEvents((e) => this.#onRunEvent(e));
	}

	/**
	 * Returns the {@link Workspace} for the given URI or workspace folder,
	 * creating one if it doesn't exist yet. Returns `undefined` if called with
	 * a URI that is not within any workspace, or if the workspace is excluded.
	 */
	workspaceFor(uri: Uri): Workspace | undefined;
	workspaceFor(wsf: WorkspaceFolder): Workspace;
	workspaceFor(uri: Uri | WorkspaceFolder) {
		let wsf: WorkspaceFolder | undefined;
		if (uri instanceof Uri) {
			wsf = this.#context.workspace.getWorkspaceFolder(uri);
			if (!wsf) return;
		} else {
			wsf = uri;
			uri = wsf.uri;
		}

		// Resolve or create a Workspace.
		let ws = this.workspaces.get(Workspace.keyOf(wsf));
		if (!ws) {
			ws = new Workspace(wsf);
			this.workspaces.add(ws);
			this.#didUpdate.fire([{ type: 'added', item: ws }]);
		}

		// If the path is excluded, ignore it.
		const config = this.#config.for(ws);
		const exclude = config.exclude.get() || [];
		const rel = path.relative(ws.uri.fsPath, uri.fsPath);
		if (exclude.some((x) => x.match(rel))) return;

		return ws;
	}

	findTest(pkg: Package, query: Location | string): TestCase | undefined {
		if (typeof query === 'string') {
			return pkg.findTest(query);
		}

		const file = pkg.files.get(`${query.uri}`);
		if (!file) return;

		for (const test of file.allTests()) {
			if (test.range && test.range.contains(query.range)) {
				return test;
			}
		}
	}

	/**
	 * Populates the data model for the given scope by querying gopls. If
	 * {@link scope} is undefined, the workspace roots are used as the scope.
	 *
	 * {@link onDidUpdate} fires synchronously during this call for each item
	 * that was added, removed, or modified. Subscribers should expect to be
	 * called inline, not in a subsequent microtask.
	 */
	async populate(scope: Workspace | Module | Package): Promise<void> {
		switch (scope.kind) {
			case 'workspace':
				await this.#loadModules(scope);
				await this.#loadPackages(scope);
				return;

			case 'module':
				await this.#loadPackages(scope);
				return;

			case 'package':
				await this.#loadTests(scope);
				return;
		}
	}

	async updateFile(uri: Uri, opts: { modified?: Range[] } = {}) {
		const resolved: TestFile[] = [];
		const updates: ItemEvent[] = [];
		for await (const update of this.#updateFile(uri, resolved, opts)) {
			updates.push(update);
		}
		this.#didUpdate.fire(updates);
		return resolved;
	}

	async *#updateFile(
		uri: Uri,
		resolved: TestFile[],
		opts: { modified?: Range[] },
	): AsyncGenerator<ItemEvent, void, unknown> {
		// We don't handle external files (those outside of a workspace).
		const ws = this.workspaceFor(uri);
		if (!ws) return;

		// Query gopls.
		const r = await this.#context.commands.packages({
			Files: [`${uri}`],
			Mode: Commands.PackagesMode.NeedTests,
		});
		const packages = this.#consolidatePackages(ws, r);

		// Map modules.
		const mods = new Map<string, Module>();
		const config = this.#config.for(ws);
		const exclude = config.exclude.get() || [];
		for (const src of Object.values(r.Module ?? {})) {
			// If the path is outside of the workspace, ignore it.
			const uri = Uri.parse(src.GoMod);
			if (!pathContains(ws.uri, uri)) continue;

			// If the path is excluded, ignore it.
			const relDir = path.relative(ws.uri.fsPath, path.dirname(uri.fsPath));
			if (exclude.some((x) => x.match(relDir))) continue;

			// Get or create the module.
			let mod = ws.modules.get(Module.keyOf(src));
			if (!mod) {
				mod = new Module(ws, src);
				ws.modules.add(mod);
				yield { item: mod, type: 'added', to: ws };
			}
			mods.set(src.Path, mod);
		}

		// Process packages. An alternative build system may allow a file to be
		// part of multiple packages, so we can't assume there's only one
		// package.
		for (const src of packages) {
			// Get the workspace or module for this package. If the package is
			// part of a module but that module is not part of this workspace,
			// use the workspace as the root.
			let root: Workspace | Module = ws;
			if (src.ModulePath) {
				root = mods.get(src.ModulePath) ?? ws;
			}

			// Get the existing package.
			let pkg = root.packages.get(Package.keyOf(src));

			// If a package doesn't have tests, that probably means the last
			// test was removed, so we should remove it.
			if (src.TestFiles.length === 0) {
				if (pkg) {
					// Remove it from the workspace or module and notify listeners.
					root.packages.remove(pkg);
					yield { item: pkg, type: 'removed', from: root };
				}
				continue;
			}

			// Create a new Package if necessary.
			if (pkg) {
				yield { item: pkg, type: 'modified' };
			} else {
				pkg = new Package(root, src, r.Module?.[src.ModulePath as string]);
				root.packages.add(pkg);
				yield { item: pkg, type: 'added', to: root };
			}

			// Update the package's files.
			yield* this.#updateFiles(pkg, src.TestFiles, { [`${uri}`]: opts.modified });
			resolved.push(...[...pkg.files].filter((x) => `${x.uri}` === `${uri}`));
		}
	}

	/**
	 * Updates the modules of a workspace.
	 */
	async #loadModules(ws: Workspace) {
		const { Modules } = await this.#context.commands.modules({
			Dir: `${ws.uri}`,
			MaxDepth: -1,
		});
		if (!Modules) return;

		const config = this.#config.for(ws);
		const exclude = config.exclude.get() || [];
		const updates = ws.modules.update(
			Modules.filter((m) => {
				const uri = Uri.parse(m.GoMod);
				const p = path.relative(ws.uri.fsPath, path.dirname(uri.fsPath));
				return !exclude.some((x) => x.match(p));
			}),
			(src) => new Module(ws, src),
		);

		this.#didUpdate.fire(updates);
	}

	/**
	 * Loads the packages of a workspace or module.
	 */
	async #loadPackages(root: Workspace | Module) {
		// TODO(ethan.reesor): We could improve performance (I think) with a
		// "list test files but not tests" mode. If that happens, we need to:
		//  - Change the Mode of the gopls query.
		//  - Don't exclude packages with no files?
		//  - Stop calling #updateFiles.

		// Query gopls.
		const r = await this.#context.commands.packages({
			Files: [`${root.dir}`],
			Recursive: true,
			Mode: Commands.PackagesMode.NeedTests,
		});

		// Consolidate `foo` and `foo_test`.
		const ws = root instanceof Workspace ? root : root.workspace;
		const packages = this.#consolidatePackages(ws, r).filter((x) => x.TestFiles.length > 0);

		// Update.
		const updates = root.packages.update(
			packages,
			(src) => new Package(root, src, r.Module?.[src.ModulePath as string]),
			(src, pkg) => this.#updateFiles(pkg, src.TestFiles),
		);

		// Notify the provider that we updated the workspace/module's packages.
		this.#didUpdate.fire(updates);
	}

	/**
	 * Loads the tests (and files) of a package.
	 */
	async #loadTests(pkg: Package) {
		// Query gopls.
		const { Packages } = await this.#context.commands.packages({
			Files: [`${pkg.uri}`],
			Mode: Commands.PackagesMode.NeedTests,
		});
		if (!Packages) return [];

		// Update files and their tests.
		const updates = this.#updateFiles(
			pkg,
			Packages.flatMap((x) => x.TestFiles ?? []),
		);
		this.#didUpdate.fire(updates);
	}

	/**
	 * Updates the files and tests of a package using the provided data.
	 */
	#updateFiles(pkg: Package, files: Commands.TestFile[], ranges?: Record<string, Range[] | undefined>) {
		return pkg.files.update(
			files.filter((x) => x.Tests && x.Tests.length > 0),
			(src) => new TestFile(pkg, src),
			(src, file) => this.#updateTests(file, src.Tests ?? [], ranges?.[`${file.uri}`]),
		);
	}

	/**
	 * Updates the tests of a file. gopls reports tests as a flat list in which
	 * static subtests are named `TestFoo/bar`; this nests each test under its
	 * nearest parent in the list (or the file, if it has none).
	 */
	#updateTests(file: TestFile, tests: Commands.TestCase[], ranges?: Range[]) {
		const names = new Set(tests.map((x) => x.Name));
		const children = new MapWithDefault<string | undefined, Commands.TestCase[]>(() => []);
		for (const test of tests) {
			children.get(parentNameIn(names, test.Name)).push(test);
		}

		const update = (parent: TestFile | TestCase, name?: string): ItemEvent<TestCase>[] =>
			parent.tests.update(
				children.get(name),
				(src) => new StaticTestCase(parent, src),
				(src, test) => [
					...(test instanceof StaticTestCase ? test.update(src, ranges) : []),
					...update(test, src.Name),
				],
				// Don't erase dynamic test cases.
				(test) => test instanceof DynamicTestCase,
			);
		return update(file);
	}

	/**
	 * Consolidates test and source package data from gopls and filters out
	 * excluded packages.
	 *
	 * If a directory contains `foo.go`, `foo_test.go`, and `foo2_test.go` with
	 * package directives `foo`, `foo`, and `foo_test`, respectively, gopls will
	 * report those as three separate packages. This function consolidates them
	 * into a single package.
	 */
	#consolidatePackages(ws: Workspace, { Packages: all = [] }: Commands.PackagesResults) {
		if (!all) return [];

		const exclude = this.#config.for(ws).exclude.get() || [];
		const paths = new Set(all.map((x) => x.ForTest || x.Path));
		const results: (Commands.Package & Required<Pick<Commands.Package, 'TestFiles'>>)[] = [];
		for (const pkgPath of paths) {
			const pkgs = all.filter((x) => x.Path === pkgPath || x.ForTest === pkgPath);
			const files = pkgs
				.flatMap((x) => x.TestFiles ?? [])
				.filter((m) => {
					const p = path.relative(ws.dir.fsPath, Uri.parse(m.URI).fsPath);
					return !exclude.some((x) => x.match(p));
				});

			results.push({
				Path: pkgPath,
				ModulePath: pkgs[0].ModulePath,
				TestFiles: files,
			});
		}
		return results;
	}

	#onRunEvent(event: RunEvent) {
		switch (event.type) {
			case 'start': {
				// Delete dynamic test cases if their parents are being executed
				const { pkg, include, exclude } = event;
				this.#removeDynamicTests(pkg, (test) => {
					const included = include && covers(include, test);
					const excluded = exclude && covers(exclude, test);

					// Leave the test if it IS included ITSELF.
					if (included === test) return false;

					// Leave the test if it IS NOT included THROUGH AN ANCESTOR.
					if (include && !included) return false;

					// Leave the test if it or any ancestor is excluded.
					if (excluded) return false;

					// Remove the test - the parent that defined it will run,
					// either because all package tests are being run
					// unconditionally, or because the parent or an ancestor is
					// explicitly included, and neither the test nor any of its
					// ancestors are excluded.
					return true;
				});
				break;
			}

			case 'subtest': {
				// If there's an existing test, update it's test run association
				// and return.
				const { pkg, run, name } = event;
				const test = this.findTest(pkg, name);
				if (test) {
					if (test instanceof DynamicTestCase) {
						this.#testRuns.get(run).add(test);
					}
					return;
				}

				// Otherwise, find the correct parent and give it a new subtest.
				const parent = pkg.findParent(name);
				if (!parent) break;

				const child = new DynamicTestCase(parent, name);
				parent.tests.add(child);
				this.#testRuns.get(run).add(child);
				this.#didUpdate.fire([{ item: child, type: 'added', to: parent }]);
				break;
			}

			case 'disposed': {
				const tests = this.#testRuns.get(event.run);
				if (tests.size === 0) return;
				this.#removeDynamicTests(event.pkg, (test) => tests.has(test));
				break;
			}
		}
	}

	/**
	 * Removes dynamic tests matching the predicate, along with their subtrees.
	 * Emits a `removed` event for every test removed, parents first.
	 */
	#removeDynamicTests(pkg: Package, predicate: (test: DynamicTestCase) => boolean): void {
		const updates: ItemEvent<TestCase>[] = [];
		const visit = (parent: TestFile | TestCase) => {
			for (const test of [...parent.tests]) {
				if (test instanceof DynamicTestCase && predicate(test)) {
					parent.tests.remove(test);
					for (const removed of [test, ...test.allTests()]) {
						updates.push({ item: removed, type: 'removed', from: removed.parent });
					}
				} else {
					visit(test);
				}
			}
		};
		for (const file of pkg.files) visit(file);

		// Notify listeners.
		this.#didUpdate.fire(updates);
	}
}

/**
 * Determines whether the set contains the test or an ancestor of the test.
 */
function covers(set: Set<TestCase>, test: TestCase) {
	for (;;) {
		if (set.has(test)) return test;
		if (test.parent.kind === 'file') return;
		test = test.parent;
	}
}

/**
 * Returns the longest proper prefix of `name` (split on `/`) that is in
 * `names`, or undefined if there is none.
 */
function parentNameIn(names: Set<string>, name: string): string | undefined {
	for (let i = name.lastIndexOf('/'); i > 0; i = name.lastIndexOf('/', i - 1)) {
		const prefix = name.substring(0, i);
		if (names.has(prefix)) return prefix;
	}
}
