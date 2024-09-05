/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestRunProfileKind, Uri, Range, TestRunRequest as VSCTestRunRequest, CancellationTokenSource } from 'vscode';
import type { CancellationToken, Disposable, TestItem } from 'vscode';
import type vscode from 'vscode';
import { Context, doSafe, TestController } from './testing';
import { TestItemResolver } from './itemResolver';
import { GoTestItem, Package } from './item';
import { TestRunner } from './runner';
import { GoTestItemProvider } from './itemProvider';
import { TestRunRequest } from './run';
import { CodeLensProvider } from './codeLens';
import { DocumentSelector } from 'vscode';

export class TestManager {
	readonly context: Context;
	readonly #provider: GoTestItemProvider;
	readonly #codeLens: CodeLensProvider;
	readonly #disposable: Disposable[] = [];

	constructor(context: Context) {
		this.context = context;
		this.#provider = new GoTestItemProvider(context);
		this.#codeLens = new CodeLensProvider(context, this);
	}

	#ctrl?: TestController;
	#resolver?: TestItemResolver<GoTestItem>;
	#testRunner?: TestRunner;
	#testDebugger?: TestRunner;

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
		const resolver = new TestItemResolver(ctrl, this.#provider);
		this.#ctrl = ctrl;
		this.#resolver = resolver;
		this.#disposable.push(ctrl, this.#resolver);

		ctrl.refreshHandler = () => doSafe(this.context, 'refresh tests', () => resolver.resolve());
		ctrl.resolveHandler = (item) => doSafe(this.context, 'resolve test', () => resolver.resolve(item));

		// Normal and debug test runners
		this.#testRunner = new TestRunner(this.context, (r) =>
			ctrl.createRunProfile(
				'Go',
				TestRunProfileKind.Run,
				(rq, token) => this.#run(r, rq, token),
				true,
				undefined
				// TODO: Enable continuous testing
			)
		);
		this.#testDebugger = new TestRunner(this.context, (r) =>
			ctrl.createRunProfile('Go (debug)', TestRunProfileKind.Debug, (rq, token) => this.#run(r, rq, token))
		);
	}

	dispose() {
		this.#disposable.forEach((x) => x.dispose());
		this.#disposable.splice(0, this.#disposable.length);
		this.#ctrl = undefined;
		this.#resolver = undefined;
		this.#testRunner = undefined;
		this.#testDebugger = undefined;
	}

	runTest(item: TestItem) {
		const cancel = new CancellationTokenSource();
		this.#run(this.#testRunner!, new VSCTestRunRequest([item]), cancel.token);
	}

	debugTest(item: TestItem) {
		const cancel = new CancellationTokenSource();
		this.#run(this.#testDebugger!, new VSCTestRunRequest([item]), cancel.token);
	}

	async #run(runner: TestRunner, rq: VSCTestRunRequest, token: CancellationToken) {
		if (rq.continuous) {
			// TODO:
			//  - Filter based on the original request
			//  - Don't run tests until the user hits Ctrl+S, but remember which tests need to be re-run

			const sub = this.#provider.onDidInvalidateTestResults(async (items) => {
				if (!items) {
					await this.#run(runner, new VSCTestRunRequest(), token);
					return;
				}

				const x = await Promise.all(items.map((x) => this.#resolver?.get(x)));
				await this.#run(runner, new VSCTestRunRequest(x.filter((x) => x) as TestItem[]), token);
			});
			token.onCancellationRequested(() => sub.dispose());
		}

		const request = await TestRunRequest.from(this, rq);
		const run = this.#ctrl!.createTestRun(rq);
		await runner.run(request, run, token);
	}

	async reload(): Promise<void>;
	async reload(item: TestItem): Promise<void>;
	async reload(item: Uri, ranges?: Range[], invalidate?: boolean): Promise<void>;
	async reload(item?: Uri | TestItem, ranges: Range[] = [], invalidate = false) {
		if (!item || item instanceof Uri) {
			await this.#provider.reload(item, ranges, invalidate);
		} else {
			await this.#resolver?.resolve(item);
			invalidate && this.#ctrl?.invalidateTestResults?.(item);
		}
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
		return this.#resolver?.getProviderItem(id);
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
