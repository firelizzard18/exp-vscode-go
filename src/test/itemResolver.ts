import { Range, TestItem, Uri, WorkspaceFolder } from 'vscode';
import { Commands, Context, TestController } from '../utils/testing';
import path from 'node:path';
import { WorkspaceConfig } from './workspaceConfig';
import { GoTestItem, Module, Package, TestCase, TestFile, Workspace } from './model';
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
	 */

	/** Reloads workspaces and modules. */
	async resolveRoots() {
		if (!this.#context.workspace.workspaceFolders) {
			return;
		}

		// Update the workspace item set.
		this.#provider.updateWorkspaces(this.#context.workspace.workspaceFolders);

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
			ws.updateModules(
				Modules.filter((m) => {
					const p = path.relative(ws.uri.fsPath, m.Path);
					return !exclude.some((x) => x.match(p));
				}),
			);
		}
	}

	async resolvePackages(root: Workspace | Module) {
		// Query gopls.
		const result = await this.#context.commands.packages({
			Files: [`${root.dir}`],
			Mode: 1,
			Recursive: true,
		});

		// Consolidate `foo` and `foo_test`.
		const ws = root instanceof Workspace ? root : root.workspace;
		const packages = this.#consolidatePackages(ws, result);

		// Update.
		root.updatePackages(packages);
		this.#provider.rebuildRelations(root);
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
}
