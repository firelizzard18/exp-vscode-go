/* eslint-disable @typescript-eslint/no-explicit-any */
import { commands, Event, ExtensionContext, ExtensionMode, extensions, tests, window, workspace } from 'vscode';
import { Context, doSafe } from './testing';
import { GoExtensionAPI } from '../vscode-go';
import { debugProcess, spawnProcess } from './utils';
import { TestManager } from './manager';
import { languages } from 'vscode';

export async function registerTestController(ctx: ExtensionContext) {
	// The Go extension _must_ be activated first since we depend on gopls
	const goExt = extensions.getExtension<GoExtensionAPI>('golang.go');
	if (!goExt) {
		throw new Error('Cannot activate without the Go extension');
	}
	const go = await goExt.activate();

	const testCtx: Context = {
		workspace,
		go,
		spawn: spawnProcess,
		debug: debugProcess,
		testing: ctx.extensionMode === ExtensionMode.Test,
		output: window.createOutputChannel('Go Tests (experimental)', { log: true }),
		commands: {
			modules: (args) => commands.executeCommand('gopls.modules', args),
			packages: (args) => commands.executeCommand('gopls.packages', args)
		}
	};

	const event = <T>(event: Event<T>, msg: string, fn: (e: T) => unknown) => {
		ctx.subscriptions.push(event((e) => doSafe(testCtx, msg, () => fn(e))));
	};
	const command = (name: string, fn: (...args: any[]) => any) => {
		ctx.subscriptions.push(
			commands.registerCommand(name, (...args) => doSafe(testCtx, `executing ${name}`, () => fn(...args)))
		);
	};

	// Initialize the controller
	const manager = new TestManager(testCtx);
	const setup = () => {
		manager.setup({
			createTestController: tests.createTestController,
			registerCodeLensProvider: languages.registerCodeLensProvider
		});
		window.visibleTextEditors.forEach((x) => manager.reload(x.document.uri));
	};
	ctx.subscriptions.push(manager);

	// [Command] Refresh
	command('goExp.testExplorer.refresh', (item) => manager.enabled && manager.reload(item));

	// [Command] Run Test, Debug Test
	command('goExp.test.run', (item) => manager.enabled && manager.runTest(item));
	command('goExp.test.debug', (item) => manager.enabled && manager.debugTest(item));

	// [Event] Configuration change
	event(workspace.onDidChangeConfiguration, 'changed configuration', async (e) => {
		if (e.affectsConfiguration('goExp.testExplorer.enable')) {
			const enabled = workspace.getConfiguration('goExp').get<boolean>('testExplorer.enable');
			if (enabled === manager.enabled) {
				return;
			}
			if (enabled) {
				setup();
			} else {
				manager.dispose();
			}
		}
		if (!manager.enabled) {
			return;
		}
		if (
			e.affectsConfiguration('goExp.testExplorer.discovery') ||
			e.affectsConfiguration('goExp.testExplorer.showFiles') ||
			e.affectsConfiguration('goExp.testExplorer.nestPackages') ||
			e.affectsConfiguration('goExp.testExplorer.nestSubtests')
		) {
			await manager.reload();
		}
	});

	// [Event] File open
	event(workspace.onDidOpenTextDocument, 'opened document', (e) => manager.enabled && manager.reload(e.uri));

	// [Event] File change
	event(workspace.onDidChangeTextDocument, 'updated document', (e) => {
		if (!manager.enabled) {
			return;
		}

		// Ignore events that don't include changes. I don't know what
		// conditions trigger this, but we only care about actual changes.
		if (e.contentChanges.length === 0) {
			return;
		}

		manager.reload(
			e.document.uri,
			e.contentChanges.map((x) => x.range),
			true
		);
	});

	// [Event] File save
	event(workspace.onDidSaveTextDocument, 'saved document', (e) => manager.enabled && manager.didSave(e.uri));

	// [Event] Workspace change
	event(workspace.onDidChangeWorkspaceFolders, 'changed workspace', async () => manager.enabled && manager.reload());

	// [Event] File created/deleted
	const watcher = workspace.createFileSystemWatcher('**/*_test.go', false, true, false);
	ctx.subscriptions.push(watcher);
	event(watcher.onDidCreate, 'created file', async (e) => manager.enabled && manager.reload(e));
	event(watcher.onDidDelete, 'deleted file', async (e) => manager.enabled && manager.reload(e));

	// Setup the controller (if enabled)
	if (workspace.getConfiguration('goExp').get<boolean>('testExplorer.enable')) {
		setup();
	}
}
