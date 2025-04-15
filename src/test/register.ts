/* eslint-disable @typescript-eslint/no-explicit-any */
import { GoExtensionAPI } from '../vscode-go';
import { debugProcess, spawnProcess } from './utils';
import { TestManager } from './manager';
import {
	commands,
	ExtensionContext,
	ExtensionMode,
	extensions,
	languages,
	Memento,
	TestItem,
	tests,
	window,
	workspace,
} from 'vscode';
import { Browser } from '../browser';
import { registerProfileEditor } from './profile';
import { Context, helpers } from '../utils/testing';

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
	const { event, command } = helpers(ctx, testCtx, commands);

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

	const maybeChangedEnabled = async () => {
		const enabled = await isEnabled(ctx.globalState);
		if (enabled === manager.enabled) {
			return;
		}
		if (enabled) {
			await setup();
		} else {
			manager.dispose();
		}
	};

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
			await maybeChangedEnabled();
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

	// [Event] Extensions changed
	event(extensions.onDidChange, 'changed extensions', async () => {
		await maybeChangedEnabled();
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
	if (await isEnabled(ctx.globalState)) {
		await setup();
	}
}

async function isEnabled(state: Memento) {
	// If the user has explicitly enabled or disabled the test explorer, use
	// that.
	const enabled = workspace.getConfiguration('exp-vscode-go').get<boolean | 'auto'>('testExplorer.enable');
	if (typeof enabled === 'boolean') {
		return enabled;
	}

	// Default to enabled if the Go extension is in preview mode. Re-fetch the
	// extension API in case the extension has been changed.
	const go = await extensions.getExtension<GoExtensionAPI>('golang.go')?.activate();
	if (go?.isPreview === true) {
		return true;
	}

	notifyUser(state);
	return false;
}

/**
 * Notify the user that we're enabling the experimental explorer.
 */
async function notifyUser(state: Memento) {
	// If the user has acknowledged the notification, don't show it again.
	const id = 'testExplorer.didAckDisableNotification';
	if (state.get(id) === true) {
		return;
	}

	const r = await window.showInformationMessage(
		"Go Companion's test explorer is disabled by default when the Go extension is not a prerelease version. Override this by setting goExp.testExplorer.enable to true.",
		'Open settings',
		'Ok',
	);

	switch (r) {
		case 'Open settings':
			await commands.executeCommand('workbench.action.openSettings2', {
				query: 'goExp.testExplorer.enable',
			});
			break;

		case 'Ok':
			state.update(id, true);
			break;
	}
}
