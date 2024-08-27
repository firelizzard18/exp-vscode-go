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
	WorkspaceFolder
} from 'vscode';
import { Uri } from 'vscode';
import { Commands, ConfigValue, Context, TestController, Workspace } from '../../../src/test/testSupport';
import { CommandInvocation, GoExtensionAPI } from '../../../src/vscode-go';
import { Spawner } from '../../../src/test/utils';
import { GoTestController } from '../../../src/test/GoTestController';
import cp from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import pkg from '../../../package.json';

const config = pkg.contributes.configuration.properties;

interface Configuration {
	enable: boolean;
	discovery: 'on' | 'off';
	showFiles: boolean;
	nestPackages: boolean;
	nestSubtests: boolean;
	runPackageBenchmarks: boolean;
}

export class TestHost implements Context {
	readonly dir: string;
	readonly testing = true;
	readonly go = new TestGoExtensionAPI();
	readonly commands = new TestCommands(this);
	readonly workspace = new TestWorkspace();
	readonly output = new FakeOutputChannel();

	spawn: Spawner = () => Promise.resolve();
	debug: Spawner = () => Promise.resolve();

	readonly controller = new MockTestController();
	readonly manager = new GoTestController(this);

	constructor(dir: string, ...config: HostConfig[]) {
		this.dir = dir;
		config.forEach((x) => x(this));
		this.manager.setup({ createController: () => this.controller });
	}
}

export type HostConfig = (host: TestHost) => void;

export function withWorkspace(name: string, uri: string): HostConfig {
	return (host) =>
		host.workspace.workspaceFolders.push({
			name,
			uri: Uri.parse(uri),
			index: host.workspace.workspaceFolders.length
		});
}

export function withConfiguration(config: Partial<Configuration>): HostConfig {
	return (host) => Object.assign(host.workspace.config, config);
}

class TestCommands implements Commands {
	readonly #host: TestHost;

	constructor(host: TestHost) {
		this.#host = host;
	}

	#execute(cmd: string, args: any) {
		// Assume that gopls is in ~/go/bin and has test support
		const r = cp.spawnSync(path.join(os.homedir(), 'go', 'bin', 'gopls'), ['execute', cmd, JSON.stringify(args)], {
			encoding: 'utf-8',
			cwd: this.#host.dir
		});
		if (r.error) throw new Error('gopls error', { cause: r.error });
		const x = JSON.parse(r.stdout);
		return x;
	}

	modules = (args: Commands.ModulesArgs): Thenable<Commands.ModulesResult> => {
		return this.#execute('gopls.modules', args);
	};

	packages = (args: Commands.PackagesArgs): Thenable<Commands.PackagesResults> => {
		return this.#execute('gopls.packages', args);
	};
}

class TestWorkspace implements Workspace {
	readonly workspaceFolders: WorkspaceFolder[] = [];
	readonly config: Configuration = {
		enable: config['goExp.testExplorer.enable'].default,
		discovery: config['goExp.testExplorer.discovery'].default as any,
		showFiles: config['goExp.testExplorer.showFiles'].default,
		nestPackages: config['goExp.testExplorer.nestPackages'].default,
		nestSubtests: config['goExp.testExplorer.nestSubtests'].default,
		runPackageBenchmarks: config['goExp.testExplorer.runPackageBenchmarks'].default
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
	readonly #didAdd: (_: TestItem) => void | Thenable<void>;

	constructor(didAdd: (_: TestItem) => void | Thenable<void>) {
		this.#didAdd = didAdd;
	}

	get size() {
		return this.#items.size;
	}

	async replace(items: readonly TestItem[]): Promise<void> {
		this.#items = new Map(items.map((x) => [x.id, x]));
		await Promise.all([...items].map((x) => this.#didAdd(x)));
	}

	forEach(callback: (item: TestItem, collection: TestItemCollection) => unknown, thisArg?: any): void {
		this.#items.forEach((item) => callback.call(thisArg, item, this));
	}

	async add(item: TestItem): Promise<void> {
		this.#items.set(item.id, item);
		await this.#didAdd(item);
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
