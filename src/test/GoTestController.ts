/* eslint-disable @typescript-eslint/no-explicit-any */
import { TestRunProfileKind, Uri } from 'vscode';
import type { Disposable, TestItem } from 'vscode';
import { Context, doSafe, TestController } from './testSupport';
import { safeInvalidate, TestItemResolver } from './TestItemResolver';
import { GoTestItem } from './GoTestItem';
import { GoTestRunner } from './GoTestRunner';
import { GoTestItemProvider } from './GoTestItemProvider';

export class GoTestController {
	readonly #context: Context;
	readonly #provider: GoTestItemProvider;
	readonly #disposable: Disposable[] = [];

	constructor(context: Context) {
		this.#context = context;
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

		this.#ctrl.refreshHandler = () => doSafe(this.#context, 'refresh tests', () => resolver.resolve());
		this.#ctrl.resolveHandler = (item) => doSafe(this.#context, 'resolve test', () => resolver.resolve(item));
		new GoTestRunner(this.#context, this.#ctrl, resolver, 'Go', TestRunProfileKind.Run, true);
		new GoTestRunner(this.#context, this.#ctrl, resolver, 'Go (debug)', TestRunProfileKind.Debug, true);
	}

	dispose() {
		this.#disposable.forEach((x) => x.dispose());
		this.#disposable.splice(0, this.#disposable.length);
		this.#ctrl = undefined;
		this.#resolver = undefined;
	}

	async reload(item?: Uri | TestItem, invalidate = false) {
		if (!item || item instanceof Uri) {
			await this.#provider.reload(item, invalidate);
			return;
		}

		await this.#resolver?.resolve(item);
		if (invalidate && this.#ctrl) {
			safeInvalidate(this.#ctrl, item);
		}
	}
}
