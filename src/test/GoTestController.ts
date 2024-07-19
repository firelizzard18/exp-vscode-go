/* eslint-disable @typescript-eslint/no-explicit-any */
import {
	commands,
	Disposable,
	Event,
	ExtensionContext,
	ExtensionMode,
	TestController,
	TestItem,
	tests,
	Uri,
	window,
	workspace
} from 'vscode';
import { Commands, SetupArgs, Workspace } from './testSupport';
import { TestItemResolver } from './TestItemResolver';
import { GoTestItem, GoTestItemProvider } from './GoTestItem';

const outputChannel = window.createOutputChannel('Go Tests (experimental)', { log: true });

export function registerTestController(ctx: ExtensionContext) {
	const isInTest = ctx.extensionMode === ExtensionMode.Test;
	const doSafe = async <T>(msg: string, fn: () => T | Promise<T>) => {
		try {
			return await fn();
		} catch (error) {
			if (isInTest) throw error;
			else outputChannel.error(`Error: ${msg}: ${error}`);
		}
	};
	const event = <T>(event: Event<T>, msg: string, fn: (e: T) => unknown) => {
		ctx.subscriptions.push(event((e) => doSafe(msg, () => fn(e))));
	};
	const command = (name: string, fn: (...args: any[]) => any) => {
		ctx.subscriptions.push(
			commands.registerCommand(name, (...args) => doSafe(`executing ${name}`, () => fn(...args)))
		);
	};

	// Initialize the controller
	const ctrl = new GoTestController(workspace, {
		modules: (args) => commands.executeCommand('gopls.modules', args),
		packages: (args) => commands.executeCommand('gopls.packages', args)
	});
	const setup = () => {
		ctrl.setup({ doSafe, createController: tests.createTestController });
		window.visibleTextEditors.forEach((x) => ctrl.reload(x.document.uri));
	};
	ctx.subscriptions.push(ctrl);

	// [Command] Refresh
	command('goExp.testExplorer.refresh', (item) => ctrl.enabled && ctrl.reload(item));

	// [Event] Configuration change
	event(workspace.onDidChangeConfiguration, 'changed configuration', async (e) => {
		if (e.affectsConfiguration('goExp.testExplorer.enable')) {
			const enabled = workspace.getConfiguration('goExp').get<boolean>('testExplorer.enable');
			if (enabled === ctrl.enabled) {
				return;
			}
			if (enabled) {
				setup();
			} else {
				ctrl.dispose();
			}
		}
		if (!ctrl.enabled) {
			return;
		}
		if (
			e.affectsConfiguration('goExp.testExplorer.discovery') ||
			e.affectsConfiguration('goExp.testExplorer.showFiles') ||
			e.affectsConfiguration('goExp.testExplorer.nestPackages')
		) {
			await ctrl.reload();
		}
	});

	// [Event] File open
	event(workspace.onDidOpenTextDocument, 'opened document', (e) => ctrl.enabled && ctrl.reload(e.uri));

	// [Event] File change
	event(workspace.onDidChangeTextDocument, 'updated document', (e) => ctrl.enabled && ctrl.reload(e.document.uri));

	// [Event] Workspace change
	event(workspace.onDidChangeWorkspaceFolders, 'changed workspace', async () => ctrl.enabled && ctrl.reload());

	// [Event] File created/deleted
	const watcher = workspace.createFileSystemWatcher('**/*_test.go', false, true, false);
	ctx.subscriptions.push(watcher);
	event(watcher.onDidCreate, 'created file', async (e) => ctrl.enabled && ctrl.reload(e));
	event(watcher.onDidDelete, 'deleted file', async (e) => ctrl.enabled && ctrl.reload(e));

	// Setup the controller (if enabled)
	if (workspace.getConfiguration('goExp').get<boolean>('testExplorer.enable')) {
		setup();
	}
}

class GoTestController {
	readonly #provider: GoTestItemProvider;
	readonly #disposable: Disposable[] = [];

	constructor(workspace: Workspace, commands: Commands) {
		this.#provider = new GoTestItemProvider(workspace, commands);
	}

	#ctrl?: TestController;
	#resolver?: TestItemResolver<GoTestItem>;

	get enabled() {
		return !!this.#ctrl;
	}

	setup(args: SetupArgs) {
		this.#ctrl = args.createController('goExp', 'Go (experimental)');
		this.#resolver = new TestItemResolver(this.#ctrl, this.#provider);
		this.#disposable.push(this.#ctrl, this.#resolver);

		const doSafe = args.doSafe || (<T>(_: string, fn: () => T | Promise<T>) => fn());

		this.#ctrl.refreshHandler = () => doSafe('refresh tests', () => this.#resolver?.resolve());
		this.#ctrl.resolveHandler = (item) => doSafe('resolve test', () => this.#resolver?.resolve(item));
	}

	dispose() {
		this.#disposable.forEach((x) => x.dispose());
		this.#disposable.splice(0, this.#disposable.length);
		this.#ctrl = undefined;
		this.#resolver = undefined;
	}

	reload(item?: Uri | TestItem) {
		if (!item || item instanceof Uri) {
			this.#provider.reload(item);
			return;
		}

		this.#resolver?.resolve(item);
	}
}
