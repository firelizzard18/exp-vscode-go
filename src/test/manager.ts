/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestRunProfileKind, Uri } from 'vscode';
import type { Disposable, TestItem } from 'vscode';
import { Context, doSafe, TestController } from './testing';
import { safeInvalidate, TestItemResolver } from './itemResolver';
import { GoTestItem, Package } from './item';
import { TestRunner, NewRun } from './runner';
import { GoTestItemProvider } from './itemProvider';
import { TestRunRequest } from './run';
import { Range } from 'vscode';

export class TestManager {
	readonly context: Context;
	readonly #provider: GoTestItemProvider;
	readonly #disposable: Disposable[] = [];

	constructor(context: Context) {
		this.context = context;
		this.#provider = new GoTestItemProvider(context);
	}

	#ctrl?: TestController;
	#resolver?: TestItemResolver<GoTestItem>;

	get enabled() {
		return !!this.#ctrl;
	}

	setup(args: { createController(id: string, label: string): TestController }) {
		this.#ctrl = args.createController('goExp', 'Go (experimental)');
		const resolver = new TestItemResolver(this.#ctrl, this.#provider);
		this.#resolver = resolver;
		this.#disposable.push(this.#ctrl, this.#resolver);

		this.#ctrl.refreshHandler = () => doSafe(this.context, 'refresh tests', () => resolver.resolve());
		this.#ctrl.resolveHandler = (item) => doSafe(this.context, 'resolve test', () => resolver.resolve(item));

		const newRun: NewRun = (r) => TestRunRequest.from(this, r);
		new TestRunner(this.context, this.#ctrl, newRun, 'Go', TestRunProfileKind.Run, true);
		new TestRunner(this.context, this.#ctrl, newRun, 'Go (debug)', TestRunProfileKind.Debug, true);
	}

	dispose() {
		this.#disposable.forEach((x) => x.dispose());
		this.#disposable.splice(0, this.#disposable.length);
		this.#ctrl = undefined;
		this.#resolver = undefined;
	}

	async reload(): Promise<void>;
	async reload(item: TestItem): Promise<void>;
	async reload(item: Uri, ranges?: Range[], invalidate?: boolean): Promise<void>;
	async reload(item?: Uri | TestItem, ranges: Range[] = [], invalidate = false) {
		if (!item || item instanceof Uri) {
			await this.#provider.reload(item, ranges, invalidate);
			return;
		}

		await this.#resolver?.resolve(item);
		if (invalidate && this.#ctrl) {
			safeInvalidate(this.#ctrl, item);
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

	get rootGoTestItems() {
		return this.#provider.getChildren();
	}
}
