/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestRunProfileKind, Uri, Range, TestRunRequest as VSCTestRunRequest, CancellationTokenSource } from 'vscode';
import type { CancellationToken, Disposable, TestItem } from 'vscode';
import type vscode from 'vscode';
import { Context, doSafe, TestController } from './testing';
import { TestItemProviderAdapter } from './itemAdapter';
import { GoTestItem, Package } from './item';
import { RunConfig, RunnerSettings, TestRunner } from './runner';
import { TestItemProvider } from './itemProvider';
import { TestRunRequest } from './run';
import { CodeLensProvider } from './codeLens';
import { EventEmitter } from '../utils/eventEmitter';

export class TestManager {
	readonly #didSave = new EventEmitter<(_: Uri) => void>();
	readonly context: Context;
	readonly #provider: TestItemProvider;
	readonly #codeLens: CodeLensProvider;
	readonly #disposable: Disposable[] = [];

	constructor(context: Context) {
		this.context = context;
		this.#provider = new TestItemProvider(context);
		this.#codeLens = new CodeLensProvider(context, this);
		this.#run = { settings: new RunnerSettings('run', this.context.state) };
		this.#debug = { settings: new RunnerSettings('debug', this.context.state) };
	}

	#ctrl?: TestController;
	#resolver?: TestItemProviderAdapter;
	readonly #run: RunConfig;
	readonly #debug: RunConfig;

	get enabled() {
		return !!this.#ctrl;
	}

	setup(
		args: Pick<typeof vscode.languages, 'registerCodeLensProvider'> &
			Pick<typeof vscode.window, 'showQuickPick'> & {
				createTestController(id: string, label: string): TestController;
			}
	) {
		this.#disposable.push(
			args.registerCodeLensProvider({ language: 'go', scheme: 'file', pattern: '**/*_test.go' }, this.#codeLens)
		);

		const ctrl = args.createTestController('goExp', 'Go (experimental)');
		const resolver = new TestItemProviderAdapter(this.context, ctrl, this.#provider);
		this.#ctrl = ctrl;
		this.#resolver = resolver;

		this.#disposable.push(
			ctrl,
			this.#provider.onDidChangeTestItem((e) => resolver.didChangeTestItem(e)),
			this.#provider.onDidInvalidateTestResults((e) => resolver.invalidateTestResults(e))
		);

		ctrl.refreshHandler = () => doSafe(this.context, 'refresh tests', () => resolver.resolve());
		ctrl.resolveHandler = (item) => doSafe(this.context, 'resolve test', () => resolver.resolve(item));

		// Normal and debug test runners
		this.#run.profile = ctrl.createRunProfile(
			'Go',
			TestRunProfileKind.Run,
			(rq, token) => this.#executeTestRun(this.#run, rq, token),
			true,
			{ id: 'canRun' },
			true
		);
		this.#debug.profile = ctrl.createRunProfile(
			'Go',
			TestRunProfileKind.Debug,
			(rq, token) => this.#executeTestRun(this.#debug, rq, token),
			true,
			{ id: 'canDebug' }
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
		if (!profile) {
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
			this.#provider,
			{ profile, ...config },
			(rq) => this.#ctrl!.createTestRun(rq.source),
			request,
			token
		);

		if (rq.continuous) {
			const s1 = this.#provider.onDidInvalidateTestResults(
				async (items) => items && (await runner.queueForContinuousRun(items))
			);
			const s2 = this.#didSave.event((e) =>
				doSafe(this.context, 'run continuous', () => runner.runContinuous(e))
			);
			token.onCancellationRequested(() => (s1.dispose(), s2.dispose()));
		} else {
			await runner.run();
		}

		cancel?.cancel();
	}

	async reload(): Promise<void>;
	async reload(item: TestItem): Promise<void>;
	async reload(item: Uri, ranges?: Range[], invalidate?: boolean): Promise<void>;
	async reload(item?: Uri | TestItem, ranges: Range[] = [], invalidate = false) {
		if (!item || item instanceof Uri) {
			await this.#provider.reload(item, ranges, invalidate);
		} else {
			await this.#resolver?.resolve(item);
		}
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

	resolveTestCase(pkg: Package, name: string) {
		return this.#provider.resolveTestCase(pkg, name);
	}

	get rootTestItems() {
		return this.#resolver!.roots;
	}

	rootGoTestItems() {
		return this.#provider.getChildren();
	}
}
