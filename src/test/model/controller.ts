import { Commands, Context } from '@/utils/testing';
import { pathContains } from '@/utils/util';
import path from 'node:path';
import { EventEmitter, Range, Uri } from 'vscode';
import { GoTestItem, ItemEvent } from '.';
import { WorkspaceConfig } from '../workspaceConfig';
import { DynamicTestCase, StaticTestCase } from './case';
import { TestFile } from './file';
import { Module } from './module';
import { Package } from './package';
import { ItemSet } from './set';
import { Workspace } from './workspace';

export class ModelController {
	readonly #didUpdate = new EventEmitter<ItemEvent<GoTestItem>[]>();

	readonly onDidUpdate = this.#didUpdate.event;
	readonly workspaces = new ItemSet<Workspace, Uri | { uri: Uri }>((x) => `${x instanceof Uri ? x : x.uri}`);

	readonly #context;
	readonly #config;

	constructor(context: Context, config: WorkspaceConfig) {
		this.#context = context;
		this.#config = config;
	}

	/**
	 * Populates the data model for the given scope by querying gopls. If
	 * {@link scope} is undefined, the workspace roots are used as the scope.
	 *
	 * {@link onDidUpdate} fires synchronously during this call for each item
	 * that was added, removed, or modified. Subscribers should expect to be
	 * called inline, not in a subsequent microtask.
	 *
	 * @param scope - The item to populate. If omitted, populates all workspace
	 *   roots. Otherwise, populates the given item and, if
	 *   {@link options.recurse} is true (the default), its descendants.
	 */
	async populate(scope?: Workspace | Module | Package): Promise<void> {
		if (!scope) {
			await this.#loadRoots();
			return;
		}

		switch (scope.kind) {
			case 'workspace':
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
				yield { item: mod, type: 'added' };
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
					yield { item: pkg, type: 'removed' };
				}
				continue;
			}

			// Create a new Package if necessary.
			if (pkg) {
				yield { item: pkg, type: 'modified' };
			} else {
				pkg = new Package(root, src, r.Module?.[src.ModulePath as string]);
				root.packages.add(pkg);
				yield { item: pkg, type: 'added' };
			}

			// Update the package's files.
			yield* this.#updateFiles(pkg, src.TestFiles, { [`${uri}`]: opts.modified });
			resolved.push(...[...pkg.files].filter((x) => `${x.uri}` === `${uri}`));
		}
	}

	workspaceFor(uri: Uri) {
		const wsf = this.#context.workspace.getWorkspaceFolder(uri);
		if (!wsf) return;

		// Resolve or create a Workspace.
		let ws = this.workspaces.get(wsf);
		if (!ws) {
			ws = new Workspace(wsf);
			this.workspaces.add(ws);
		}

		// If the path is excluded, ignore it.
		const config = this.#config.for(ws);
		const exclude = config.exclude.get() || [];
		const rel = path.relative(ws.uri.fsPath, uri.fsPath);
		if (exclude.some((x) => x.match(rel))) return;

		return ws;
	}

	/**
	 * Updates the list of workspaces, and loads the modules of each workspace.
	 */
	async #loadRoots() {
		// Update the workspace item set.
		this.workspaces.update(this.#context.workspace.workspaceFolders ?? [], (ws) => new Workspace(ws));

		// Update the workspaces' modules list.
		await Promise.all([...this.workspaces].map(async (ws) => this.#loadModules(ws)));
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
}
