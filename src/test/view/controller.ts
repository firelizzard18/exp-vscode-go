import { Context } from '@/utils/common';
import { Disposer } from '@/utils/disposable';
import { TestController } from '@/utils/testing';
import { Event, TestItem, Uri } from 'vscode';
import { WorkspaceConfig } from '../config';
import { GoTestItem, ItemEvent, ModelController, StaticTestCase, TestCase } from '../model';
import { RunEvent } from '../run/controller';
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
		runEvent: Event<RunEvent>,
	) {
		super();
		this.#context = context;
		this.#config = config;
		this.#model = model;
		this.#presenter = presenter;
		this.#ctrl = ctrl;

		this.disposeOf = model.onDidUpdate((x) => this.#onItemEvent(x));
		this.disposeOf = runEvent((x) => this.#onRunEvent(x));
	}

	resolveViewItem(go: Presentable) {
		go = this.#presenter.asPresented(go);
		return this.#syncViewItem(go);
	}

	resolveGoItem(view: TestItem | Uri) {
		const go = this.#getPresentable(view);
		if (go) return go;
		if (!(view instanceof Uri)) this.#delete(view);
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

			for (const child of this.#presenter.getChildren(parent)) {
				if (!(child instanceof ProfileItem)) continue;
				if (child.profile.type.id !== id.profile) continue;
				if (child.profile.time.getTime() !== id.at?.getTime()) continue;
				return child;
			}
			return;
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

		// Scan the modules.
		if (id.kind === 'module') {
			for (const mod of ws.modules) {
				if (`${mod.uri}` === `${uri}`) {
					return mod;
				}
			}
			return;
		}

		// Scan packages. Look for a package who's URI matches the target directory.
		const dir = id.kind === 'package' ? uri : Uri.joinPath(uri, '..');
		for (const pkg of ws.allPackages()) {
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

	#getViewItem(go: Presentable): TestItem | undefined {
		// Get the item-as-presented.
		go = this.#presenter.asPresented(go);

		// If the item has no (view) parent, check the root.
		const parent = this.#presenter.getParent(go);
		if (!parent) {
			return this.#ctrl.items.get(`${idFor(go)}`);
		}

		// Otherwise, check the parent's children.
		return this.#getViewItem(parent)?.children.get(`${idFor(go)}`);
	}

	#syncViewItem(go: Presentable): TestItem {
		// Get the item-as-presented.
		go = this.#presenter.asPresented(go);

		// Push the ancestry chain.
		const stack = [go];
		for (;;) {
			const item = this.#presenter.getParent(stack[stack.length - 1]);
			if (!item) break;
			stack.push(item);
		}

		// Pop down the chain, starting from the roots.
		let items = this.#ctrl.items;
		let view: TestItem | undefined;
		for (;;) {
			// Check for an existing item.
			const go = stack.pop()!;
			const id = `${idFor(go)}`;
			view = items.get(id);
			if (!view) {
				// Create a new one.
				view = this.#ctrl.createTestItem(id, this.#presenter.labelFor(go), 'uri' in go ? go.uri : undefined);

				// Add it to the parent's children.
				items.add(view);
			}

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

			// If the stack is empty, stop.
			if (stack.length === 0) return view;

			// Otherwise, update the item set.
			items = view.children;
		}
	}

	#syncChildren(go: Presentable, opts: { recurse?: boolean } = {}) {
		// Get the item-as-presented.
		go = this.#presenter.asPresented(go);
		const queue: Presentable[] = [go];

		while (queue.length > 0) {
			// Get the next item on the queue.
			const go = queue.shift()!;

			// Get or create the view item.
			const view = this.#syncViewItem(go);

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
					this.#syncViewItem(go);
				}
			}

			if (opts.recurse === true) {
				queue.push(...goChildren);
			}
		}
	}

	#delete(item: TestItem) {
		if (item.parent) {
			item.parent.children.delete(item.id);
		} else {
			this.#ctrl.items.delete(item.id);
		}
	}

	#onItemEvent(events: ItemEvent[]) {
		for (const event of events) {
			switch (event.type) {
				case 'added':
				case 'modified':
				case 'moved': {
					// Get the view item and ensure it's up to date. Do not
					// sync children - separate events should be emitted for
					// them.
					this.#syncViewItem(event.item);
					break;
				}

				case 'removed': {
					// Get the view item, if it exists, and delete it.
					const view = this.#getViewItem(event.item);
					if (view) this.#delete(view);
					break;
				}
			}
		}

		// Invalidate test results when tests are modified.
		const tests = events.filter(
			(x): x is ItemEvent<TestCase> =>
				// If a test case is modified
				(x.item instanceof TestCase && x.type === 'modified') ||
				// Or a _static_ test case is added;
				(x.type === 'added' && x.item instanceof StaticTestCase),
		);
		if (tests.length) {
			this.#ctrl.invalidateTestResults?.(tests.map((x) => this.#getViewItem(x.item)).filter((x) => !!x));
		}
	}

	#onRunEvent(event: RunEvent) {
		if (event.type !== 'captured') return;

		// Parallel what the presenter does so we can refresh the correct item
		// (and not refresh too much). This is gross, but it seems like the
		// least gross option.

		// The presenter may decide to attach the profile to something other
		// than the scope we passed it, so we need to update the scope. For
		// example, if the target item is a dynamic test case, the presenter
		// will walk up the chain until it reaches a static test case, since
		// dynamic test cases get deleted each time the parent test is run. This
		// also calls item-as-presented.
		const scope = this.#presenter.resolveProfilesParent(event.scope);

		// Update the view model. Because the presentation items for profiles
		// don't actually exist in the data model, to make them appear we need
		// to recursively update the scope and it's children.
		this.#syncChildren(scope, { recurse: true });

		// Remove when the run is disposed.
		if (event.run.onDidDispose) {
			this.disposeOf = event.run.onDidDispose(() => {
				this.#syncChildren(scope, { recurse: true });
			});
		}
	}
}
