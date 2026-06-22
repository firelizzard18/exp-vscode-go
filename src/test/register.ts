/* eslint-disable @typescript-eslint/no-explicit-any */
import { Browser } from '@/browser';
import { Command } from '@/commands';
import { Context } from '@/utils/common';
import { debugProcess, spawnProcess } from '@/utils/spawn';
import { helpers } from '@/utils/testing';
import { GoExtensionAPI } from '@/vscode-go';
import {
	commands,
	EventEmitter,
	ExtensionContext,
	ExtensionMode,
	extensions,
	languages,
	LogOutputChannel,
	Memento,
	TestItem,
	TestRunRequest,
	tests,
	window,
	workspace,
} from 'vscode';
import { EditorEvent, TestManager } from './manager';
import { isTestItem } from './model';
import { WorkspaceConfig } from './workspaceConfig';

export async function registerTestingFeatures(ctx: ExtensionContext, go: GoExtensionAPI, output: LogOutputChannel) {
	const testCtx: Context = {
		workspace,
		go,
		spawn: spawnProcess,
		debug: debugProcess,
		testing: ctx.extensionMode === ExtensionMode.Test,
		state: ctx.workspaceState,
		storageUri: ctx.storageUri,
		output,
		commands: {
			modules: (args) => commands.executeCommand('gopls.modules', args),
			packages: (args) => commands.executeCommand('gopls.packages', args),
		},
	};

	await registerTestController(ctx, testCtx);
}

async function registerTestController(ctx: ExtensionContext, testCtx: Context) {
	const { event, command } = helpers(ctx, testCtx, commands);

	// Initialize the controller
	const events = new EventEmitter<EditorEvent>();
	const manager = new TestManager(testCtx, events.event);
	const setup = () => {
		manager.setup({
			createTestController: tests.createTestController,
			registerCodeLensProvider: languages.registerCodeLensProvider,
			showQuickPick: window.showQuickPick,
			showWarningMessage: window.showWarningMessage,
		});
		for (const editor of window.visibleTextEditors) {
			events.fire({ type: 'file-opened', uri: editor.document.uri });
		}
	};
	ctx.subscriptions.push(manager);

	const maybeChangedEnabled = async () => {
		const enabled = await isEnabled(ctx.globalState);
		if (enabled === manager.enabled) {
			return;
		}
		if (enabled) {
			setup();
		} else {
			manager.dispose();
		}
	};

	// [Command] Refresh
	command(Command.Refresh, (item: TestItem) => events.fire({ type: 'force-refresh', item }));

	// [Command] Run Test, Debug Test
	command(Command.Test.Run, testItemCommand(manager, 'runTests'));
	command(Command.Test.Debug, testItemCommand(manager, 'debugTests'));
	command(Command.Test.Profile, testItemCommand(manager, 'profileTests'));

	// [Command] Browser navigation
	command(Command.Browser.Back, () => Browser.active?.back());
	command(Command.Browser.Refresh, () => Browser.active?.reload());
	command(Command.Browser.Forward, () => Browser.active?.forward());

	// [Command] Workaround for https://github.com/microsoft/vscode/issues/237106
	command(Command.ConfigureCoverageRunProfile, () => manager.configureCoverageRunProfile(window));

	// [Event] Configuration change
	const config = new WorkspaceConfig(workspace);
	event(workspace.onDidChangeConfiguration, 'changed configuration', async (e) => {
		if (config.enable.isAffected(e)) {
			await maybeChangedEnabled();
		}
		if (
			config.exclude.isAffected(e) ||
			config.exclude.isAffected(e) ||
			config.discovery.isAffected(e) ||
			config.showFiles.isAffected(e) ||
			config.nestPackages.isAffected(e) ||
			config.nestSubtests.isAffected(e)
		) {
			events.fire({ type: 'config-change' });
		}
	});

	// [Event] Extensions changed
	event(extensions.onDidChange, 'changed extensions', async () => {
		await maybeChangedEnabled();
	});

	// [Event] The user opened a file in an editor
	let seenDocuments = new Set<string>();
	event(window.onDidChangeVisibleTextEditors, 'opened document', (editors) => {
		for (const editor of editors) {
			if (seenDocuments.has(`${editor.document.uri}`)) continue;
			events.fire({ type: 'file-opened', uri: editor.document.uri });
		}

		seenDocuments = new Set(editors.map((x) => `${x.document.uri}`));
	});

	// [Event] File change
	event(workspace.onDidChangeTextDocument, 'updated document', async (e) => {
		const start = performance.now();
		events.fire({ type: 'file-edited', uri: e.document.uri, ranges: e.contentChanges.map((x) => x.range) });

		// How do we check performance now that we're using events, given that
		// the event handler is async?
		return;

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
	event(workspace.onDidSaveTextDocument, 'saved document', (e) =>
		events.fire({ type: 'file-saved', uri: e.uri, version: e.version }),
	);

	// [Event] Workspace change
	event(workspace.onDidChangeWorkspaceFolders, 'changed workspace', () => events.fire({ type: 'workspace-changed' }));

	// [Event] File created/deleted
	const watcher = workspace.createFileSystemWatcher('**/*_test.go', false, true, false);
	ctx.subscriptions.push(watcher);
	event(watcher.onDidCreate, 'created file', async (e) => events.fire({ type: 'file-created', uri: e }));
	event(watcher.onDidDelete, 'deleted file', async (e) => events.fire({ type: 'file-deleted', uri: e }));

	// Setup the controller (if enabled)
	if (await isEnabled(ctx.globalState)) {
		setup();
	}
}

function testItemCommand(manager: TestManager, fn: keyof TestManager & `${string}Tests`) {
	return (...args: any[]) => {
		if (!manager.enabled) {
			return;
		}

		if (args.every((x) => isTestItem(x))) {
			return manager[fn](args);
		}

		const tests = args.filter(
			(x): x is TestItem =>
				x && typeof x === 'object' && !Array.isArray(x) && 'id' in x && 'uri' in x && 'canResolveChildren' in x,
		);
		return manager[fn](new TestRunRequest(tests));
	};
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
