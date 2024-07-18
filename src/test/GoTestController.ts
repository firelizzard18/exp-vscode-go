import {
	commands,
	ConfigurationChangeEvent,
	ExtensionContext,
	ExtensionMode,
	TestController,
	tests,
	TextDocument,
	TextDocumentChangeEvent,
	Uri,
	window,
	workspace,
	WorkspaceFoldersChangeEvent
} from 'vscode';
import { Commands, SetupArgs, Workspace } from './testSupport';
import { TestItemResolver } from './TestItemResolver';
import { GoTestItemProvider } from './GoTestItem';

const outputChannel = window.createOutputChannel('Go Tests', { log: true });

export class GoTestController {
	static register(ctx: ExtensionContext): GoTestController {
		const isInTest = ctx.extensionMode === ExtensionMode.Test;

		// Initialize the controller
		const ctrl = new this(workspace, {
			modules: (args) => commands.executeCommand('gopls.modules', args),
			packages: (args) => commands.executeCommand('gopls.packages', args)
		});

		ctx.subscriptions.push(ctrl);

		// [Event] Configuration change
		ctx.subscriptions.push(
			workspace.onDidChangeConfiguration((e: ConfigurationChangeEvent) => {
				if (e.affectsConfiguration('goExp.testExplorer.enable')) {
					const enabled = workspace.getConfiguration('goExp').get<boolean>('testExplorer.enable');
					if (enabled === ctrl.enabled) {
						return;
					}
					if (enabled) {
						ctrl.setup({ isInTest, createController: tests.createTestController });
					} else {
						ctrl.dispose();
					}
				}
			})
		);

		// [Event] File open
		ctx.subscriptions.push(
			workspace.onDidOpenTextDocument(async (x) => {
				try {
					if (ctrl.enabled) {
						await ctrl.#didOpenDocument(x);
					}
				} catch (error) {
					if (isInTest) throw error;
					else outputChannel.error(`Failed while handling 'onDidOpenTextDocument': ${error}`);
				}
			})
		);

		// [Event] File change
		ctx.subscriptions.push(
			workspace.onDidChangeTextDocument(async (x) => {
				try {
					if (ctrl.enabled) {
						await ctrl.#didChangeDocument(x);
					}
				} catch (error) {
					if (isInTest) throw error;
					else outputChannel.error(`Failed while handling 'onDidChangeTextDocument': ${error}`);
				}
			})
		);

		// [Event] Workspace change
		ctx.subscriptions.push(
			workspace.onDidChangeWorkspaceFolders(async (x) => {
				try {
					if (ctrl.enabled) {
						await ctrl.#didChangeWorkspace(x);
					}
				} catch (error) {
					if (isInTest) throw error;
					else outputChannel.appendLine(`Failed while handling 'onDidChangeWorkspaceFolders': ${error}`);
				}
			})
		);

		// [Event] File created/deleted
		const watcher = workspace.createFileSystemWatcher('**/*_test.go', false, true, false);
		ctx.subscriptions.push(watcher);
		ctx.subscriptions.push(
			watcher.onDidCreate(async (x) => {
				try {
					if (ctrl.enabled) {
						await ctrl.#didCreateFile(x);
					}
				} catch (error) {
					if (isInTest) throw error;
					else outputChannel.appendLine(`Failed while handling 'FileSystemWatcher.onDidCreate': ${error}`);
				}
			})
		);
		ctx.subscriptions.push(
			watcher.onDidDelete(async (x) => {
				try {
					if (ctrl.enabled) {
						await ctrl.#didDeleteFile(x);
					}
				} catch (error) {
					if (isInTest) throw error;
					else outputChannel.appendLine(`Failed while handling 'FileSystemWatcher.onDidDelete': ${error}`);
				}
			})
		);

		// Setup the controller (if enabled)
		if (workspace.getConfiguration('goExp').get<boolean>('testExplorer.enable')) {
			ctrl.setup({ isInTest, createController: tests.createTestController });
			window.visibleTextEditors.forEach((x) => ctrl.#didOpenDocument(x.document));
		}

		return ctrl;
	}

	readonly #workspace: Workspace;
	readonly #commands: Commands;

	constructor(workspace: Workspace, commands: Commands) {
		this.#workspace = workspace;
		this.#commands = commands;
	}

	#ctrl?: TestController;

	get enabled() {
		return !!this.#ctrl;
	}

	setup(args: SetupArgs) {
		this.#ctrl = args.createController('goExp', 'Go (experimental)');
		const provider = new GoTestItemProvider(this.#workspace, this.#commands);
		const resolver = new TestItemResolver(this.#ctrl, provider);

		this.#ctrl.refreshHandler = async () => {
			try {
				await resolver.resolve();
			} catch (error) {
				if (args.isInTest) throw error;
				outputChannel.error(`Failed while refreshing tests: ${error}`);
			}
		};

		this.#ctrl.resolveHandler = async (item) => {
			try {
				await resolver.resolve(item);
			} catch (error) {
				if (args.isInTest) throw error;
				if (!item) outputChannel.error(`Failed while resolving tests: ${error}`);
				else outputChannel.error(`Failed while resolving test item ${item.id}: ${error}`);
				console.error(error);
			}
		};
	}

	dispose() {
		if (!this.#ctrl) {
			return;
		}
		this.#ctrl.dispose();
	}

	#didOpenDocument(editor: TextDocument) {
		console.log(editor);
	}

	#didCreateFile(uri: Uri) {
		console.log(uri);
	}

	#didDeleteFile(uri: Uri) {
		console.log(uri);
	}

	#didChangeDocument(event: TextDocumentChangeEvent) {
		console.log(event);
	}

	#didChangeWorkspace(event: WorkspaceFoldersChangeEvent) {
		console.log(event);
	}
}
