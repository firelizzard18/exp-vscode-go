import { Context } from '@/utils/common';
import { Disposer } from '@/utils/disposable';
import { doSafe, TestController } from '@/utils/testing';
import type { CancellationToken, Range, TestItem, TextDocument, TextDocumentChangeEvent } from 'vscode';
import vscode, {
	CancellationTokenSource,
	TestRunProfileKind,
	TestRunRequest,
	Uri,
	TestRunRequest as VSCTestRunRequest,
} from 'vscode';
import { CodeLensProvider } from './codeLens';
import { GoTestItem, ItemEvent, ModelController, TestCase } from './model';
import { ProfileTracker } from './profiles';
import { RunConfig } from './run/config';
import { RunController } from './run/controller';
import { ContinuousRunTracker, ViewController } from './view/controller';
import { ModelViewPresenter } from './view/presenter';
import { WorkspaceConfig } from './workspaceConfig';

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

	// Events.
	readonly #docVersion = new Map<string, number>();
	readonly #continuousRuns = new Set<ContinuousRunTracker>();

	// Transients.
	#configureProfiles?: () => Promise<boolean>;
	#ctrl?: TestController;
	#model?: ModelController;
	#resolver?: ViewController;
	#presenter?: ModelViewPresenter;

	constructor(context: Context) {
		super();
		this.#context = context;
		this.#config = new WorkspaceConfig(context.workspace);

		this.#run = new RunConfig(context, 'Run', TestRunProfileKind.Run, true, { id: 'canRun' }, true);
		this.#debug = new RunConfig(context, 'Debug', TestRunProfileKind.Debug, true, { id: 'canDebug' });
		this.#profile = new RunConfig(context, 'Profile', TestRunProfileKind.Run, true, { id: 'canRun' }, true);
		this.#coverage = new RunConfig(context, 'Coverage', TestRunProfileKind.Coverage, true, { id: 'canRun' });
		this.#rrDebug = new RunConfig(context, 'Debug with RR', TestRunProfileKind.Debug, false, { id: 'canDebug' });
		this.#rrDebug.options.backend = 'rr';
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
	async setup(
		args: Pick<typeof vscode.languages, 'registerCodeLensProvider'> &
			Pick<typeof vscode.window, 'showQuickPick' | 'showWarningMessage'> & {
				createTestController(id: string, label: string): TestController;
			},
	) {
		const ctrl = args.createTestController('goExp', 'Go (experimental)');

		// Set up the components.
		const model = new ModelController(this.#context, this.#config);
		const profiles = new ProfileTracker();
		const presenter = new ModelViewPresenter(this.#config, model, profiles);
		const resolver = new ViewController(this.#context, this.#config, model, presenter, ctrl);
		const codeLens = new CodeLensProvider(this.#config, resolver);

		this.#ctrl = ctrl;
		this.#model = model;
		this.#resolver = resolver;
		this.#presenter = presenter;

		this.disposeOf = [ctrl, resolver, presenter];

		// Listen to update events.
		model.onDidUpdate((events) => {
			this.#didUpdate(events);
		});

		// Register the legacy code lens provider.
		this.disposeOf = args.registerCodeLensProvider(
			{ language: 'go', scheme: 'file', pattern: '**/*_test.go' },
			codeLens,
		);

		// Set up resolve/refresh handlers.
		ctrl.resolveHandler = (item) =>
			doSafe(this.#context, 'resolve test', async () => {
				await resolver.updateViewModel(item, { resolve: true });
			});
		ctrl.refreshHandler = () =>
			doSafe(this.#context, 'refresh tests', async () => {
				await this.refresh();
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
	runTests(items: GoTestItem[] | TestRunRequest) {
		this.#executeTestRun(this.#run, items);
	}

	/**
	 * Debug a test.
	 */
	debugTests(items: GoTestItem[] | TestRunRequest) {
		this.#executeTestRun(this.#debug, items);
	}

	/**
	 * Profile a test.
	 */
	async profileTests(items: GoTestItem[] | TestRunRequest) {
		if (!(await this.#configureProfiles?.())) return;
		this.#executeTestRun(this.#profile, items);
	}

	/**
	 * Refreshes a test item and its descendants, or the entire tree if called
	 * without an item. Unless `options.recurse` is disabled, in which case only
	 * the item itself and it's direct children are updated.
	 */
	async refresh(item?: TestItem, options: { recurse?: boolean } = { recurse: true }) {
		if (!this.#resolver) return;
		await this.#resolver.updateViewModel(item, options);
	}

	/**
	 * Execute a test run.
	 * @param config - The config for the run.
	 * @param rq - The test run request.
	 * @param token - A token for canceling the run.
	 */
	async #executeTestRun(config: RunConfig, rq: VSCTestRunRequest | GoTestItem[], token?: CancellationToken) {
		if (!this.#resolver || !this.#presenter || !this.#ctrl || !this.#model) {
			throw new Error('Cannot execute test run: test explorer is disabled');
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

		const request = await this.#resolver.resolveRunRequest(rq);

		// Set up the runner.
		const runner = new RunController(
			this.#context,
			this.#config,
			this.#ctrl,
			config,
			token,
			this.#resolver,
			this.#model,
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

	/**
	 * Notify listeners that a file was saved.
	 */
	async didSaveTextDocument(doc: TextDocument) {
		// Only fire when the document changed. This logic is based on
		// vscode-go's GoPackageOutlineProvider. vscode-go also filters out
		// changes to documents that are not the active document, but I prefer
		// not to because that could have false negatives.
		const uri = `${doc.uri}`;
		if (doc.version === this.#docVersion.get(uri)) return;
		this.#docVersion.set(uri, doc.version);
		await this.updateFile(doc.uri, { type: 'saved' });
	}

	async didChangeTextDocument(event: TextDocumentChangeEvent) {
		// Ignore events that don't include changes. I don't know what
		// conditions trigger this, but we only care about actual changes.
		if (event.contentChanges.length === 0) {
			return;
		}

		await this.updateFile(event.document.uri, {
			type: 'changed',
			ranges: event.contentChanges.map((x) => x.range),
		});
	}

	async updateFile(
		uri: Uri,
		event?: { type: 'changed'; ranges: Range[] } | { type: 'saved' | 'created' | 'deleted' },
	) {
		// TODO(ethan.reesor): Can gopls emit an event when tests/etc change?

		// Are tests enabled?
		if (!this.#resolver) return;

		// Only support the file: URIs. It is necessary to exclude git: URIs
		// because gopls will not handle them. Excluding everything except file:
		// may not be strictly necessary, but vscode-go currently has no support
		// for remote workspaces so it is safe for now.
		if (uri.scheme !== 'file') return;

		// Ignore anything that's not a Go file.
		if (!uri.path.endsWith('.go')) return;

		// Check if the file is ignored.
		const ws = this.#resolver.workspaceFor(uri);
		if (!ws) return;

		// Update the file. Check the update mode and set the appropriate
		// options. Manually triggered updates do not invalidate test results.
		const mode = this.#config.for(ws).update.get();
		switch (event?.type) {
			case 'saved':
				if (mode === 'on-save') {
					await this.#resolver.updateFile(uri, {});
				}
				break;

			case 'changed':
				if (mode === 'on-edit') {
					await this.#resolver.updateFile(uri, { modified: event.ranges });
				}
				break;

			default:
				await this.#resolver.updateFile(uri, {});
				break;
		}

		// Fire an event when unsaved changes are committed.
		if (event?.type === 'saved') {
			for (const tracker of this.#continuousRuns) {
				tracker.run();
			}
		}
	}

	#didUpdate(updates: ItemEvent[]) {
		// Queue uncommitted updates (unsaved changes) for execution.
		const tests = updates.filter(
			(x): x is ItemEvent<TestCase> => x.item instanceof TestCase && x.type === 'modified',
		);
		for (const tracker of this.#continuousRuns) {
			tracker.didUpdate(tests.map((x) => x.item));
		}
	}
}
