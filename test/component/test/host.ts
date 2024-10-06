/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import type {
	CancellationToken,
	LogOutputChannel,
	MarkdownString,
	Memento,
	Range,
	TestItem,
	TestItemCollection,
	TestRun,
	TestRunProfile,
	TestRunProfileKind,
	TestRunRequest,
	TestTag,
	WorkspaceFolder,
} from 'vscode';
import { Uri } from 'vscode';
import { Commands, ConfigValue, Context, TestController, Workspace, FileSystem } from '../../../src/test/testing';
import { CommandInvocation, GoExtensionAPI } from '../../../src/vscode-go';
import { Spawner } from '../../../src/test/utils';
import { TestManager } from '../../../src/test/manager';
import cp from 'node:child_process';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import pkg from '../../../package.json';

const config = pkg.contributes.configuration.properties;

export type SetupArgs = Parameters<TestManager['setup']>[0];

interface Configuration {
	enable: boolean;
	exclude: Record<string, boolean>;
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
	readonly state = new MockMemento();
	readonly storageUri: undefined;

	spawn: Spawner = () => Promise.resolve({ code: 0, signal: null });
	debug: Spawner = () => Promise.resolve({ code: 0, signal: null });

	readonly controller = new MockTestController();
	readonly manager = new TestManager(this);

	static async setup(dir: string, ...config: HostConfig[]) {
		const inst = new this(dir);
		const args = {
			createTestController: () => inst.controller,
			registerCodeLensProvider: () => ({ dispose: () => {} }),
			showQuickPick: () => Promise.resolve(undefined),
			showWarningMessage: (s: string) => Promise.reject(new Error(s)),
		};

		config.forEach((x) => x(inst, args));
		await inst.manager.setup(args);
		return inst;
	}

	constructor(dir: string) {
		this.dir = dir;
	}
}

export type HostConfig = (host: TestHost, args: SetupArgs) => void;

export function withSetupArgs(values: Partial<SetupArgs>): HostConfig {
	return (_, args) => Object.assign(args, values);
}

export function withCommands(commands: Partial<Commands>): HostConfig {
	return (host) => Object.assign(host.commands, commands);
}

export function withWorkspace(name: string, uri: string): HostConfig {
	return (host) =>
		host.workspace.workspaceFolders.push({
			name,
			uri: Uri.parse(uri),
			index: host.workspace.workspaceFolders.length,
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
			cwd: this.#host.dir,
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
		exclude: config['goExp.testExplorer.exclude'].default,
		discovery: config['goExp.testExplorer.discovery'].default as any,
		showFiles: config['goExp.testExplorer.showFiles'].default,
		nestPackages: config['goExp.testExplorer.nestPackages'].default,
		nestSubtests: config['goExp.testExplorer.nestSubtests'].default,
		runPackageBenchmarks: config['goExp.testExplorer.runPackageBenchmarks'].default,
	};

	readonly fs = new MockFileSystem();

	saveAll(): Thenable<boolean> {
		return Promise.resolve(true);
	}

	getWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined {
		return this.workspaceFolders.find(
			(ws) => ws.uri.fsPath === uri.fsPath || uri.fsPath.startsWith(`${ws.uri.fsPath}/`),
		);
	}

	getConfiguration(section: string): ConfigValue {
		if (section !== 'goExp') {
			return { get: () => undefined };
		}
		return {
			get: <T>(section: string) => {
				const prefix = 'testExplorer.';
				if (!section.startsWith(prefix)) {
					return;
				}
				return this.config[section.substring(prefix.length) as keyof Configuration] as T;
			},
		};
	}
}

class MockFileSystem implements FileSystem {
	async delete(uri: Uri, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void> {
		await fs.rm(uri.fsPath, { recursive: options?.recursive });
	}

	async createDirectory(uri: Uri): Promise<void> {
		await fs.mkdir(uri.fsPath, { recursive: true });
	}

	async readFile(uri: Uri): Promise<Uint8Array> {
		return await fs.readFile(uri.fsPath);
	}
}

class TestGoExtensionAPI implements GoExtensionAPI {
	readonly settings = {
		getExecutionCommand(toolName: string): CommandInvocation | undefined {
			if (toolName !== 'go') {
				return;
			}
			return { binPath: 'go' };
		},
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

class MockMemento implements Memento {
	readonly #data: Record<string, any> = {};

	keys(): readonly string[] {
		return Object.keys(this.#data);
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: unknown, defaultValue?: unknown): T | T | undefined {
		return this.#data[key as string] ?? defaultValue;
	}

	async update(key: string, value: any): Promise<void> {
		this.#data[key] = value;
	}
}

export class MockTestController implements TestController {
	readonly items: TestItemCollection = new MapTestItemCollection();

	invalidateTestResults(items?: TestItem | readonly TestItem[]): void {}

	createTestItem(id: string, label: string, uri?: Uri): TestItem {
		return new MockTestItem(this, id, label, uri);
	}

	createRunProfile(
		label: string,
		kind: TestRunProfileKind,
		runHandler: (request: TestRunRequest, token: CancellationToken) => Thenable<void> | void,
		isDefault?: boolean,
		tag?: TestTag,
	): TestRunProfile {
		return new MockTestRunProfile(label, kind, runHandler, isDefault, tag);
	}

	createTestRun(request: TestRunRequest, name?: string, persist?: boolean): TestRun {
		throw new Error('Method not implemented.');
	}

	dispose = () => {};

	resolveHandler?: ((item?: TestItem) => Thenable<void> | void) | undefined;
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
		tag?: TestTag,
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
		this.children = new MapTestItemCollection();
		this.id = id;
		this.label = label;
		this.uri = uri;
	}
}

class MapTestItemCollection implements TestItemCollection {
	#items = new Map<string, TestItem>();

	get size() {
		return this.#items.size;
	}

	replace(items: readonly TestItem[]) {
		this.#items = new Map(items.map((x) => [x.id, x]));
	}

	forEach(callback: (item: TestItem, collection: TestItemCollection) => unknown, thisArg?: any): void {
		this.#items.forEach((item) => callback.call(thisArg, item, this));
	}

	add(item: TestItem) {
		this.#items.set(item.id, item);
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
