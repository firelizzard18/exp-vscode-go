import { Range, TestItem, TestItemCollection, Uri, WorkspaceFolder } from 'vscode';
import { Commands, Context, TestController } from '../utils/testing';
import path from 'node:path';
import { WorkspaceConfig } from './workspaceConfig';
import {
	DynamicTestCase,
	GoTestItem,
	idFor,
	Module,
	Package,
	StaticTestCase,
	TestCase,
	TestFile,
	Workspace,
} from './model';
import { GoTestItemPresenter } from './itemPresenter';
import { EventEmitter } from '../utils/eventEmitter';

export class GoTestItemResolver {
	readonly #didChangeTestItem = new EventEmitter<(items: Iterable<GoTestItem>) => void>();
	readonly onDidChangeTestItem = this.#didChangeTestItem.event;
	readonly #didInvalidateTestResults = new EventEmitter<(items: Iterable<TestCase | TestFile>) => void>();
	readonly onDidInvalidateTestResults = this.#didInvalidateTestResults.event;

	readonly #context;
	readonly #config;
	readonly #presenter;
	readonly #ctrl;
	readonly #items = new Map<string, GoTestItem>();
	readonly #resolved = new WeakSet<GoTestItem>();

	#resolvedRoots = false;

	constructor(context: Context, config: WorkspaceConfig, presenter: GoTestItemPresenter, ctrl: TestController) {
		this.#context = context;
		this.#config = config;
		this.#presenter = presenter;
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

	async didUpdateFile(wsf: WorkspaceFolder, file: Uri, ranges: Record<string, Range[]> = {}) {
		// Resolve or create a Workspace.
		let ws = this.#presenter.workspaces.get(wsf);
		if (!ws) {
			ws = new Workspace(wsf);
			this.#presenter.workspaces.add(ws);
		}

		// Query gopls.
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
			this.#presenter.markRequested(root);
			this.#presenter.markRequested(pkg);
		}

		// If anything changed, rebuild relations.
		if (updated.length > 0) {
			for (const root of roots) {
				this.#presenter.didUpdatePackages(root);
			}
		}

		return updated;
	}

	markResolved(item: string | TestItem | GoTestItem | '(roots)') {
		if (item === '(roots)') {
			this.#resolvedRoots = true;
			return;
		}

		if (typeof item === 'object' && !('kind' in item)) {
			item = item.id;
		}
		if (typeof item === 'string') {
			item = this.#items.get(item)!;
			if (!item) return;
		}
		this.#resolved.add(item);
	}

	/**
	 * Update the view model. If `view` is null/undefined, the roots are
	 * updated. Otherwise the given item and it's children are updated.
	 */
	async updateViewModel(item?: TestItem | GoTestItem | null, options: { recurse?: boolean } = {}) {
		// Update the data model.
		const go = item && (await this.#updateDataModel(item));
		if (item && !go && !('kind' in item)) {
			this.#delete(item);
			return;
		}

		// Resolve or create the view item.
		let view = item && ('kind' in item ? this.#getViewItem(item) : item);
		if (go && !view) {
			view = this.#buildViewModel(go);
		}

		// Ensure mutable properties are synced.
		if (go instanceof StaticTestCase) {
			view!.range = go.range;
		}

		// Should we update children? If the user has not expanded a given item
		// (including the roots), do not update it.
		if (go && !this.#resolved.has(go)) return;
		if (!go && !this.#resolvedRoots) return;

		// Delete unwanted items.
		const goChildren = this.#presenter.getChildren(go);
		const viewChildren = view ? view.children : this.#ctrl.items;
		const want = new Set(goChildren.map((x) => `${idFor(x)}`));
		for (const [id, item] of viewChildren) {
			if (!want.has(id)) {
				this.#delete(item);
			}
		}

		// Add missing items.
		for (const go of goChildren) {
			const id = `${idFor(go)}`;
			if (!viewChildren.get(id)) {
				this.#buildViewModel(go);
			}
		}

		// Should we recurse?
		if (!options.recurse) return;

		switch (go?.kind) {
			case undefined:
				// It seems like it would make sense to update workspaces here
				// and update the modules in the workspace case. However,
				// workspaces and modules are sibilings in the view, so this
				// better matches how the view behaves.
				for (const ws of this.#presenter.workspaces) {
					await this.updateViewModel(ws);
					for (const mod of ws.modules) {
						await this.updateViewModel(mod);
					}
				}
				break;

			case 'workspace':
			case 'module':
				for (const pkg of go.packages) {
					await this.updateViewModel(pkg);
				}
				break;

			case 'package':
				for (const file of go.files) {
					await this.updateViewModel(file);
				}
				break;
		}
	}

	#buildViewModel(go: GoTestItem) {
		// Push the ancestry chain.
		const stack = [go];
		for (;;) {
			const item = this.#presenter.getParent(stack[stack.length - 1]);
			if (!item) break;
			stack.push(item);
		}

		// Pop down the chain, starting from the roots.
		let items = this.#ctrl.items;
		for (;;) {
			// Retrieve or create a view item.
			const go = stack.pop()!;
			const view = create.call(this, go, items);

			// If the stack is empty, return the view item.
			if (stack.length === 0) {
				return view;
			}

			// Otherwise, update the item set.
			items = view.children;
		}

		function create(this: GoTestItemResolver, go: GoTestItem, items: TestItemCollection) {
			// Check for an existing item.
			const id = `${idFor(go)}`;
			let view = items.get(id);
			if (view) return view;

			// Create a new one.
			view = this.#ctrl.createTestItem(id, this.#presenter.labelFor(go), 'uri' in go ? go.uri : undefined);

			// Add it to the parent's children.
			items.add(view);

			// Other metadata.
			view.canResolveChildren = this.#presenter.hasChildren(go);

			if (go instanceof StaticTestCase) {
				view.range = go.range;
			}

			switch (go.kind) {
				case 'workspace':
				case 'module':
					view.tags = [{ id: 'canRun' }];
					break;

				case 'package':
				case 'file':
				case 'test':
				case 'benchmark':
				case 'example':
				case 'fuzz':
					view.tags = [{ id: 'canRun' }, { id: 'canDebug' }];
					break;
			}

			return view;
		}
	}

	#getViewItem(item: string | GoTestItem): TestItem | undefined {
		if (typeof item === 'string') {
			item = this.#items.get(item)!;
			if (!item) return;
		}

		// If the item has no (view) parent, check the root.
		const parent = this.#presenter.getParent(item);
		if (!parent) {
			return this.#ctrl.items.get(`${idFor(item)}`);
		}

		// Otherwise, check the parent's children.
		return this.#getViewItem(parent)?.children.get(`${idFor(item)}`);
	}

	/**
	 * Updates the data model. If `item` is a data model item, it is updated. If
	 * `item` is a view model item, it's corresponding data model item is
	 * updated. If `view` is null/undefined, the list of roots (workspaces and
	 * modules) is updated.
	 */
	async #updateDataModel(item?: TestItem | GoTestItem | null) {
		if (!item) {
			await this.#loadRoots();
			return;
		}

		const go = 'kind' in item ? item : this.#items.get(item.id);
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
	 * Updates the list of workspaces, and loads the modules of each workspace.
	 */
	async #loadRoots() {
		// Update the workspace item set.
		this.#presenter.workspaces.update(this.#context.workspace.workspaceFolders ?? [], (ws) => new Workspace(ws));

		// Query gopls.
		const results = await Promise.all(
			[...this.#presenter.workspaces].map(async (ws) => {
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
	 * Loads the packages of a workspace or module.
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
		this.#presenter.didUpdatePackages(root);
	}

	/**
	 * Loads the tests (and files) of a package.
	 */
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
		this.#presenter.didUpdateTests(pkg);
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
		this.#items.delete(item.id);
	}
}
