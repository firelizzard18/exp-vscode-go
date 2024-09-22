/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestRunProfileKind, Uri, Range, TestRunRequest as VSCTestRunRequest, CancellationTokenSource } from 'vscode';
import type { CancellationToken, Disposable, TestItem } from 'vscode';
import type vscode from 'vscode';
import { Context, doSafe, Tail, TestController } from './testing';
import { TestResolver } from './resolver';
import { GoTestItem, Package } from './item';
import { RunConfig, RunnerSettings, TestRunner } from './runner';
import { TestRunRequest } from './run';
import { CodeLensProvider } from './codeLens';
import { EventEmitter } from '../utils/eventEmitter';

export class TestManager {
	readonly #didSave = new EventEmitter<(_: Uri) => void>();
	readonly context: Context;
	readonly #codeLens: CodeLensProvider;
	readonly #disposable: Disposable[] = [];

	constructor(context: Context) {
		this.context = context;
		this.#codeLens = new CodeLensProvider(context, this);
		this.#run = { settings: new RunnerSettings('run', this.context.state) };
		this.#debug = { settings: new RunnerSettings('debug', this.context.state) };
	}

	#ctrl?: TestController;
	#resolver?: TestResolver;
	readonly #run: RunConfig;
	readonly #debug: RunConfig;

	get enabled() {
		return !!this.#ctrl;
	}

	setup(
		args: Pick<typeof vscode.languages, 'registerCodeLensProvider'> &
			Pick<typeof vscode.window, 'showQuickPick'> & {
				createTestController(id: string, label: string): TestController;
			},
	) {
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

		// Normal and debug test runners
		this.#run.profile = ctrl.createRunProfile(
			'Run',
			TestRunProfileKind.Run,
			(rq, token) => this.#executeTestRun(this.#run, rq, token),
			true,
			{ id: 'canRun' },
			true,
		);
		this.#debug.profile = ctrl.createRunProfile(
			'Debug',
			TestRunProfileKind.Debug,
			(rq, token) => this.#executeTestRun(this.#debug, rq, token),
			true,
			{ id: 'canDebug' },
		);
		this.#disposable.push(this.#debug.profile, this.#run.profile);

		this.#run.profile.configureHandler = () =>
			doSafe(this.context, 'configure profile', () => this.#run.settings.configure(args));
		this.#debug.profile.configureHandler = () =>
			doSafe(this.context, 'configure profile', () => this.#debug.settings.configure(args));
	}

	dispose() {
		this.#disposable.forEach((x) => x.dispose());
		this.#disposable.splice(0, this.#disposable.length);
		this.#ctrl = undefined;
		this.#resolver = undefined;
		this.#run.profile = undefined;
		this.#debug.profile = undefined;
	}

	runTest(item: TestItem) {
		this.#executeTestRun(this.#run, new VSCTestRunRequest([item]));
	}

	debugTest(item: TestItem) {
		if (!this.#debug) return;
		this.#executeTestRun(this.#debug, new VSCTestRunRequest([item]));
	}

	async #executeTestRun({ profile, ...config }: RunConfig, rq: VSCTestRunRequest, token?: CancellationToken) {
		if (!profile || !this.#resolver) {
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
			{ profile, ...config },
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
