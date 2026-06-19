import { Context } from '@/utils/common';
import { Disposer } from '@/utils/disposable';
import { TestController } from '@/utils/testing';
import { pathContains } from '@/utils/util';
import { Range, TestItem, TestItemCollection, TestRunRequest, Uri } from 'vscode';
import {
	DynamicTestCase,
	GoTestItem,
	isTestItem,
	ItemEvent,
	ModelController,
	Module,
	Package,
	StaticTestCase,
	TestCase,
	TestFile,
	Workspace,
} from '../model';
import { ResolvedTestRunRequest } from '../resolvedRunRequest';
import { WorkspaceConfig } from '../workspaceConfig';
import {
	idFor,
	ModelViewPresenter,
	parseID,
	Presentable,
	ProfileContainer,
	ProfileItem,
	ProfileSet,
} from './presenter';

export class ViewController extends Disposer {
	readonly #context;
	readonly #config;
	readonly #model;
	readonly #presenter;
	readonly #ctrl;

	constructor(
		context: Context,
		config: WorkspaceConfig,
		model: ModelController,
		presenter: ModelViewPresenter,
		ctrl: TestController,
	) {
		super();
		this.#context = context;
		this.#config = config;
		this.#model = model;
		this.#presenter = presenter;
		this.#ctrl = ctrl;

		this.disposeOf = model.onDidUpdate((updates) => {
			// Synchronize the view model.
			const refresh = new Map<Presentable, boolean>();
			for (const { item, type } of updates) {
				if (type === 'removed') {
					const parent = this.#presenter.getParent(item);
					if (parent) refresh.set(parent, false);
					continue;
				}

				// Update the package (recursively).
				if (item.kind === 'package') {
					refresh.set(item, true);
				}

				// Update the view parent's view model. TODO: This is
				// triggered by RunController.#testFor, handle this during
				// resolveViewItem/#buildViewItem?
				if (item instanceof DynamicTestCase) {
					const viewParent = this.#presenter.getParent(item);
					if (!viewParent) throw new Error('Internal error');
					refresh.set(viewParent, true);
				}
			}

			// Refresh the view model. TODO: Eliminate duplicates
			// (parent-and-child refreshes)?
			for (const [item, recurse] of refresh) {
				this.#updateViewModel(item, undefined, { recurse });
			}

			// Invalidate test results when tests are modified.
			const tests = updates.filter(
				(x): x is ItemEvent<TestCase> =>
					// If a test case is modified
					(x.item instanceof TestCase && x.type === 'modified') ||
					// Or a _static_ test case is added;
					(x.type === 'added' && x.item instanceof StaticTestCase),
			);
			if (tests.length) {
				this.#ctrl.invalidateTestResults?.(tests.map((x) => this.#getViewItem(x.item)).filter((x) => !!x));
			}
		});
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
		return this.#model.workspaceFor(uri);
	}

	resolveViewItem(go: GoTestItem) {
		if (go.kind === 'package' && go.isRootPkg) {
			go = go.parent;
		}
		return this.#getViewItem(go) ?? this.#buildViewItem(go);
	}

	async updateFile(uri: Uri, opts: { modified?: Range[] } = {}) {
		// Delegate to the model.
		const resolved = await this.#model.updateFile(uri, opts);

		// Mark the root and pacakge as explicitly requested by the user. This
		// used to happen at the end of the `for (const src of packages)` loop.
		for (const file of resolved) {
			this.#presenter.markRequested(file.package);
			this.#presenter.markRequested(file.package.parent);
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
			if (!this.#didLoad() && !options.resolve) {
				return;
			}

			await this.#model.populate();
			for (const go of this.#presenter.getChildren()) {
				const view = this.#ctrl.items.get(`${idFor(go)}`);
				this.#updateViewModel(go, view, options);
			}
			return;
		}

		// Determine if `item` is a data or view model item. If it's the latter,
		// find the data model item. If there is no data model item, delete the
		// view model item.
		let go: Presentable | undefined;
		let view: TestItem | undefined;
		if ('kind' in item) {
			go = item;
		} else {
			view = item;
			go = this.#getPresentable(view);
			if (!go) {
				this.#delete(view);
				return;
			}
		}

		// If it's a Workspace, Module, or Package, load its children.
		if (options.resolve || this.#didLoad(go)) {
			switch (go.kind) {
				case 'workspace':
				case 'module':
				case 'package':
					await this.#model.populate(go);
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
	#updateViewModel(
		go: Presentable,
		view: TestItem | undefined,
		options: { recurse?: boolean },
	): TestItem | undefined {
		// Root packages should be transparent to the presentation layer.
		if (go.kind === 'package' && go.isRootPkg) {
			return this.#updateViewModel(go.parent, undefined, options);
		}

		// Resolve or create the view item.
		view = view ?? this.#getViewItem(go) ?? this.#buildViewItem(go);

		// Ensure mutable properties are synced.
		if (go instanceof StaticTestCase) {
			view.range = go.range;
		}

		// Only set canResolveChildren if the item has children that should be
		// lazily resolved. Exit if there are no children.
		const hasChildren = this.#presenter.hasChildren(go);
		view.canResolveChildren = hasChildren === 'lazy';
		if (hasChildren === 'none') return view;

		// Should we update children? If the item is a workspace, module, or
		// package that has not yet had its children loaded, do not update them.
		if (hasChildren === 'lazy' && !this.#didLoad(go)) {
			return view;
		}

		// Delete unwanted items.
		const goChildren = [...this.#presenter.getChildren(go)];
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

	#buildViewItem(go: Presentable) {
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

		function create(this: ViewController, go: Presentable, items: TestItemCollection) {
			// Check for an existing item.
			const id = `${idFor(go)}`;
			let view = items.get(id);
			if (view) return view;

			// Create a new one.
			view = this.#ctrl.createTestItem(id, this.#presenter.labelFor(go), 'uri' in go ? go.uri : undefined);

			// Add it to the parent's children.
			items.add(view);

			// Only set canResolveChildren if the item has children that should
			// be lazily resolved.
			const hasChildren = this.#presenter.hasChildren(go);
			view.canResolveChildren = hasChildren === 'lazy';

			// Other metadata.
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
		if (!this.#didLoad()) {
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
			include = new Set(rq.include.map((x) => this.#getGoItem(x.id)).filter((x) => !!x && isTestItem(x)));
		} else {
			// If include is not specified, include all roots.
			const workspaces = [...this.#model.workspaces];
			include = new Set([...workspaces, ...workspaces.flatMap((x) => [...x.modules])]);
		}

		// Get roots that aren't excluded.
		const roots = new Set(
			[...include].filter(
				(x): x is Workspace | Module => (x.kind === 'workspace' || x.kind === 'module') && !isExcluded(x),
			),
		);

		// Ensure packages have been loaded. We don't execute roots directly, so
		// add their packages to the include set.
		for (const root of roots) {
			if (!this.#didLoad(root)) {
				await this.updateViewModel(root, { resolve: true });
			}
			for (const pkg of root.packages) {
				include.add(pkg);
			}
		}

		// Get packages that aren't excluded.
		const packages = new Set([...include].filter((x): x is Package => x.kind === 'package' && !isExcluded(x)));

		// Ensure files and tests have been loaded.
		for (const pkg of packages) {
			if (!this.#didLoad(pkg)) {
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

		const excludeItems = new Set([...exclude].map((x) => this.#getGoItem(x)).filter((x) => !!x && isTestItem(x)));
		return new ResolvedTestRunRequest(this.#model, this.#presenter, this, rq, packages, include, excludeItems);
	}

	#didLoad(scope?: Presentable) {
		if (!scope) {
			return this.#model.workspaces.loaded;
		}
		switch (scope.kind) {
			case 'workspace':
			case 'module':
				return scope.packages.loaded;
			case 'package':
				return scope.files.loaded;
			case 'file':
				return scope.tests.loaded;
		}
		return false;
	}

	#getPresentable(view: TestItem | Uri): Presentable | undefined {
		const uri = view instanceof Uri ? view : Uri.parse(view.id);
		const id = parseID(uri);
		if (!id.profile) return this.#getGoItem(view);

		// If we're dealing with a profile, synthesize the relevant presentable.
		if (typeof id.profile === 'string') {
			const query = new URLSearchParams(uri.query);
			query.delete('profile');

			const parent = this.#getPresentable(uri.with({ query: `${query}` }));
			if (!(parent instanceof ProfileSet)) return;

			const profile = this.#presenter
				.getProfiles(parent.parent.parent)
				.find((x) => x.type.id === id.profile && x.time.getTime() === id.at?.getTime());
			if (!profile) return;

			return new ProfileItem(parent, profile);
		}

		if (id.at) {
			const query = new URLSearchParams(uri.query);
			query.delete('at');

			const parent = this.#getPresentable(uri.with({ query: `${query}` }));
			if (!(parent instanceof ProfileContainer)) return;

			return new ProfileSet(parent, id.at);
		}

		const parent = this.#getGoItem(uri.with({ fragment: '' }));
		if (!parent) return;

		return new ProfileContainer(parent);
	}

	#getGoItem(item: string | Uri | TestItem): GoTestItem | undefined {
		if (typeof item === 'string') {
			item = Uri.parse(item);
		} else if (!(item instanceof Uri)) {
			item = Uri.parse(item.id);
		}

		// Parse the ID.
		const id = parseID(item);

		// Profiles are not Go test items.
		if (id.profile) return;

		// Create a URI with the query and fragment removed.
		const uri = Uri.from({
			scheme: item.scheme,
			authority: item.authority,
			path: item.path,
		});

		// Get the workspace.
		const wsf = this.#context.workspace.getWorkspaceFolder(uri);
		if (!wsf) return;
		const ws = this.#model.workspaces.get(wsf);
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
			} else if (!pathContains(mod.dir, uri)) {
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

	#getViewItem(item: Presentable): TestItem | undefined {
		// If the item has no (view) parent, check the root.
		const parent = this.#presenter.getParent(item);
		if (!parent) {
			return this.#ctrl.items.get(`${idFor(item)}`);
		}

		// Otherwise, check the parent's children.
		return this.#getViewItem(parent)?.children.get(`${idFor(item)}`);
	}

	#delete(item: TestItem) {
		if (item.parent) {
			item.parent.children.delete(item.id);
		} else {
			this.#ctrl.items.delete(item.id);
		}
	}
}

export type ContinuousRunTracker = {
	didUpdate(tests: Iterable<TestCase>): boolean;
	run(): void;
};

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
	if (pkg.files.size === 0) {
		// If the files haven't been resolved yet, assume there are
		// non-benchmarks.
		return false;
	}
	for (const test of pkg.allTests()) {
		if (test.kind !== 'benchmark') {
			return false;
		}
	}
	return true;
}
