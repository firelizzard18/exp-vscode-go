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
import { TestConfig } from './config';
import { WorkspaceConfig } from './workspaceConfig';
import { GoTestItem } from './model';
import { Command } from './commands';

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
		for (const editor of window.visibleTextEditors) {
			await manager.updateFile(editor.document.uri);
		}
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
	command(Command.Refresh, (item: TestItem) => manager.enabled && manager.refresh(item));

	// [Command] Run Test, Debug Test
	command(Command.Test.Run, (...item: GoTestItem[]) => manager.enabled && manager.runTests(...item));
	command(Command.Test.Debug, (...item: GoTestItem[]) => manager.enabled && manager.debugTests(...item));

	// [Command] Browser navigation
	command(Command.Browser.Back, () => Browser.active?.back());
	command(Command.Browser.Refresh, () => Browser.active?.reload());
	command(Command.Browser.Forward, () => Browser.active?.forward());

	// [Command] Workaround for https://github.com/microsoft/vscode/issues/237106
	command('goExp.configureCoverageRunProfile', () => manager.configureCoverageRunProfile(window));

	// [Event] Configuration change
	const config = new WorkspaceConfig(workspace);
	event(workspace.onDidChangeConfiguration, 'changed configuration', async (e) => {
		if (config.enable.isAffected(e)) {
			await maybeChangedEnabled();
		}
		if (!manager.enabled) {
			return;
		}
		if (
			config.exclude.isAffected(e) ||
			config.exclude.isAffected(e) ||
			config.discovery.isAffected(e) ||
			config.showFiles.isAffected(e) ||
			config.nestPackages.isAffected(e) ||
			config.nestSubtests.isAffected(e)
		) {
			await manager.refresh();
		}
	});

	// [Event] Extensions changed
	event(extensions.onDidChange, 'changed extensions', async () => {
		await maybeChangedEnabled();
	});

	// [Event] The user opened a file in an editor
	let seenDocuments = new Set<string>();
	event(window.onDidChangeVisibleTextEditors, 'opened document', async (editors) => {
		for (const editor of editors) {
			if (seenDocuments.has(`${editor.document.uri}`)) continue;
			await manager.updateFile(editor.document.uri);
		}

		seenDocuments = new Set(editors.map((x) => `${x.document.uri}`));
	});

	// [Event] File change
	event(workspace.onDidChangeTextDocument, 'updated document', async (e) => {
		const start = performance.now();
		await manager.didChangeTextDocument(e);

		// If the update took too long, warn the user they might want to disable
		// on-edit updates.
		const duration = performance.now() - start;
		if (duration > 500) {
			await badReloadPerformanceNotification(ctx.workspaceState);
		} else if (duration > 150) {
			console.warn('Reloading tests took', duration, 'ms');
		}
	});

	// [Event] File save
	event(workspace.onDidSaveTextDocument, 'saved document', (e) => manager.didSaveTextDocument(e));

	// [Event] Workspace change
	event(workspace.onDidChangeWorkspaceFolders, 'changed workspace', async () => {
		if (manager.enabled) {
			// Update roots without recursing.
			manager.refresh(undefined, { recurse: false });
		}
	});

	// [Event] File created/deleted
	const watcher = workspace.createFileSystemWatcher('**/*_test.go', false, true, false);
	ctx.subscriptions.push(watcher);
	event(
		watcher.onDidCreate,
		'created file',
		async (e) => manager.enabled && manager.updateFile(e, { type: 'created' }),
	);
	event(
		watcher.onDidDelete,
		'deleted file',
		async (e) => manager.enabled && manager.updateFile(e, { type: 'deleted' }),
	);

	// Setup the controller (if enabled)
	if (await isEnabled(ctx.globalState)) {
		await setup();
	}
}

async function isEnabled(state: Memento) {
	// If the user has explicitly enabled or disabled the test explorer, use
	// that.
	const config = new WorkspaceConfig(workspace);
	const enabled = config.enable.get();
	if (typeof enabled === 'boolean') {
		return enabled;
	}

	// Default to enabled if the Go extension is in preview mode. Re-fetch the
	// extension API in case the extension has been changed.
	const go = await extensions.getExtension<GoExtensionAPI>('golang.go')?.activate();
	if (go?.isPreview === true) {
		return true;
	}

	experimentalExplorerNotification(state);
	return false;
}

/**
 * Notify the user that we're enabling the experimental explorer.
 */
async function experimentalExplorerNotification(state: Memento) {
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
				query: 'exp-vscode-go.testExplorer.enable',
			});
			break;

		case 'Ok':
			state.update(id, true);
			break;
	}
}

let didWarnOfSlowReload = false;
async function badReloadPerformanceNotification(state: Memento) {
	if (didWarnOfSlowReload) return;
	didWarnOfSlowReload = true;

	const id = 'testExplorer.ignoreBadReloadPerformanceNotification';
	if (state.get(id) === true) {
		return;
	}

	const r = await window.showWarningMessage(
		'Consider disabling on-edit updates. Reloading tests took more than half a second. Disabling on-edit updates to fix this issue.',
		'Ok',
		"Don't warn me again",
	);
	switch (r) {
		case "Don't warn me again":
			await state.update(id, true);
			break;
		case 'Ok':
			await commands.executeCommand('workbench.action.openSettings2', {
				query: 'exp-vscode-go.testExplorer.update',
			});
			break;
	}
}
