import {
	commands,
	ConfigurationChangeEvent,
	Disposable,
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

const outputChannel = window.createOutputChannel('Go Tests (experimental)', { log: true });

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
			workspace.onDidChangeConfiguration(async (e: ConfigurationChangeEvent) => {
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
				if (!ctrl.enabled) {
					return;
				}
				if (
					e.affectsConfiguration('goExp.testExplorer.discovery') ||
					e.affectsConfiguration('goExp.testExplorer.showFiles') ||
					e.affectsConfiguration('goExp.testExplorer.nestPackages')
				) {
					try {
						await ctrl.#provider.reloadAll();
					} catch (error) {
						if (isInTest) throw error;
						else outputChannel.error(`Error while handling configuration change: ${error}`);
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
					else outputChannel.error(`Error while handling 'onDidOpenTextDocument': ${error}`);
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
					else outputChannel.error(`Error while handling 'onDidChangeTextDocument': ${error}`);
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
					else outputChannel.appendLine(`Error while handling 'onDidChangeWorkspaceFolders': ${error}`);
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
					else outputChannel.appendLine(`Error while handling 'FileSystemWatcher.onDidCreate': ${error}`);
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
					else outputChannel.appendLine(`Error while handling 'FileSystemWatcher.onDidDelete': ${error}`);
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

	readonly #provider: GoTestItemProvider;
	readonly #disposable: Disposable[] = [];

	constructor(workspace: Workspace, commands: Commands) {
		this.#provider = new GoTestItemProvider(workspace, commands);
	}

	#ctrl?: TestController;

	get enabled() {
		return !!this.#ctrl;
	}

	setup(args: SetupArgs) {
		this.#ctrl = args.createController('goExp', 'Go (experimental)');
		const resolver = new TestItemResolver(this.#ctrl, this.#provider);
		this.#disposable.push(this.#ctrl, resolver);

		this.#ctrl.refreshHandler = async () => {
			try {
				await resolver.resolve();
			} catch (error) {
				if (args.isInTest) throw error;
				outputChannel.error(`Error while refreshing tests: ${error}`);
			}
		};

		this.#ctrl.resolveHandler = async (item) => {
			try {
				await resolver.resolve(item);
			} catch (error) {
				if (args.isInTest) throw error;
				if (!item) outputChannel.error(`Error while resolving tests: ${error}`);
				else outputChannel.error(`Error while resolving test item ${item.id}: ${error}`);
				console.error(error);
			}
		};
	}

	dispose() {
		this.#disposable.forEach((x) => x.dispose());
		this.#disposable.splice(0, this.#disposable.length);
		this.#ctrl = undefined;
	}

	#didOpenDocument(editor: TextDocument) {
		if (editor.uri.path.endsWith('.go')) {
			this.#provider.reloadPackages(editor.uri);
		}
	}

	#didCreateFile(uri: Uri) {
		if (uri.path.endsWith('.go')) {
			this.#provider.reloadPackages(uri);
		}
	}

	#didDeleteFile(uri: Uri) {
		console.log(uri);
	}

	#didChangeDocument(event: TextDocumentChangeEvent) {
		if (event.document.uri.path.endsWith('.go')) {
			this.#provider.reloadPackages(event.document.uri);
		}
	}

	#didChangeWorkspace(event: WorkspaceFoldersChangeEvent) {
		console.log(event);
	}
}
