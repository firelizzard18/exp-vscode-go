/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestRunProfileKind, Uri, Range, TestRunRequest as VSCTestRunRequest, CancellationTokenSource } from 'vscode';
import type { CancellationToken, Disposable, TestItem, TestRunProfile } from 'vscode';
import type vscode from 'vscode';
import { Context, doSafe, TestController } from './testing';
import { TestItemProviderAdapter } from './itemAdapter';
import { GoTestItem, Package } from './item';
import { TestRunner } from './runner';
import { TestItemProvider } from './itemProvider';
import { TestRunRequest } from './run';
import { CodeLensProvider } from './codeLens';
import { DocumentSelector } from 'vscode';
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
	}

	#ctrl?: TestController;
	#resolver?: TestItemProviderAdapter;
	#runProfile?: TestRunProfile;
	#debugProfile?: TestRunProfile;

	get enabled() {
		return !!this.#ctrl;
	}

	setup(args: {
		createTestController(id: string, label: string): TestController;
		registerCodeLensProvider(selector: DocumentSelector, provider: vscode.CodeLensProvider): Disposable;
	}) {
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
		this.#runProfile = ctrl.createRunProfile(
			'Go',
			TestRunProfileKind.Run,
			(rq, token) => this.#run(this.#runProfile, rq, token),
			true,
			undefined,
			true
		);
		this.#debugProfile = ctrl.createRunProfile(
			'Go (debug)',
			TestRunProfileKind.Debug,
			(rq, token) => this.#run(this.#debugProfile, rq, token),
			false,
			{ id: 'canDebug' }
		);
		this.#disposable.push(this.#debugProfile, this.#runProfile);
	}

	dispose() {
		this.#disposable.forEach((x) => x.dispose());
		this.#disposable.splice(0, this.#disposable.length);
		this.#ctrl = undefined;
		this.#resolver = undefined;
		this.#runProfile = undefined;
		this.#debugProfile = undefined;
	}

	runTest(item: TestItem) {
		this.#run(this.#runProfile, new VSCTestRunRequest([item]));
	}

	debugTest(item: TestItem) {
		this.#run(this.#debugProfile, new VSCTestRunRequest([item]));
	}

	async #run(profile: TestRunProfile | undefined, rq: VSCTestRunRequest, token?: CancellationToken) {
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
			profile,
			(rq) => this.#ctrl!.createTestRun(rq.source),
			request,
			token
		);

		if (rq.continuous) {
			const s1 = this.#provider.onDidInvalidateTestResults(
				async (items) => items && (await runner.invalidate(items))
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
