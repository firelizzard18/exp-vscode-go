import { Range, TestItem, Uri, WorkspaceFolder } from 'vscode';
import { Commands, Context, TestController } from '../utils/testing';
import path from 'node:path';
import { WorkspaceConfig } from './workspaceConfig';
import { DynamicTestCase, GoTestItem, Module, Package, StaticTestCase, TestCase, TestFile, Workspace } from './model';
import { GoTestItemProvider } from './itemProvider';
import { EventEmitter } from '../utils/eventEmitter';
import { BiMap } from '../utils/map';

export class GoTestItemResolver {
	readonly #didChangeTestItem = new EventEmitter<(items: Iterable<GoTestItem>) => void>();
	readonly onDidChangeTestItem = this.#didChangeTestItem.event;
	readonly #didInvalidateTestResults = new EventEmitter<(items: Iterable<TestCase | TestFile>) => void>();
	readonly onDidInvalidateTestResults = this.#didInvalidateTestResults.event;

	readonly #context;
	readonly #config;
	readonly #provider;
	readonly #ctrl;
	readonly #items = new BiMap<TestItem, GoTestItem>();

	constructor(context: Context, config: WorkspaceConfig, provider: GoTestItemProvider, ctrl: TestController) {
		this.#context = context;
		this.#config = config;
		this.#provider = provider;
		this.#ctrl = ctrl;
	}

	/**
	 * Entry points:
	 * - config change
	 * - explorer
	 *   - resolve roots
	 *   - resolve children
	 *   - refresh all
	 *   - refresh item
	 * - file
	 *   - open
	 *   - modify
	 *   - create/delete
	 *   - code lens
	 * - runner
	 *   - view -> go for executing
	 *   - view -> go for logging
	 *     - may require resolving tests and/or creating dynamic subtests
	 */

	/**
	 * Update the view model. If `view` is null/undefined, the roots are
	 * updated. Otherwise the given item and it's children are updated.
	 */
	async updateViewModel(view?: TestItem | null, options: { recurse?: boolean } = {}) {
		const go = view && (await this.#update(view));
		if (view && !go) {
			this.#delete(view);
			return;
		}

		if (options.recurse) {
			// TODO: Do a full sync. This can be called when the user clicks
			// refresh, or when the config changes. In either case, determine
			// what view model nodes have already been expanded and synchronize
			// the two models.
		} else {
			// TODO: Go -> view model
		}
	}

	async didUpdateFile(wsf: WorkspaceFolder, file: Uri, ranges: Record<string, Range[]> = {}) {
		// Query gopls.
		const ws = this.#provider.getWorkspace(wsf);
		const packages = this.#consolidatePackages(
			ws,
			await this.#context.commands.packages({
				Files: [`${file}`],
				Mode: 1,
			}),
		);

		// A helper to get the root for a package. If the package belongs to a
		// module and there is no corresponding module, try reloading. Fallback
		// to the workspace, for example when the workspace is a subdirectory of
		// a module.
		let didReload = false;
		const getRoot = async (pkg: Commands.Package) => {
			if (!pkg.ModulePath) return ws;

			const mod = ws.modules.get(pkg.ModulePath);
			if (mod || didReload) return mod ?? ws;

			// Try reloading, maybe the module will appear.
			didReload = true;
			await this.resolveRoots();
			return ws.modules.get(pkg.ModulePath) ?? ws;
		};

		// Process packages. An alternative build system may allow a file to be
		// part of multiple packages, so we can't assume there's only one
		// package.
		const updated = [];
		const roots = new Set<Workspace | Module>([ws]);
		for (const src of packages) {
			// Sanity check.
			if (!src.TestFiles?.length) continue;

			// Get the workspace or module that owns this package.
			const root = await getRoot(src);
			roots.add(root);

			// Get or create the package.
			let pkg = root.packages.get(src);
			if (!pkg) {
				pkg = new Package(root, src);
				root.packages.add(pkg);
				updated.push({ item: pkg, type: 'added' });
			}

			// Update the package.
			updated.push(...pkg.update(src, ranges));

			// Mark the root and the package as requested.
			this.#provider.markRequested(root);
			this.#provider.markRequested(pkg);
		}

		// If anything changed, rebuild relations.
		if (updated.length > 0) {
			for (const root of roots) {
				this.#provider.rebuildRelations(root);
			}
		}

		return updated;
	}

	/**
	 * Updates the given view item, or the roots.
	 */
	async #update(view?: TestItem | null) {
		if (!view) {
			await this.#loadRoots();
			return;
		}

		const go = this.#items.get(view);
		if (!go) return;

		// Use gopls to update.
		switch (go.kind) {
			case 'workspace':
			case 'module':
				await this.#loadPackages(go);
				break;

			case 'package':
				await this.#loadTests(go);
				break;
		}

		return go;
	}

	/**
	 * Syncs the list of workspaces with VSCode's workspace folders and loads
	 * modules for each workspace.
	 */
	async #loadRoots() {
		// Update the workspace item set.
		this.#provider.updateWorkspaces(this.#context.workspace.workspaceFolders ?? []);

		// Query gopls.
		const results = await Promise.all(
			[...this.#provider.workspaces].map(async (ws) => {
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

			const config = this.#config.for(ws);
			const exclude = config.exclude.get() || [];
			ws.modules.update(
				Modules.filter((m) => {
					const p = path.relative(ws.uri.fsPath, m.Path);
					return !exclude.some((x) => x.match(p));
				}),
				(src) => new Module(ws, src),
			);
		}
	}

	/**
	 * Loads a {@link Workspace}'s or {@link Module}'s list of packages.
	 */
	async #loadPackages(root: Workspace | Module) {
		// Query gopls.
		const r = await this.#context.commands.packages({
			Files: [`${root.dir}`],
			Recursive: true,
		});

		// Consolidate `foo` and `foo_test`.
		const ws = root instanceof Workspace ? root : root.workspace;
		const packages = this.#consolidatePackages(ws, r);

		// Update. But don't update the packages' list of files, because we
		// didn't ask for tests so we can't properly filter the list of files.
		root.packages.update(packages, (src) => new Package(root, src));

		// Notify the provider that we updated the workspace/module's packages.
		this.#provider.didUpdatePackages(root);
	}

	async #loadTests(pkg: Package) {
		// Query gopls.
		const r = await this.#context.commands.packages({
			Files: [`${pkg.uri}`],
			Mode: Commands.PackagesMode.NeedTests,
		});

		const files = (r.Packages ?? []).flatMap((x) => x.TestFiles ?? []);

		// Update files and their tests.
		pkg.files.update(
			files.filter((x) => x.Tests && x.Tests.length > 0),
			(src) => new TestFile(pkg, src),
			(src, file) =>
				file.tests.update(
					src.Tests ?? [],
					(src) => new StaticTestCase(file, src),
					(src, test) => (test instanceof StaticTestCase ? test.update(src, []) : []),
					// Don't erase dynamic test cases.
					(test) => test instanceof DynamicTestCase,
				),
		);

		// Notify the provider that we updated the package's tests.
		this.#provider.didUpdateTests(pkg);
	}

	/**
	 * Consolidates test and source package data from gopls and filters out
	 * excluded packages.
	 *
	 * If a directory contains `foo.go`, `foo_test.go`, and `foo2_test.go` with
	 * package directives `foo`, `foo`, and `foo_test`, respectively, gopls will
	 * report those as three separate packages. This function consolidates them
	 * into a single package.
	 * @param ws The workspace.
	 * @param packages Data provided by gopls.
	 * @returns The consolidated and filtered package data.
	 */
	#consolidatePackages(ws: Workspace, { Packages: all = [] }: Commands.PackagesResults) {
		if (!all) return [];

		const exclude = this.#config.for(ws).exclude.get() || [];
		const paths = new Set(all.filter((x) => x.TestFiles).map((x) => x.ForTest || x.Path));
		const results: Commands.Package[] = [];
		for (const pkgPath of paths) {
			const pkgs = all.filter((x) => x.Path === pkgPath || x.ForTest === pkgPath);
			const files = pkgs
				.flatMap((x) => x.TestFiles || [])
				.filter((m) => {
					const p = path.relative(ws.dir.fsPath, Uri.parse(m.URI).fsPath);
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

	#delete(item: TestItem) {
		if (item.parent) {
			item.parent.children.delete(item.id);
		} else {
			this.#ctrl.items.delete(item.id);
		}
		this.#items.delete(item);
	}
}
