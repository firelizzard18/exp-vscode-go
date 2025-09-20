import { EventEmitter, Location, Range, TestItem, TestItemCollection, TestRun, TestRunRequest, Uri } from 'vscode';
import { Commands, Context, TestController } from '../utils/testing';
import path from 'node:path';
import { WorkspaceConfig } from './workspaceConfig';
import {
	DynamicTestCase,
	findParentTestCase,
	GoTestItem,
	idFor,
	Module,
	Package,
	parseID,
	StaticTestCase,
	TestCase,
	TestFile,
	Workspace,
} from './model';
import { GoTestItemPresenter } from './itemPresenter';
import { ItemEvent } from './itemSet';
import { pathContains } from '../utils/util';
import { PackageTestRun } from './pkgTestRun';
import { TestEvent } from './testEvent';
import { MapWithDefault } from '../utils/map';
import { ProfileType } from './profile';

export type ModelUpdateEvent<T = GoTestItem> = ItemEvent<T> & { view?: TestItem };

export class GoTestItemResolver {
	readonly #didUpdate;
	readonly onDidUpdate;

	readonly #context;
	readonly #config;
	readonly #presenter;
	readonly #ctrl;
	readonly #didLoadChildren = new WeakSet<GoTestItem>();

	#didLoadRoots = false;

	constructor(context: Context, config: WorkspaceConfig, presenter: GoTestItemPresenter, ctrl: TestController) {
		this.#context = context;
		this.#config = config;
		this.#presenter = presenter;
		this.#ctrl = ctrl;

		const didUpdate = new EventEmitter<ModelUpdateEvent[]>();
		this.#didUpdate = (events: ItemEvent<GoTestItem>[]) =>
			didUpdate.fire(events.map((x) => ({ ...x, view: this.#getViewItem(x.item) })));
		this.onDidUpdate = didUpdate.event;
	}

	/**
	 * Entry points:
	 * - config change
	 * - file
	 *   - delete
	 *   - code lens
	 * - runner
	 *   - view -> go for executing
	 *   - view -> go for logging
	 *     - may require resolving tests and/or creating dynamic subtests
	 */

	workspaceFor(uri: Uri) {
		const wsf = this.#context.workspace.getWorkspaceFolder(uri);
		if (!wsf) return;

		// Resolve or create a Workspace.
		let ws = this.#presenter.workspaces.get(wsf);
		if (!ws) {
			ws = new Workspace(wsf);
			this.#presenter.workspaces.add(ws);
		}

		// If the path is excluded, ignore it.
		const config = this.#config.for(ws);
		const exclude = config.exclude.get() || [];
		const rel = path.relative(ws.uri.fsPath, uri.fsPath);
		if (exclude.some((x) => x.match(rel))) return;

		return ws;
	}

	async updateFile(uri: Uri, opts: { modified?: Range[] } = {}) {
		const resolved: TestFile[] = [];

		// We don't handle external files (those outside of a workspace).
		const ws = this.workspaceFor(uri);
		if (!ws) return resolved;

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
				this.#didUpdate([{ item: mod, type: 'added' }]);
			}
			mods.set(src.Path, mod);
		}

		// Process packages. An alternative build system may allow a file to be
		// part of multiple packages, so we can't assume there's only one
		// package.
		for (const src of packages) {
			// Skip packages that don't have tests.
			if (!src.TestFiles?.length) continue;

			// Get the workspace or module for this package. If the package is
			// part of a module but that module is not part of this workspace,
			// use the workspace as the root.
			let root: Workspace | Module = ws;
			if (src.ModulePath) {
				root = mods.get(src.ModulePath) ?? ws;
			}

			// Get or create the package.
			let pkg = root.packages.get(src);
			if (!pkg) {
				pkg = new Package(root, src);
				root.packages.add(pkg);
				this.#didUpdate([{ item: pkg, type: 'added' }]);
			}

			// Update the package's files.
			this.#updateFiles(pkg, src.TestFiles, { [`${uri}`]: opts.modified });
			resolved.push(...[...pkg.files].filter((x) => `${x.uri}` === `${uri}`));

			// Mark the root and the package as requested.
			this.#presenter.markRequested(root);
			this.#presenter.markRequested(pkg);

			// Synchronize the view model.
			this.#updateViewModel(pkg, undefined, {});
		}
		return resolved;
	}

	/**
	 * Update the view model. If `item` is null/undefined, the roots are
	 * updated. Otherwise the given item and it's children are updated.
	 *
	 * If `options.resolve` is set or the roots or item's children have already
	 * been loaded, they will be (re)loaded. If neither is true, and `item` is
	 * null/undefined, this has no effect. Otherwise (when neither is true),
	 * this will simply synchronize the view model with the data model without
	 * updating the latter.
	 */
	async updateViewModel(
		item?: TestItem | GoTestItem,
		options: { resolve?: boolean; recurse?: boolean } = {},
	): Promise<void> {
		// Load the roots and update the view model.
		if (!item) {
			if (!this.#didLoadRoots && !options.resolve) {
				return;
			}

			const updates = await this.#loadRoots();
			for (const go of this.#presenter.getChildren()) {
				const view = this.#ctrl.items.get(`${idFor(go)}`);
				this.#updateViewModel(go, view, options);
			}
			return updates;
		}

		// Determine if `item` is a data or view model item. If it's the latter,
		// find the data model item. If there is no data model item, delete the
		// view model item.
		let go: GoTestItem | undefined;
		let view: TestItem | undefined;
		if ('kind' in item) {
			go = item;
		} else {
			view = item;
			go = this.#getGoItem(view);
			if (!go) {
				this.#delete(view);
				return;
			}
		}

		// If it's a Workspace, Module, or Package, load its children.
		if (options.resolve || this.#didLoadChildren.has(go)) {
			switch (go.kind) {
				case 'workspace':
				case 'module':
					await this.#loadPackages(go);
					break;

				case 'package':
					await this.#loadTests(go);
					break;
			}
		}

		// Update the view model.
		this.#updateViewModel(go, view, options);
	}

	/**
	 * Create or update the view model item for the given data model item. If
	 * the item's children have been loaded previously, they will be updated. If
	 * `options.recurse` is set, this will recurse on the item's children.
	 *
	 * **This must not be async.** This method being async would cause serious
	 * performance issues for large projects.
	 */
	#updateViewModel(go: GoTestItem, view: TestItem | undefined, options: { recurse?: boolean }) {
		// Resolve or create the view item.
		view = view ?? this.#getViewItem(go) ?? this.#buildViewItem(go);

		// Ensure mutable properties are synced.
		if (go instanceof StaticTestCase) {
			view.range = go.range;
		}

		// Should we update children? If the item is a workspace, module, or
		// package that has not yet had its children loaded, do not update them.
		switch (go.kind) {
			case 'workspace':
			case 'module':
			case 'package':
				if (!this.#didLoadChildren.has(go)) {
					return view;
				}
		}

		// Delete unwanted items.
		const goChildren = this.#presenter.getChildren(go);
		const want = new Set(goChildren.map((x) => `${idFor(x)}`));
		for (const [id, item] of view.children) {
			if (!want.has(id)) {
				this.#delete(item);
			}
		}

		// Add missing items.
		for (const go of goChildren) {
			const id = `${idFor(go)}`;
			if (!view.children.get(id)) {
				this.#buildViewItem(go);
			}
		}

		// Recurse.
		if (options.recurse) {
			for (const go of goChildren) {
				this.#updateViewModel(go, view.children.get(`${idFor(go)}`), options);
			}
		}

		return view;
	}

	#buildViewItem(go: GoTestItem) {
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

	async resolveRunRequest(rq: TestRunRequest | GoTestItem[]) {
		// IDs of items to exclude. Don't try to resolve to test items because
		// those might not have been loaded yet.
		const exclude = new Set(rq instanceof Array ? [] : rq.exclude?.map((x) => x.id) ?? []);
		const isExcluded = (item: GoTestItem) => exclude.has(`${idFor(item)}`);

		// Ensure roots have been loaded.
		if (!this.#didLoadRoots) {
			await this.updateViewModel(undefined, { resolve: true });
		}

		// Resolve VSCode test items to Go test items.
		let include: Set<GoTestItem>;
		if (rq instanceof Array) {
			// The request specifies Go items, so we just need to execute those.
			include = new Set(rq);
		} else if (rq.include) {
			// The request specifies view items so convert those to Go items.
			// Silently ignore requests to execute test items that don't have a
			// Go item.
			include = new Set(rq.include.map((x) => this.#getGoItem(x.id)).filter((x) => !!x));
		} else {
			// If include is not specified, include all roots.
			const workspaces = [...this.#presenter.workspaces];
			include = new Set([...workspaces, ...workspaces.flatMap((x) => [...x.modules])]);
		}

		// Get roots that aren't excluded.
		const roots = new Set(
			[...include].filter(
				(x): x is Workspace | Module => (x.kind === 'workspace' || x.kind === 'module') && !isExcluded(x),
			),
		);

		// Ensure packages have been loaded.
		for (const root of roots) {
			if (!this.#didLoadChildren.has(root)) {
				await this.updateViewModel(root, { resolve: true });
			}
		}

		// Get packages that aren't excluded.
		const packages = new Set([...include].filter((x): x is Package => x.kind === 'package' && !isExcluded(x)));

		// Ensure files and tests have been loaded.
		for (const pkg of packages) {
			if (!this.#didLoadChildren.has(pkg)) {
				await this.updateViewModel(pkg, { resolve: true });
			}
		}

		// Remove redundant requests for specific tests.
		//
		// If a package is selected, all tests within it will be run so ignore
		// explicit requests for a file or test if its package is selected.
		// Unless the test is a benchmark and benchmarks will not otherwise be
		// run.
		for (const item of include) {
			if (item instanceof TestFile) {
				if (include.has(item.package)) {
					include.delete(item);
				}
			}

			if (item instanceof TestCase) {
				if (item.kind === 'benchmark' && shouldRunBenchmarks(this.#config, item.file.package)) {
					continue;
				}
				if (include.has(item.file.package)) {
					include.delete(item);
				}
			}
		}

		// Ensure the package list is complete.
		for (const item of include) {
			if (item instanceof TestFile) {
				packages.add(item.package);
			}

			if (item instanceof TestCase) {
				packages.add(item.file.package);
			}
		}

		// We need a TestRunRequest, so construct one if necessary.
		if (rq instanceof Array) {
			rq = new TestRunRequest(rq.map((x) => this.#getViewItem(x) ?? this.#buildViewItem(x)));
		}

		const excludeItems = new Set([...exclude].map((x) => this.#getGoItem(x)).filter((x) => !!x));
		return new GoTestItemResolver.RunRequest(this, rq, packages, include, excludeItems);
	}

	#getGoItem(item: string | Uri | TestItem): GoTestItem | undefined {
		if (typeof item === 'string') {
			item = Uri.parse(item);
		} else if (!(item instanceof Uri)) {
			item = Uri.parse(item.id);
		}

		// Parse the ID.
		const id = parseID(item);

		// If it's a profile, find the containing item.
		if (id.profile) {
			const { fragment: _, ...parts } = item;
			const parent = this.#getGoItem(Uri.from(parts));
			if (!parent) return;

			const container = this.#presenter.getProfiles(parent);
			if (!container || !id.at) return container;

			const set = container.profiles.get(id.at.getTime());
			if (!set || typeof id.profile === 'boolean') return set;

			for (const profile of set.profiles) {
				if (profile.type.id === id.profile) {
					return profile;
				}
			}
			return;
		}

		// Create a URI with the query and fragment removed.
		const uri = Uri.from({
			scheme: item.scheme,
			authority: item.authority,
			path: item.path,
		});

		// Get the workspace.
		const wsf = this.#context.workspace.getWorkspaceFolder(uri);
		if (!wsf) return;
		const ws = this.#presenter.workspaces.get(wsf);
		if (!ws || id.kind === 'workspace') return ws;

		// Scan all the modules.
		for (const mod of ws.modules) {
			// If we're looking for a module, return or skip. Otherwise, check
			// if the module contains the path.
			if (id.kind === 'module') {
				if (`${mod.uri}` === `${uri}`) {
					return mod;
				}
				continue;
			} else if (!pathContains(mod.uri, uri)) {
				continue;
			}

			// Look for a package who's URI matches the target directory.
			const dir = id.kind === 'package' ? uri : Uri.joinPath(uri, '..');
			for (const pkg of mod.packages) {
				// If it matches and we want a package, return it.
				if (`${pkg.uri}` !== `${dir}`) continue;
				if (id.kind === 'package') return pkg;

				// Does the package have the file?
				const file = pkg.files.get(`${uri}`);
				if (!file) continue;

				// If we're looking for a file and it matches, return it.
				if (id.kind === 'file') return file;

				// If we found the file and it doesn't have the test, the
				// test doesn't exist.
				return file.tests.get(id.name!);
			}
		}
	}

	#getViewItem(item: GoTestItem): TestItem | undefined {
		// If the item has no (view) parent, check the root.
		const parent = this.#presenter.getParent(item);
		if (!parent) {
			return this.#ctrl.items.get(`${idFor(item)}`);
		}

		// Otherwise, check the parent's children.
		return this.#getViewItem(parent)?.children.get(`${idFor(item)}`);
	}

	/**
	 * Updates the list of workspaces, and loads the modules of each workspace.
	 */
	async #loadRoots() {
		// Remember that we've loaded the roots.
		this.#didLoadRoots = true;

		// Update the workspace item set.
		this.#presenter.workspaces.update(this.#context.workspace.workspaceFolders ?? [], (ws) => new Workspace(ws));

		// Update the workspaces' modules list.
		await Promise.all([...this.#presenter.workspaces].map(async (ws) => this.#loadModules(ws)));
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

		this.#didUpdate(updates.flat());
	}

	/**
	 * Loads the packages of a workspace or module.
	 */
	async #loadPackages(root: Workspace | Module) {
		// Remember that we've loaded the root's packages.
		this.#didLoadChildren.add(root);

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
		const updates = root.packages.update(packages, (src) => new Package(root, src));

		// Notify the provider that we updated the workspace/module's packages.
		this.#didUpdate(updates);
	}

	/**
	 * Loads the tests (and files) of a package.
	 */
	async #loadTests(pkg: Package) {
		// Remember that we've loaded the package's files.
		this.#didLoadChildren.add(pkg);

		// Query gopls.
		const { Packages } = await this.#context.commands.packages({
			Files: [`${pkg.uri}`],
			Mode: Commands.PackagesMode.NeedTests,
		});
		if (!Packages) return [];

		// Update files and their tests.
		this.#updateFiles(
			pkg,
			Packages.flatMap((x) => x.TestFiles ?? []),
		);
	}

	/**
	 * Updates the files and tests of a package using the provided data.
	 */
	#updateFiles(pkg: Package, files: Commands.TestFile[], ranges?: Record<string, Range[] | undefined>) {
		const updates = pkg.files.update(
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

		// Notify the provider that we updated the package's tests.
		this.#didUpdate(updates);
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
	}

	static RunRequest = class ResolvedTestRunRequest {
		readonly #resolver;
		readonly request;
		readonly #packages;
		readonly #include;
		readonly #exclude;

		constructor(
			resolver: GoTestItemResolver,
			request: TestRunRequest,
			packages: Set<Package>,
			include: Set<GoTestItem>,
			exclude: Set<GoTestItem>,
		) {
			this.#resolver = resolver;
			this.request = request;
			this.#packages = packages;
			this.#include = include;
			this.#exclude = exclude;
		}

		get size() {
			return this.#packages.size;
		}

		*packages(run: TestRun) {
			const map = <T extends GoTestItem>(items: T[]) => new Map(items.map((x) => [x, this.#get(x)]));
			const pkgMode = new Map(
				[...this.#packages].map((x) => [x, this.#include.has(x) ? 'all' : 'specific'] as const),
			);
			const pkgInclude = mapTestsByPackage(this.#include);
			const pkgExclude = mapTestsByPackage(this.#exclude);

			// When the run is disposed, remove all dynamic test cases
			// associated with it.
			run.onDidDispose?.(() => {
				for (const pkg of this.#packages) {
					this.#removeDynamicTests(pkg, (test) => test.run === run);
				}
			});

			for (const pkg of this.#packages) {
				const mode = pkgMode.get(pkg) ?? 'specific';
				const include = mode === 'all' ? map([...pkg.allTests()]) : map(pkgInclude.get(pkg) ?? []);
				const exclude = map(pkgExclude.get(pkg) ?? []);

				// This is called immediately before executing a test run. So, we'll
				// clear the dynamic test cases now.
				if (mode === 'all') {
					// We're running all tests, so remove all dynamic tests.
					this.#removeDynamicTests(pkg, () => true);
				} else {
					// We're running specific tests, so remove dynamic tests if
					// their parent is being run.
					this.#removeDynamicTests(pkg, (test) => {
						const parent = this.#resolver.#presenter.getParent(test);
						while (parent) {
							if (exclude.has(parent as any)) return false;
							if (include.has(parent as any)) return true;
						}
						return false;
					});
				}

				yield new PackageTestRun({
					run,
					mode,
					goItem: pkg,
					testItem: this.#get(pkg),
					tests: include,
					exclude,
					testFor: (event) => this.#testForEvent(pkg, run, event),
				});
			}
		}

		attachProfile(run: PackageTestRun, dir: Uri, type: ProfileType, time: Date) {
			// Where should we attach the profiles? If there is a single
			// item included, attach to it, otherwise attach to the package.
			// If the target item is a dynamic test case, the presenter will
			// walk up the chain until it reaches a static test case, to
			// avoid attaching profiles to a dynamic test case.
			const scope = run.tests.size === 1 ? [...run.tests][0][0] : run.goItem;
			const profile = this.#resolver.#presenter.addProfile(scope, dir, type, time);

			// Update the view model.
			this.#resolver.#updateViewModel(profile, undefined, {});

			// Remove when the run is disposed.
			run.run.onDidDispose?.(async () => {
				profile.remove();
				this.#resolver.#updateViewModel(profile.parent.parent, undefined, { recurse: true });
			});
			return profile;
		}

		#get(item: GoTestItem) {
			return this.#resolver.#getViewItem(item) ?? this.#resolver.#buildViewItem(item);
		}

		#testForEvent(pkg: Package, run: TestRun, event: TestEvent | Location) {
			// If the event is a location, find the file and find a test that
			// contains the specified range.
			if (event instanceof Location) {
				const file = pkg.files.get(`${event.uri}`);
				if (!file) return;

				for (const test of file.tests) {
					if (test instanceof StaticTestCase && test.range && test.range.contains(event.range)) {
						return this.#get(test);
					}
				}
				return;
			}

			if (!event.Test) return;

			// Check for an exact match.
			for (const file of pkg.files) {
				const test = file.tests.get(event.Test);
				if (!test) continue;

				// Reassociate with the current run.
				if (test instanceof DynamicTestCase) {
					test.run = run;
				}

				return this.#get(test);
			}

			// Create a dynamic subtest.
			const parent = findParentTestCase(pkg, event.Test);
			if (!parent) return;
			const child = new DynamicTestCase(parent, test.name, run);
			parent.file.tests.add(child);

			// Notify the presenter that there's a new test.
			this.#resolver.#didUpdate([{ item: child, type: 'added' }]);

			// Update the parent's view model.
			return this.#resolver.#updateViewModel(parent, undefined, { recurse: true });
		}

		#removeDynamicTests(pkg: Package, predicate: (test: DynamicTestCase) => boolean) {
			// Remove all matching dynamic test cases.
			const parents = new Set<GoTestItem>();
			const updates: ModelUpdateEvent[] = [];
			const remove = (test: TestCase, predicate: (test: DynamicTestCase) => boolean): boolean => {
				const children = this.#resolver.#presenter.getChildren(test) as TestCase[];
				const ok = test instanceof DynamicTestCase && predicate(test);
				if (ok) {
					// Test is dynamic, remove it and all its children.
					test.file.tests.remove(test);
					updates.push({ item: test, type: 'removed' });

					for (const child of children) {
						remove(child, () => true);
					}
				} else {
					// Test is static or should not be removed, check its children.
					for (const child of children) {
						if (remove(child, predicate)) {
							parents.add(test);
						}
					}
				}

				return ok;
			};

			for (const file of pkg.files) {
				for (const test of file.tests) {
					if (remove(test, predicate)) {
						parents.add(file);
					}
				}
			}

			// Notify listeners.
			this.#resolver.#didUpdate(updates);

			// Update the view model.
			for (const parent of parents) {
				this.#resolver.#updateViewModel(parent, undefined, {});
			}
		}
	};
}

export const ResolvedTestRunRequest = GoTestItemResolver.RunRequest;
export type ResolvedTestRunRequest = InstanceType<typeof ResolvedTestRunRequest>;

export function shouldRunBenchmarks(config: WorkspaceConfig, pkg: Package) {
	// When the user clicks the run button on a package, they expect all of the
	// tests within that package to run - they probably don't want to run the
	// benchmarks. So if a benchmark is not explicitly selected, don't run
	// benchmarks. But the user may disagree, so behavior can be changed with
	// `testExplorer.runPackageBenchmarks`. However, if the user clicks the run
	// button on a file or package that contains benchmarks and nothing else,
	// they likely expect those benchmarks to run.
	if (config.for(pkg).runPackageBenchmarks.get()) {
		return true;
	}
	for (const test of pkg.allTests()) {
		if (test.kind !== 'benchmark') {
			return false;
		}
	}
	return true;
}

function mapTestsByPackage(items: Iterable<GoTestItem>) {
	const map = new MapWithDefault<Package, TestCase[]>(() => []);
	for (const item of items) {
		if (item instanceof TestFile) {
			map.get(item.package).push(...item.tests);
		}
		if (item instanceof TestCase) {
			map.get(item.file.package).push(item);
		}
	}
	return map;
}
