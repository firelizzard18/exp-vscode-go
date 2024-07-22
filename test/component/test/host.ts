/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
	CancellationToken,
	LogOutputChannel,
	MarkdownString,
	Range,
	TestItem,
	TestItemCollection,
	TestRun,
	TestRunProfile,
	TestRunProfileKind,
	TestRunRequest,
	TestTag,
	Uri,
	WorkspaceFolder
} from 'vscode';
import { Commands, ConfigValue, Context, TestController, Workspace } from '../../../src/test/testSupport';
import { CommandInvocation, GoExtensionAPI } from '../../../src/vscode-go';
import { Spawner } from '../../../src/test/utils';

interface Configuration {
	enable: boolean;
	discovery: 'on' | 'off';
	showFiles: boolean;
	nestPackages: boolean;
	runPackageBenchmarks: boolean;
}

export class TestHost implements Context {
	readonly testing = true;
	readonly go = new TestGoExtensionAPI();
	readonly commands = new TestCommands();
	readonly workspace = new TestWorkspace();
	readonly output = new FakeOutputChannel();

	spawn: Spawner = () => Promise.resolve();
	debug: Spawner = () => Promise.resolve();
}

class TestCommands implements Commands {
	modules = (args: Commands.ModulesArgs) => {
		return Promise.resolve({ Modules: [] }) as Thenable<Commands.ModulesResult>;
	};
	packages = (args: Commands.PackagesArgs) => {
		return Promise.resolve({ Module: {}, Packages: [] }) as Thenable<Commands.PackagesResults>;
	};
}

class TestWorkspace implements Workspace {
	workspaceFolders: readonly WorkspaceFolder[] = [];
	readonly config: Configuration = {
		enable: true,
		discovery: 'on',
		showFiles: false,
		nestPackages: false,
		runPackageBenchmarks: false
	};

	saveAll(): Thenable<boolean> {
		return Promise.resolve(true);
	}

	getWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined {
		return this.workspaceFolders.find(
			(ws) => ws.uri.fsPath === uri.fsPath || uri.fsPath.startsWith(`${ws.uri.fsPath}/`)
		);
	}

	getConfiguration(): ConfigValue {
		return {
			get: <T>(section: string) => {
				const prefix = 'testExplorer.';
				if (!section.startsWith(prefix)) {
					return;
				}
				return this.config[section.substring(prefix.length) as keyof Configuration] as T;
			}
		};
	}
}

class TestGoExtensionAPI implements GoExtensionAPI {
	readonly settings = {
		getExecutionCommand(toolName: string): CommandInvocation | undefined {
			if (toolName !== 'go') {
				return;
			}
			return { binPath: 'go' };
		}
	};
}

class FakeOutputChannel implements LogOutputChannel {
	name = 'fake';
	logLevel = 0;
	onDidChangeLogLevel = () => ({ dispose: () => {} });

	trace = (message: string): void => console.log(message);
	debug = (message: string): void => console.log(message);
	info = (message: string): void => console.log(message);
	warn = (message: string): void => console.log(message);
	error = (error: string | Error): void => console.log(error);

	append = (value: string): void => console.log(value);
	appendLine = (value: string): void => console.log(value);
	replace = (value: string): void => console.log(value);
	clear = () => {};
	show = () => {};
	hide = () => {};
	dispose = () => {};
}

export class MockTestController implements TestController {
	readonly items: TestItemCollection = new MapTestItemCollection((item) => this.resolveHandler?.(item));

	createTestItem(id: string, label: string, uri?: Uri): TestItem {
		return new MockTestItem(this, id, label, uri);
	}

	createRunProfile(
		label: string,
		kind: TestRunProfileKind,
		runHandler: (request: TestRunRequest, token: CancellationToken) => Thenable<void> | void,
		isDefault?: boolean,
		tag?: TestTag
	): TestRunProfile {
		return new MockTestRunProfile(label, kind, runHandler, isDefault, tag);
	}

	createTestRun(request: TestRunRequest, name?: string, persist?: boolean): TestRun {
		throw new Error('Method not implemented.');
	}

	dispose = () => {};

	resolveHandler?: ((item: TestItem | undefined) => Thenable<void> | void) | undefined;
	refreshHandler: ((token: CancellationToken) => Thenable<void> | void) | undefined;
}

class MockTestRunProfile implements TestRunProfile {
	label: string;
	kind: TestRunProfileKind;
	isDefault: boolean;
	tag: TestTag | undefined;
	configureHandler: (() => void) | undefined;
	runHandler: (request: TestRunRequest, token: CancellationToken) => Thenable<void> | void;
	dispose = () => {};

	constructor(
		label: string,
		kind: TestRunProfileKind,
		runHandler: (request: TestRunRequest, token: CancellationToken) => Thenable<void> | void,
		isDefault?: boolean,
		tag?: TestTag
	) {
		this.label = label;
		this.kind = kind;
		this.runHandler = runHandler;
		this.isDefault = isDefault || true;
		this.tag = tag;
	}
}

class MockTestItem implements TestItem {
	id: string;
	uri: Uri | undefined;
	children: TestItemCollection;
	parent: TestItem | undefined;
	tags: readonly TestTag[] = [];
	canResolveChildren: boolean = false;
	busy: boolean = false;
	label: string;
	description?: string | undefined;
	sortText?: string | undefined;
	range: Range | undefined;
	error: string | MarkdownString | undefined;

	constructor(ctrl: TestController, id: string, label: string, uri?: Uri) {
		this.children = new MapTestItemCollection((x) => ctrl.resolveHandler?.(x));
		this.id = id;
		this.label = label;
		this.uri = uri;
	}
}

class MapTestItemCollection implements TestItemCollection {
	#items = new Map<string, TestItem>();
	readonly #didAdd: (_: TestItem) => void;

	constructor(didAdd: (_: TestItem) => void) {
		this.#didAdd = didAdd;
	}

	get size() {
		return this.#items.size;
	}

	replace(items: readonly TestItem[]): void {
		this.#items = new Map(items.map((x) => [x.id, x]));
		items.forEach((x) => this.#didAdd(x));
	}

	forEach(callback: (item: TestItem, collection: TestItemCollection) => unknown, thisArg?: any): void {
		this.#items.forEach((item) => callback.call(thisArg, item, this));
	}

	add(item: TestItem): void {
		this.#items.set(item.id, item);
		this.#didAdd(item);
	}

	delete(id: string): void {
		this.#items.delete(id);
	}

	get(id: string): TestItem | undefined {
		return this.#items.get(id);
	}

	[Symbol.iterator](): Iterator<[id: string, testItem: TestItem]> {
		return this.#items[Symbol.iterator]();
	}
}
