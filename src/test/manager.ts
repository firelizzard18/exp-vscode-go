/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestRunProfileKind, Uri, TestRunRequest as VSCTestRunRequest, CancellationTokenSource } from 'vscode';
import type { CancellationToken, Disposable, TestItem, TestTag } from 'vscode';
import type vscode from 'vscode';
import { Context, doSafe, Tail, TestController } from './testing';
import { TestResolver } from './resolver';
import { GoTestItem } from './item';
import { TestRunner } from './runner';
import { TestRunRequest } from './run';
import { CodeLensProvider } from './codeLens';
import { EventEmitter } from '../utils/eventEmitter';
import { RunConfig } from './config';

export class TestManager {
	readonly #didSave = new EventEmitter<(_: Uri) => void>();
	readonly context: Context;
	readonly #codeLens: CodeLensProvider;
	readonly #disposable: Disposable[] = [];

	constructor(context: Context) {
		this.context = context;
		this.#codeLens = new CodeLensProvider(context, this);
		this.#run = new RunConfig(context, 'Run', TestRunProfileKind.Run, true, { id: 'canRun' }, true);
		this.#debug = new RunConfig(context, 'Debug', TestRunProfileKind.Debug, true, { id: 'canDebug' });
		this.#coverage = new RunConfig(context, 'Coverage', TestRunProfileKind.Coverage, true, { id: 'canRun' });
	}

	#ctrl?: TestController;
	#resolver?: TestResolver;
	readonly #run: RunConfig;
	readonly #debug: RunConfig;
	readonly #coverage: RunConfig;

	get enabled() {
		return !!this.#ctrl;
	}

	async setup(
		args: Pick<typeof vscode.languages, 'registerCodeLensProvider'> &
			Pick<typeof vscode.window, 'showQuickPick' | 'showWarningMessage'> & {
				createTestController(id: string, label: string): TestController;
			},
	) {
		// Verify that gopls is new enough to support the packages command
		try {
			await this.context.commands.packages({ Files: [] });
		} catch (error) {
			if (!`${error}`.match(/^Error: command '.*' not found$/)) {
				throw error;
			}

			await args.showWarningMessage('gopls is not installed or does not support test discovery');
			return;
		}

		this.#disposable.push(
			args.registerCodeLensProvider({ language: 'go', scheme: 'file', pattern: '**/*_test.go' }, this.#codeLens),
		);

		const ctrl = args.createTestController('goExp', 'Go (experimental)');
		const resolver = new TestResolver(this.context, ctrl);
		this.#ctrl = ctrl;
		this.#resolver = resolver;
		this.#disposable.push(ctrl);

		resolver.onDidChangeTestItem(() => this.#codeLens.reload());

		ctrl.refreshHandler = () => doSafe(this.context, 'refresh tests', () => resolver.reloadView());
		ctrl.resolveHandler = (item) =>
			doSafe(this.context, 'resolve test', () => (item ? resolver.reloadViewItem(item) : resolver.reloadView()));

		// Set up run profiles
		const createRunProfile = (config: RunConfig) => {
			const run = (rq: VSCTestRunRequest, token: CancellationToken) => this.#executeTestRun(config, rq, token);
			const profile = config.createRunProfile(args, ctrl, run);
			this.#disposable.push(profile);
		};

		createRunProfile(this.#run);
		createRunProfile(this.#debug);

		if (this.context.testing || isCoverageSupported(ctrl)) {
			createRunProfile(this.#coverage);
		}
	}

	dispose() {
		this.#disposable.forEach((x) => x.dispose());
		this.#disposable.splice(0, this.#disposable.length);
		this.#ctrl = undefined;
		this.#resolver = undefined;
	}

	runTest(item: TestItem) {
		this.#executeTestRun(this.#run, new VSCTestRunRequest([item]));
	}

	debugTest(item: TestItem) {
		if (!this.#debug) return;
		this.#executeTestRun(this.#debug, new VSCTestRunRequest([item]));
	}

	async #executeTestRun(config: RunConfig, rq: VSCTestRunRequest, token?: CancellationToken) {
		if (!this.#resolver) {
			return;
		}

		if (!token && rq.continuous) {
			throw new Error('Continuous test runs require a CancellationToken');
		}

		let cancel: CancellationTokenSource | undefined;
		if (!token) {
			cancel = new CancellationTokenSource();
			token = cancel.token;
		}

		const request = await TestRunRequest.from(this, rq);
		const runner = new TestRunner(
			this.context,
			this.#resolver,
			config,
			(rq) => this.#ctrl!.createTestRun(rq.source),
			request,
			token,
		);

		if (rq.continuous) {
			const s1 = this.#resolver.onDidInvalidateTestResults(
				async (items) => items && (await runner.queueForContinuousRun(items)),
			);
			const s2 = this.#didSave.event((e) =>
				doSafe(this.context, 'run continuous', () => runner.runContinuous(e)),
			);
			token.onCancellationRequested(() => (s1?.dispose(), s2.dispose()));
		} else {
			await runner.run();
		}

		cancel?.cancel();
	}

	async reloadView(...args: Parameters<TestResolver['reloadView']>) {
		await this.#resolver?.reloadView(...args);
	}

	async reloadViewItem(...args: Parameters<TestResolver['reloadViewItem']>) {
		await this.#resolver?.reloadViewItem(...args);
	}

	async reloadGoItem(...args: Parameters<TestResolver['reloadGoItem']>) {
		await this.#resolver?.reloadGoItem(...args);
	}

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

	didSave(uri: Uri) {
		this.#didSave.fire(uri);
	}

	resolveTestItem(goItem: GoTestItem): Promise<TestItem | undefined>;
	resolveTestItem(goItem: GoTestItem, create: true): Promise<TestItem>;
	resolveTestItem(goItem: GoTestItem, create = false) {
		if (!create) {
			return this.#resolver?.get(goItem);
		}
		return this.#resolver!.getOrCreateAll(goItem);
	}

	resolveGoTestItem(id: string) {
		return this.#resolver?.getGoItem(id);
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
