import { Commands, Context } from '@/utils/common';
import { Disposer } from '@/utils/disposable';
import { WeakMapWithDefault } from '@/utils/map';
import { pathContains } from '@/utils/util';
import path from 'node:path';
import { Event, EventEmitter, Location, Range, TestRun, Uri, WorkspaceFolder } from 'vscode';
import { GoTestItem, ItemEvent } from '.';
import { RunEvent } from '../run/runEvent';
import { WorkspaceConfig } from '../workspaceConfig';
import { DynamicTestCase, StaticTestCase, TestCase } from './case';
import { TestFile } from './file';
import { Module } from './module';
import { Package } from './package';
import { ItemSet } from './set';
import { Workspace } from './workspace';

export class ModelController extends Disposer {
	readonly #didUpdate = new EventEmitter<ItemEvent<GoTestItem>[]>();
	readonly #testRuns = new WeakMapWithDefault((_: TestRun) => new Set<DynamicTestCase>());

	readonly onDidUpdate = this.#didUpdate.event;
	readonly workspaces = new ItemSet<Workspace, Uri | { uri: Uri }>((x) => `${x instanceof Uri ? x : x.uri}`);

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
		let ws = this.workspaces.get(wsf);
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
			for (const file of pkg.files) {
				const test = file.tests.get(query);
				if (test) return test;
			}
			return;
		}

		const file = pkg.files.get(`${query.uri}`);
		if (!file) return;

		for (const test of file.tests) {
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
			let mod = ws.modules.get(src.Path);
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
			let pkg = root.packages.get(src);

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
			(src, file) =>
				file.tests.update(
					src.Tests ?? [],
					(src) => new StaticTestCase(file, src),
					(src, test) => (test instanceof StaticTestCase ? test.update(src, ranges?.[`${file.uri}`]) : []),
					// Don't erase dynamic test cases.
					(test) => test instanceof DynamicTestCase,
				),
		);
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
				parent.file.tests.add(child);
				this.#testRuns.get(run).add(child);
				this.#didUpdate.fire([{ item: child, type: 'added', to: parent.file }]);
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

	#removeDynamicTests(pkg: Package, predicate: (test: DynamicTestCase) => boolean): void {
		// Find all the directly matching dynamic test cases.
		const toRemove = new Set(
			[...pkg.files]
				.flatMap((file) => [...file.tests])
				.filter((test) => test instanceof DynamicTestCase && predicate(test)),
		);

		// Find all their children.
		const prefixes = [...toRemove].map((x) => `${x.name}/`);
		for (const file of pkg.files) {
			for (const test of file.tests) {
				if (test instanceof DynamicTestCase && prefixes.some((x) => test.name.startsWith(x))) {
					toRemove.add(test);
				}
			}
		}

		// Remove them.
		const updates: ItemEvent<TestCase>[] = [];
		for (const test of toRemove) {
			test.file.tests.remove(test);
			updates.push({ item: test, type: 'removed', from: test.file });
		}

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

		const i = test.name.lastIndexOf('/');
		if (i < 0) return;
		const name = test.name.substring(0, i);

		const parent = [...test.file.tests].find((t) => t.name === name);
		if (!parent) return;
		test = parent;
	}
}
