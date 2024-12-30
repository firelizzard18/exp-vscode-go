/* eslint-disable @typescript-eslint/no-explicit-any */
import { commands, Event, ExtensionContext, ExtensionMode, TestItem, tests, window, workspace } from 'vscode';
import { Context, doSafe } from './testing';
import { GoExtensionAPI } from '../vscode-go';
import { debugProcess, spawnProcess } from './utils';
import { TestManager } from './manager';
import { languages } from 'vscode';
import { Browser } from '../browser';
import { registerProfileEditor } from './profile';

export async function registerTestingFeatures(ctx: ExtensionContext, go: GoExtensionAPI) {
	const testCtx: Context = {
		workspace,
		go,
		spawn: spawnProcess,
		debug: debugProcess,
		testing: ctx.extensionMode === ExtensionMode.Test,
		state: ctx.workspaceState,
		storageUri: ctx.storageUri,
		output: window.createOutputChannel('Go Tests (experimental)', { log: true }),
		commands: {
			modules: (args) => commands.executeCommand('gopls.modules', args),
			packages: (args) => commands.executeCommand('gopls.packages', args),
		},
	};

	await registerTestController(ctx, testCtx);
	await registerProfileEditor(ctx, testCtx);
}

async function registerTestController(ctx: ExtensionContext, testCtx: Context) {
	const event = <T>(event: Event<T>, msg: string, fn: (e: T) => unknown) => {
		ctx.subscriptions.push(event((e) => doSafe(testCtx, msg, () => fn(e))));
	};
	const command = (name: string, fn: (...args: any[]) => any) => {
		ctx.subscriptions.push(
			commands.registerCommand(name, (...args) => doSafe(testCtx, `executing ${name}`, () => fn(...args))),
		);
	};

	// Initialize the controller
	const manager = new TestManager(testCtx);
	const setup = async () => {
		await manager.setup({
			createTestController: tests.createTestController,
			registerCodeLensProvider: languages.registerCodeLensProvider,
			showQuickPick: window.showQuickPick,
			showWarningMessage: window.showWarningMessage,
		});
		window.visibleTextEditors.forEach((x) => manager.reloadUri(x.document.uri));
	};
	ctx.subscriptions.push(manager);

	// [Command] Refresh
	command('goExp.testExplorer.refresh', (item: TestItem) => manager.enabled && manager.reloadViewItem(item));

	// [Command] Run Test, Debug Test
	command('goExp.test.run', (...item: TestItem[]) => manager.enabled && manager.runTests(...item));
	command('goExp.test.debug', (...item: TestItem[]) => manager.enabled && manager.debugTests(...item));

	// [Command] Browser navigation
	command('goExp.browser.back', () => Browser.active?.back());
	command('goExp.browser.refresh', () => Browser.active?.reload());
	command('goExp.browser.forward', () => Browser.active?.forward());

	// [Command] Workaround for https://github.com/microsoft/vscode/issues/237106
	command('goExp.configureCoverageRunProfile', () => manager.configureCoverageRunProfile(window));

	// [Event] Configuration change
	event(workspace.onDidChangeConfiguration, 'changed configuration', async (e) => {
		if (e.affectsConfiguration('exp-vscode-go.testExplorer.enable')) {
			const enabled = workspace.getConfiguration('exp-vscode-go').get<boolean>('testExplorer.enable');
			if (enabled === manager.enabled) {
				return;
			}
			if (enabled) {
				await setup();
			} else {
				manager.dispose();
			}
		}
		if (!manager.enabled) {
			return;
		}
		if (
			e.affectsConfiguration('files.exclude') ||
			e.affectsConfiguration('exp-vscode-go.testExplorer.exclude') ||
			e.affectsConfiguration('exp-vscode-go.testExplorer.discovery') ||
			e.affectsConfiguration('exp-vscode-go.testExplorer.showFiles') ||
			e.affectsConfiguration('exp-vscode-go.testExplorer.nestPackages') ||
			e.affectsConfiguration('exp-vscode-go.testExplorer.nestSubtests')
		) {
			await manager.reloadView();
		}
	});

	// [Event] File open
	event(workspace.onDidOpenTextDocument, 'opened document', (e) => manager.enabled && manager.reloadUri(e.uri));

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

		manager.reloadUri(
			e.document.uri,
			e.contentChanges.map((x) => x.range),
			true,
		);
	});

	// [Event] File save
	event(workspace.onDidSaveTextDocument, 'saved document', (e) => manager.enabled && manager.didSave(e.uri));

	// [Event] Workspace change
	event(
		workspace.onDidChangeWorkspaceFolders,
		'changed workspace',
		async () => manager.enabled && manager.reloadView(),
	);

	// [Event] File created/deleted
	const watcher = workspace.createFileSystemWatcher('**/*_test.go', false, true, false);
	ctx.subscriptions.push(watcher);
	event(watcher.onDidCreate, 'created file', async (e) => manager.enabled && manager.reloadUri(e));
	event(watcher.onDidDelete, 'deleted file', async (e) => manager.enabled && manager.reloadUri(e));

	// Setup the controller (if enabled)
	if (workspace.getConfiguration('exp-vscode-go').get<boolean>('testExplorer.enable')) {
		await setup();
	}
}
