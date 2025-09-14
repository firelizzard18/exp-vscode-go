import { TestRunProfileKind, Uri, TestRunRequest as VSCTestRunRequest, CancellationTokenSource } from 'vscode';
import type { CancellationToken, Disposable, Range, TestItem, TextDocument, TextDocumentChangeEvent } from 'vscode';
import vscode from 'vscode';
import { Context, doSafe, TestController } from '../utils/testing';
import { GoTestItem, TestCase } from './model';
import { TestRunner } from './runner';
import { TestRunRequest } from './testRun';
import { CodeLensProvider } from './codeLens';
import { EventEmitter } from '../utils/eventEmitter';
import { RunConfig } from './runConfig';
import { GoTestItemResolver, ModelUpdateEvent } from './itemResolver';
import { GoTestItemPresenter } from './itemPresenter';
import { WorkspaceConfig } from './workspaceConfig';

/**
 * Entry point for the test explorer implementation.
 */
export class TestManager {
	readonly #didInvalidate = new EventEmitter<(_: TestCase[]) => void>();
	readonly #context: Context;
	readonly #config: WorkspaceConfig;
	readonly #disposable: Disposable[] = [];
	readonly #run: RunConfig;
	readonly #debug: RunConfig;
	readonly #rrDebug: RunConfig;
	readonly #coverage: RunConfig;
	readonly #docVersion = new Map<string, number>();

	constructor(context: Context) {
		this.#context = context;
		this.#config = new WorkspaceConfig(context.workspace);
		this.#run = new RunConfig(context, 'Run', TestRunProfileKind.Run, true, { id: 'canRun' }, true);
		this.#debug = new RunConfig(context, 'Debug', TestRunProfileKind.Debug, true, { id: 'canDebug' });
		this.#coverage = new RunConfig(context, 'Coverage', TestRunProfileKind.Coverage, true, { id: 'canRun' });

		this.#rrDebug = new RunConfig(context, 'Debug with RR', TestRunProfileKind.Debug, false, { id: 'canDebug' });
		this.#rrDebug.options.backend = 'rr';
	}

	#ctrl?: TestController;
	#resolver?: GoTestItemResolver;

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
		const presenter = new GoTestItemPresenter(this.#config);
		const ctrl = args.createTestController('goExp', 'Go (experimental)');
		const resolver = new GoTestItemResolver(this.#context, this.#config, presenter, ctrl);
		const codeLens = new CodeLensProvider(this.#config, resolver);

		// Register the legacy code lens provider
		this.#disposable.push(
			args.registerCodeLensProvider({ language: 'go', scheme: 'file', pattern: '**/*_test.go' }, codeLens),
		);

		// Set up the test controller and resolver
		this.#ctrl = ctrl;
		this.#resolver = resolver;
		this.#disposable.push(ctrl);

		// Set up resolve/refresh handlers
		ctrl.resolveHandler = (item) =>
			doSafe(this.#context, 'resolve test', async () => {
				await this.#didUpdate(await resolver.updateViewModel(item, { resolve: true }));
			});
		ctrl.refreshHandler = () =>
			doSafe(this.#context, 'refresh tests', async () => {
				await this.refresh();
			});

		// Set up run profiles
		const createRunProfile = (config: RunConfig) => {
			const run = (rq: VSCTestRunRequest, token: CancellationToken) => this.#executeTestRun(config, rq, token);
			const profile = config.createRunProfile(args, ctrl, run);
			this.#disposable.push(profile);
		};

		createRunProfile(this.#run);
		createRunProfile(this.#debug);

		if (process.platform === 'linux') {
			// RR is only supported on Linux
			createRunProfile(this.#rrDebug);
		}

		if (this.#context.testing || isCoverageSupported(ctrl)) {
			createRunProfile(this.#coverage);
		}
	}

	/**
	 * The inverse of {@link setup}. Tears down the test explorer.
	 */
	dispose() {
		this.#disposable.forEach((x) => x.dispose());
		this.#disposable.splice(0, this.#disposable.length);
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
	runTests(...items: TestItem[] | GoTestItem[]) {
		this.#executeTestRun(this.#run, new VSCTestRunRequest(items));
	}

	/**
	 * Debug a test.
	 */
	debugTests(...items: TestItem[] | GoTestItem[]) {
		this.#executeTestRun(this.#debug, new VSCTestRunRequest(items));
	}

	/**
	 * Refreshes a test item and its descendants, or the entire tree if called
	 * without an item. Unless `options.recurse` is disabled, in which case only
	 * the item itself and it's direct children are updated.
	 */
	async refresh(item?: TestItem, options: { recurse?: boolean } = { recurse: true }) {
		if (!this.#resolver) return;
		await this.#didUpdate(await this.#resolver.updateViewModel(item, options));
	}

	/**
	 * Process model update events.
	 */
	async #didUpdate(events: ModelUpdateEvent[], opts: { invalidate?: boolean } = {}) {
		if (!this.#ctrl) return;

		// Invalidate test results when tests are modified.
		if (opts.invalidate) {
			const tests = events.filter(
				(x): x is ModelUpdateEvent<TestCase> => x.item instanceof TestCase && x.type === 'modified',
			);
			this.#ctrl.invalidateTestResults?.(tests.map((x) => x.view).filter((x) => !!x));
			await this.#didInvalidate.fire(tests.map((x) => x.item));
		}
	}

	/**
	 * Execute a test run.
	 * @param config - The config for the run.
	 * @param rq - The test run request.
	 * @param token - A token for canceling the run.
	 */
	async #executeTestRun(config: RunConfig, rq: VSCTestRunRequest, token?: CancellationToken) {
		if (!this.#resolver) {
			return;
		}

		if (!token && rq.continuous) {
			throw new Error('Continuous test runs require a cancellation token');
		}

		// Create a new cancellation token if one is not provided.
		let cancel: CancellationTokenSource | undefined;
		if (!token) {
			cancel = new CancellationTokenSource();
			token = cancel.token;
		}

		// Resolve VSCode test items to Go test items.
		const request = await TestRunRequest.from(this, rq);

		// Set up the runner.
		const runner = new TestRunner(
			this.#context,
			this.#resolver,
			config,
			(rq) => this.#ctrl!.createTestRun(rq.source),
			request,
			token,
		);

		if (!rq.continuous) {
			// Execute
			await runner.run();

			// Cancel the token if it's ours
			cancel?.cancel();
			return;
		}

		// When a test's result is invalidated, queue it for running.
		const s1 = this.#didInvalidate.event(async (items) => items && (await runner.queueForContinuousRun(items)));

		// When a file is saved, run the queued tests in that file.
		const s2 = this.#didSave.event((e) => doSafe(this.#context, 'run continuous', () => runner.runContinuous(e)));

		// Cleanup when the run is canceled
		token.onCancellationRequested(() => (s1?.dispose(), s2.dispose()));
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

		// Check the update mode and set the appropriate options. Manually
		// triggered updates do not invalidate test results.
		let options: { modified?: Range[]; invalidate: boolean } = { invalidate: true };
		const mode = this.#config.for(ws).update.get();
		switch (event?.type) {
			case 'saved':
				if (mode != 'on-save') return;
				break;

			case 'changed':
				if (mode != 'on-edit') return;
				options.modified = event.ranges;
				return;

			default:
				options.invalidate = false;
				break;
		}

		const { updates } = await this.#resolver.updateFile(uri, options);
		await this.#didUpdate(updates, options);
	}
}

function isCoverageSupported(ctrl: TestController) {
	const testRun = ctrl.createTestRun({ include: [], exclude: [], profile: undefined });
	testRun.end();
	return 'addCoverage' in testRun;
}
