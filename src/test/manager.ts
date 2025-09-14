/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestRunProfileKind, Uri, TestRunRequest as VSCTestRunRequest, CancellationTokenSource } from 'vscode';
import type { CancellationToken, Disposable, TestItem, TestTag } from 'vscode';
import type vscode from 'vscode';
import { Context, doSafe, Tail, TestController } from '../utils/testing';
import { ResolveOptions, TestResolver } from './resolver';
import { GoTestItem } from './item';
import { TestRunner } from './runner';
import { TestRunRequest } from './testRun';
import { CodeLensProvider } from './codeLens';
import { EventEmitter } from '../utils/eventEmitter';
import { TestConfig } from './config';
import { RunConfig } from './runConfig';
import { GoTestItemResolver } from './itemResolver';
import { GoTestItemPresenter } from './itemPresenter';
import { WorkspaceConfig } from './workspaceConfig';

/**
 * Entry point for the test explorer implementation.
 */
export class TestManager {
	readonly #didSave = new EventEmitter<(_: Uri) => void>();
	readonly context: Context;
	readonly #codeLens: CodeLensProvider;
	readonly #disposable: Disposable[] = [];
	readonly #run: RunConfig;
	readonly #debug: RunConfig;
	readonly #rrDebug: RunConfig;
	readonly #coverage: RunConfig;

	constructor(context: Context) {
		this.context = context;
		this.#codeLens = new CodeLensProvider(context, this);
		this.#run = new RunConfig(context, 'Run', TestRunProfileKind.Run, true, { id: 'canRun' }, true);
		this.#debug = new RunConfig(context, 'Debug', TestRunProfileKind.Debug, true, { id: 'canDebug' });
		this.#coverage = new RunConfig(context, 'Coverage', TestRunProfileKind.Coverage, true, { id: 'canRun' });

		this.#rrDebug = new RunConfig(context, 'Debug with RR', TestRunProfileKind.Debug, false, { id: 'canDebug' });
		this.#rrDebug.options.backend = 'rr';
	}

	#ctrl?: TestController;
	#resolver?: GoTestItemResolver;

	get resolver() {
		return this.#resolver;
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
		// Register the legacy code lens provider
		this.#disposable.push(
			args.registerCodeLensProvider({ language: 'go', scheme: 'file', pattern: '**/*_test.go' }, this.#codeLens),
		);

		// Set up the test controller and resolver
		const ctrl = args.createTestController('goExp', 'Go (experimental)');
		const config = new WorkspaceConfig(this.context.workspace);
		const presenter = new GoTestItemPresenter(config);
		const resolver = new GoTestItemResolver(this.context, config, presenter, ctrl);
		this.#ctrl = ctrl;
		this.#resolver = resolver;
		this.#disposable.push(ctrl);

		// Set up resolve/refresh handlers
		ctrl.resolveHandler = (item) =>
			doSafe(this.context, 'resolve test', () => {
				resolver.updateViewModel(item, { resolve: true });
			});
		ctrl.refreshHandler = () =>
			doSafe(this.context, 'refresh tests', () => {
				resolver.updateViewModel(null, { recurse: true });
			});

		// Reload code lenses whenever test items change
		resolver.onDidChangeTestItem(() => this.#codeLens.reload());

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

		if (this.context.testing || isCoverageSupported(ctrl)) {
			createRunProfile(this.#coverage);
		}

		// Update tests when a document is saved (unless we're updating on
		// edit).
		this.#disposable.push(
			this.#didSave.event((uri) => {
				const cfg = new TestConfig(this.context.workspace, uri);
				if (cfg.update() === 'on-save') {
					this.reloadUri(uri, [], true);
				}
			}),
		);
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
	runTests(...items: TestItem[]) {
		this.#executeTestRun(this.#run, new VSCTestRunRequest(items));
	}

	/**
	 * Debug a test.
	 */
	debugTests(...items: TestItem[]) {
		this.#executeTestRun(this.#debug, new VSCTestRunRequest(items));
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
			this.context,
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
		const s1 = this.#resolver.onDidInvalidateTestResults(
			async (items) => items && (await runner.queueForContinuousRun(items)),
		);

		// When a file is saved, run the queued tests in that file.
		const s2 = this.#didSave.event((e) => doSafe(this.context, 'run continuous', () => runner.runContinuous(e)));

		// Cleanup when the run is canceled
		token.onCancellationRequested(() => (s1?.dispose(), s2.dispose()));
	}

	/**
	 * Calls {@link TestResolver.reloadUri}.
	 */
	async reloadUri(...args: Tail<Parameters<TestResolver['reloadUri']>>) {
		// TODO(ethan.reesor): Can gopls emit an event when tests/etc change?

		// Only support the file: URIs. It is necessary to exclude git: URIs
		// because gopls will not handle them. Excluding everything except file:
		// may not be strictly necessary, but vscode-go currently has no support
		// for remote workspaces so it is safe for now.
		const [uri] = args;
		if (uri.scheme !== 'file') {
			return;
		}

		// Ignore anything that's not a Go file
		if (!uri.path.endsWith('.go')) {
			return;
		}

		// Ignore anything that's not in a workspace. TODO(ethan.reesor): Is it
		// reasonable to change this?
		const ws = this.context.workspace.getWorkspaceFolder(uri);
		if (!ws) {
			return;
		}

		await this.#resolver?.reloadUri(ws, ...args);
	}

	/**
	 * Notify listeners that a file was saved.
	 */
	didSave(uri: Uri) {
		this.#didSave.fire(uri);
	}

	get rootTestItems() {
		return this.#resolver?.viewRoots || [];
	}

	get rootGoTestItems() {
		return (async () => (await this.#resolver?.goRoots) || [])();
	}
}

function isCoverageSupported(ctrl: TestController) {
	const testRun = ctrl.createTestRun({ include: [], exclude: [], profile: undefined });
	testRun.end();
	return 'addCoverage' in testRun;
}
