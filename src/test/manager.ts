import { Context } from '@/utils/common';
import { Disposer } from '@/utils/disposable';
import { doSafe, TestController } from '@/utils/testing';
import type { CancellationToken, Range, TestItem } from 'vscode';
import vscode, {
	CancellationTokenSource,
	Event,
	EventEmitter,
	TestRunProfileKind,
	TestRunRequest,
	Uri,
	TestRunRequest as VSCTestRunRequest,
} from 'vscode';
import { CodeLensProvider } from './codeLens';
import { GoTestItem, isTestItem, ItemEvent, ModelController, Package, TestCase, TestFile } from './model';
import { ResolvedTestRunRequest } from './resolvedRunRequest';
import { RunConfig } from './run/config';
import { RunController, shouldRunBenchmarks } from './run/controller';
import { RunEvent } from './run/runEvent';
import { ContinuousRunTracker, ViewController } from './view/controller';
import { idFor, ModelViewPresenter, Presentable } from './view/presenter';
import { WorkspaceConfig } from './workspaceConfig';

export type EditorEvent =
	| { type: 'force-refresh'; item?: TestItem }
	| { type: 'config-change' }
	| { type: 'workspace-changed' }
	| { type: 'file-opened'; uri: Uri }
	| { type: 'file-created'; uri: Uri }
	| { type: 'file-deleted'; uri: Uri }
	| { type: 'file-edited'; uri: Uri; ranges: Range[] }
	| { type: 'file-saved'; uri: Uri; version: number };

type RunnableTest = Package | TestFile | TestCase;

/**
 * Entry point for the test explorer implementation.
 */
export class TestManager extends Disposer {
	readonly #context: Context;
	readonly #config: WorkspaceConfig;

	// Run configurations.
	readonly #run: RunConfig;
	readonly #debug: RunConfig;
	readonly #profile: RunConfig;
	readonly #rrDebug: RunConfig;
	readonly #coverage: RunConfig;

	readonly #docVersion = new Map<string, number>();
	readonly #continuousRuns = new Set<ContinuousRunTracker>();
	readonly #runEvents = new EventEmitter<RunEvent>();

	// Transients.
	#configureProfiles?: () => Promise<boolean>;
	#ctrl?: TestController;
	#model?: ModelController;
	#resolver?: ViewController;
	#presenter?: ModelViewPresenter;

	constructor(context: Context, editorEvents: Event<EditorEvent>) {
		super();
		this.#context = context;
		this.#config = new WorkspaceConfig(context.workspace);

		this.#run = new RunConfig(context, 'Run', TestRunProfileKind.Run, true, { id: 'canRun' }, true);
		this.#debug = new RunConfig(context, 'Debug', TestRunProfileKind.Debug, true, { id: 'canDebug' });
		this.#profile = new RunConfig(context, 'Profile', TestRunProfileKind.Run, true, { id: 'canRun' }, true);
		this.#coverage = new RunConfig(context, 'Coverage', TestRunProfileKind.Coverage, true, { id: 'canRun' });
		this.#rrDebug = new RunConfig(context, 'Debug with RR', TestRunProfileKind.Debug, false, { id: 'canDebug' });
		this.#rrDebug.options.backend = 'rr';

		this.disposeOf = editorEvents((x) => doSafe(context, x.type, () => this.#onEditorEvent(x)));
	}

	/**
	 * Whether the test explorer is enabled.
	 */
	get enabled() {
		return !!this.#ctrl;
	}

	/**
	 * Sets up the test explorer. Can be called multiple times as long as calls
	 * to {@link setup} are alternated with calls to {@link dispose}.
	 */
	setup(
		args: Pick<typeof vscode.languages, 'registerCodeLensProvider'> &
			Pick<typeof vscode.window, 'showQuickPick' | 'showWarningMessage'> & {
				createTestController(id: string, label: string): TestController;
			},
	) {
		const ctrl = args.createTestController('goExp', 'Go (experimental)');

		// Set up the components.
		const model = new ModelController(this.#context, this.#config, this.#runEvents.event);
		const presenter = new ModelViewPresenter(this.#config, model, this.#runEvents.event);
		const resolver = new ViewController(this.#context, this.#config, model, presenter, ctrl, this.#runEvents.event);
		const codeLens = new CodeLensProvider(this.#config, model);

		this.#ctrl = ctrl;
		this.#model = model;
		this.#resolver = resolver;
		this.#presenter = presenter;

		this.disposeOf = [ctrl, model, presenter, resolver];

		// Listen to update events.
		this.disposeOf = model.onDidUpdate((x) => this.#onItemEvent(x));

		// Register the legacy code lens provider.
		this.disposeOf = args.registerCodeLensProvider(
			{ language: 'go', scheme: 'file', pattern: '**/*_test.go' },
			codeLens,
		);

		// Set up resolve/refresh handlers.
		ctrl.resolveHandler = (view) =>
			doSafe(this.#context, 'resolve test', async () => {
				if (!view) {
					await this.#resolveRoots();
				} else {
					const go = resolver.resolveGoItem(view);
					go && (await this.#resolveChildren(go));
				}
			});
		ctrl.refreshHandler = () =>
			doSafe(this.#context, 'refresh tests', async () => {
				await this.#refreshRoots();
			});

		// Set up run profiles.
		const createRunProfile = (config: RunConfig) => {
			const run = (rq: VSCTestRunRequest, token: CancellationToken) => this.#executeTestRun(config, rq, token);
			this.disposeOf = config.createRunProfile(args, ctrl, run);
		};

		createRunProfile(this.#run);
		createRunProfile(this.#debug);

		if (process.platform === 'linux') {
			// RR is only supported on Linux.
			createRunProfile(this.#rrDebug);
		}

		this.#configureProfiles = () => this.#profile.configureProfiling(args);

		// Check if coverage is supported.
		const testRun = ctrl.createTestRun({ include: [], exclude: [], profile: undefined });
		testRun.end();
		if (this.#context.testing || 'addCoverage' in testRun) {
			createRunProfile(this.#coverage);
		}
	}

	/**
	 * The inverse of {@link setup}. Tears down the test explorer.
	 */
	dispose() {
		super.dispose();
		this.#ctrl = undefined;
		this.#resolver = undefined;
	}

	/**
	 * This is a workaround for https://github.com/microsoft/vscode/issues/237106
	 */
	configureCoverageRunProfile(...args: Parameters<RunConfig['configure']>) {
		this.#coverage.configure(...args);
	}

	/**
	 * Run a test.
	 */
	runTests(items: RunnableTest[] | TestRunRequest) {
		this.#executeTestRun(this.#run, items);
	}

	/**
	 * Debug a test.
	 */
	debugTests(items: RunnableTest[] | TestRunRequest) {
		this.#executeTestRun(this.#debug, items);
	}

	/**
	 * Profile a test.
	 */
	async profileTests(items: RunnableTest[] | TestRunRequest) {
		if (!(await this.#configureProfiles?.())) return;
		this.#executeTestRun(this.#profile, items);
	}

	/**
	 * Execute a test run.
	 * @param config - The config for the run.
	 * @param rq - The test run request.
	 * @param token - A token for canceling the run.
	 */
	async #executeTestRun(config: RunConfig, rq: VSCTestRunRequest | RunnableTest[], token?: CancellationToken) {
		if (!this.#resolver || !this.#presenter || !this.#ctrl || !this.#model) {
			return;
		}

		if (!token && !(rq instanceof Array) && rq.continuous) {
			throw new Error('Continuous test runs require a cancellation token');
		}

		// Create a new cancellation token if one is not provided.
		let cancel: CancellationTokenSource | undefined;
		if (!token) {
			cancel = new CancellationTokenSource();
			token = cancel.token;
		}

		const request = (await this.#resolveRunRequest(rq))!;

		// Set up the runner.
		const runner = new RunController(
			this.#context,
			this.#config,
			this.#ctrl,
			config,
			token,
			this.#resolver,
			this.#model,
			this.#runEvents,
		);

		if (rq instanceof Array || !rq.continuous) {
			// Save all files to ensure `go test` tests the latest changes
			await this.#context.workspace.saveAll(false);

			// Execute
			await runner.run(request);

			// Cancel the token if it's ours
			cancel?.cancel();
			return;
		}

		// Trigger a run when updates are committed (edits are saved).
		const tracker = request.forContinuous((rq) => doSafe(this.#context, 'run continuous', () => runner.run(rq)));
		this.#continuousRuns.add(tracker);

		// Cleanup when the run is canceled
		token.onCancellationRequested(() => {
			this.#continuousRuns.delete(tracker);
		});
	}

	async #resolveRunRequest(rq: TestRunRequest | GoTestItem[]) {
		if (!this.#model || !this.#resolver || !this.#presenter) return;

		// IDs of items to exclude. Don't try to resolve to test items because
		// those might not have been loaded yet.
		const exclude = new Set(rq instanceof Array ? [] : rq.exclude?.map((x) => x.id) ?? []);
		const isExcluded = (item: GoTestItem) => exclude.has(`${idFor(item)}`);

		// Resolve the roots (respecting the discovery setting).
		await this.#resolveRoots();

		// Resolve the included Go items. If `rq.include` is empty, all roots
		// are implicitly included.
		let include: Set<GoTestItem>;
		if (rq instanceof Array) {
			// The request specifies Go items, so we just need to execute those.
			include = new Set(rq);
		} else if (rq.include) {
			// The request specifies view items so convert those to Go items.
			// Silently ignore requests to execute test items that don't have a
			// Go item.
			include = new Set(
				rq.include.map((x) => this.#resolver!.resolveGoItem(x)).filter((x) => !!x && isTestItem(x)),
			);
		} else {
			// Include is empty, so the domain is implicitly "everything".
			include = new Set();
			for (const ws of this.#model.workspaces) {
				// If discovery is enabled, eagerly load everything.
				if (this.#config.for(ws).discovery.get() === 'on') {
					if (!ws.packages.loaded || !ws.modules.loaded) {
						await this.#model.populate(ws);
					}
					for (const mod of ws.modules) {
						if (!mod.packages.loaded) {
							await this.#model.populate(mod);
						}
					}
				}

				// Add all loaded packages to `include`.
				for (const pkg of ws.packages) {
					include.add(pkg);
				}
				for (const mod of ws.modules) {
					for (const pkg of mod.packages) {
						include.add(pkg);
					}
				}
			}
		}

		// Get packages that aren't excluded.
		const packages = new Set([...include].filter((x): x is Package => x.kind === 'package' && !isExcluded(x)));

		// The user is requesting that we run <pkg>. To do that, we need to
		// ensure the packages' files and tests have been loaded, regardless of
		// the discovery setting.
		for (const pkg of packages) {
			if (!pkg.files.loaded) {
				await this.#model.populate(pkg);
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

		// If a test is included explicitly without it's package being included,
		// add the package to the list.
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
			rq = new TestRunRequest(rq.map((x) => this.#resolver!.resolveViewItem(x)));
		}

		const excludeItems = new Set(
			[...exclude].map((x) => this.#resolver!.resolveGoItem(Uri.parse(x))).filter((x) => !!x && isTestItem(x)),
		);
		return new ResolvedTestRunRequest(
			this.#model,
			this.#presenter,
			this.#resolver,
			rq,
			packages,
			include,
			excludeItems,
			this.#runEvents,
		);
	}

	async #onEditorEvent(event: EditorEvent) {
		if (!this.#model || !this.#resolver) return;

		switch (event.type) {
			case 'force-refresh': {
				// The user explicitly requested a refresh, so we need to
				// force-refresh the view model, recursively.
				if (!event.item) {
					await this.#refreshRoots();
					return;
				}

				const go = this.#resolver.resolveGoItem(event.item);
				go && (await this.#refreshChildren(go));
				break;
			}

			case 'config-change':
				// There was a configuration change, so we need to force-refresh
				// the entire view model.
				await this.#refreshRoots();
				break;

			case 'workspace-changed':
				// The user changed workspace(s), so update the roots.
				await this.#resolveRoots();
				break;

			case 'file-opened':
				await this.#onFileEvent(event.uri);
				break;

			case 'file-created':
				await this.#onFileEvent(event.uri, { type: 'created' });
				break;
			case 'file-deleted':
				await this.#onFileEvent(event.uri, { type: 'deleted' });
				break;

			case 'file-edited': {
				// Ignore events that don't include changes. I don't know what
				// conditions trigger this, but we only care about actual changes.
				if (event.ranges.length === 0) {
					return;
				}

				await this.#onFileEvent(event.uri, { type: 'changed', ranges: event.ranges });
				break;
			}

			case 'file-saved': {
				// Only fire when the document changed. This logic is based on
				// vscode-go's GoPackageOutlineProvider. vscode-go also filters out
				// changes to documents that are not the active document, but I prefer
				// not to because that could have false negatives.
				const uri = `${event.uri}`;
				if (event.version === this.#docVersion.get(uri)) return;
				this.#docVersion.set(uri, event.version);
				await this.#onFileEvent(event.uri, { type: 'saved' });
				break;
			}
		}
	}

	async #onFileEvent(
		uri: Uri,
		event?: { type: 'changed'; ranges: Range[] } | { type: 'saved' | 'created' | 'deleted' },
	) {
		// Are tests enabled?
		if (!this.#model) return;

		// Only support the file: URIs. It is necessary to exclude git: URIs
		// because gopls will not handle them. Excluding everything except file:
		// may not be strictly necessary, but vscode-go currently has no support
		// for remote workspaces so it is safe for now.
		if (uri.scheme !== 'file') return;

		// Ignore anything that's not a Go file.
		if (!uri.path.endsWith('.go')) return;

		// Check if the file is ignored.
		const ws = this.#model.workspaceFor(uri);
		if (!ws) return;

		// Update the file. Check the update mode and set the appropriate
		// options. Manually triggered updates do not invalidate test results.
		const mode = this.#config.for(ws).update.get();
		switch (event?.type) {
			case 'saved':
				if (mode === 'on-save') {
					await this.#model.updateFile(uri, {});
				}
				break;

			case 'changed':
				if (mode === 'on-edit') {
					await this.#model.updateFile(uri, { modified: event.ranges });
				}
				break;

			default:
				await this.#model.updateFile(uri, {});
				break;
		}

		// Fire an event when unsaved changes are committed.
		if (event?.type === 'saved') {
			for (const tracker of this.#continuousRuns) {
				tracker.run();
			}
		}
	}

	#onItemEvent(updates: ItemEvent[]) {
		// Queue uncommitted updates (unsaved changes) for execution.
		const tests = updates.filter(
			(x): x is ItemEvent<TestCase> => x.item instanceof TestCase && x.type === 'modified',
		);
		for (const tracker of this.#continuousRuns) {
			tracker.didUpdate(tests.map((x) => x.item));
		}
	}

	async #resolveRoots() {
		if (!this.#model) return;

		// Populate workspaces that have discovery enabled. Do not trigger
		// creation of Workspace items for workspaces with discovery disabled.
		for (const wsf of this.#context.workspace.workspaceFolders ?? []) {
			if (this.#config.for(wsf).discovery.get() === 'on') {
				const ws = this.#model.workspaceFor(wsf);
				await this.#model.populate(ws);
			}
		}
	}

	async #resolveChildren(go: Presentable) {
		if (!this.#resolver || !this.#model) return;

		// If discovery is disabled, do nothing.
		if (this.#config.for(go).discovery.get() !== 'on') return;

		switch (go.kind) {
			case 'workspace':
			case 'module':
			case 'package':
				await this.#model.populate(go);
				break;

			default:
				// There's nothing to do here.
				break;
		}
	}

	async #refreshRoots() {
		if (!this.#model) return;

		// Resolve workspaces according to the normal rules, and refresh
		// whichever ones have been populated.

		await this.#resolveRoots();

		for (const ws of this.#model.workspaces) {
			await this.#refreshChildren(ws);
		}
	}

	async #refreshChildren(go: Presentable) {
		if (!this.#model) return;

		switch (go.kind) {
			case 'workspace':
				// If a workspace has discovery enabled, repopulate its modules
				// and packages.
				if (this.#config.for(go).discovery.get() === 'on') {
					await this.#model.populate(go);
				}

				for (const mod of go.modules) {
					await this.#refreshChildren(mod);
				}
				for (const pkg of go.packages) {
					await this.#refreshChildren(pkg);
				}
				break;

			case 'module':
				// If a module has discovery enabled, repopulate its packages.
				if (this.#config.for(go).discovery.get() === 'on') {
					await this.#model.populate(go);
				}

				for (const pkg of go.packages) {
					await this.#refreshChildren(pkg);
				}
				break;

			case 'package':
				// Unconditionally repopulate the package (this is not gated on
				// the discovery mode).
				await this.#model.populate(go);
				break;

			default:
				// Nothing to do.
				break;
		}
	}
}

export function isRunnableTest(x: unknown): x is RunnableTest {
	return isTestItem(x) && (x.kind === 'package' || x.kind === 'file' || x instanceof TestCase);
}
