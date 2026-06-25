/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
	CancellationToken,
	ConfigurationChangeEvent,
	ConfigurationScope,
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
import { EventEmitter, Uri } from 'vscode';

import { type Commands, type ConfigValue, type Context, type VSCodeFileSystem, type VSCodeWorkspace } from '../../src/utils/common';
import { type Spawner } from '../../src/utils/spawn';
import { type TestController } from '../../src/utils/testing';
import { type GoExtensionAPI, type CommandInvocation } from '../../src/vscode-go.d';
import { TestManager, type EditorEvent } from '../../src/test/manager';

// ─── Configuration ──────────────────────────────────────────────────────────

interface Configuration {
	enable: boolean | 'auto';
	exclude: Record<string, boolean>;
	discovery: 'on' | 'off';
	update: 'on-save' | 'on-edit' | 'off';
	showFiles: boolean;
	nestPackages: boolean;
	nestSubtests: boolean;
	runPackageBenchmarks: boolean;
	codeLens: boolean;
	dynamicSubtestLimit: number;
}

const defaultConfig: Configuration = {
	enable: 'auto',
	exclude: {},
	discovery: 'on',
	update: 'on-save',
	showFiles: false,
	nestPackages: false,
	nestSubtests: true,
	runPackageBenchmarks: false,
	codeLens: false,
	dynamicSubtestLimit: 50,
};

// ─── TestHost ────────────────────────────────────────────────────────────────

export type SetupArgs = Parameters<TestManager['setup']>[0];
export type HostConfig = (host: TestHost, args: SetupArgs) => void;

/**
 * Full test harness wrapping TestManager and its dependencies. Use for
 * integration tests that need the whole stack driven by EditorEvents.
 */
export class TestHost implements Context {
	readonly testing = true;
	readonly go = new FakeGoExtensionAPI();
	readonly output = new FakeOutputChannel();
	readonly state = new FakeMemento();
	readonly storageUri = undefined;
	readonly workspace: TestWorkspace;

	commands: Commands;
	spawn: Spawner = () => Promise.resolve({ code: 0, signal: null });
	debug: Spawner = () => Promise.resolve({ code: 0, signal: null });

	readonly controller = new MockTestController();
	readonly #events = new EventEmitter<EditorEvent>();
	readonly manager: TestManager;

	private constructor(workspace: TestWorkspace, commands: Commands) {
		this.workspace = workspace;
		this.commands = commands;
		this.manager = new TestManager(this, this.#events.event);
	}

	static create(...configs: HostConfig[]): TestHost {
		const workspace = new TestWorkspace();
		const commands: Commands = {
			modules: () => Promise.resolve({}),
			packages: () => Promise.resolve({}),
		};
		const host = new TestHost(workspace, commands);

		const args: SetupArgs = {
			createTestController: () => host.controller,
			registerCodeLensProvider: () => ({ dispose: () => {} }),
			showQuickPick: () => Promise.resolve(undefined),
			showWarningMessage: (..._args: any[]) => Promise.resolve(undefined),
		};

		configs.forEach((c) => c(host, args));
		host.manager.setup(args);
		return host;
	}

	async fire(event: EditorEvent): Promise<void> {
		await this.#events.fire(event);
	}
}

// ─── HostConfig helpers ───────────────────────────────────────────────────────

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

export function withCommands(commands: Partial<Commands>): HostConfig {
	return (host) => {
		host.commands = {
			modules: commands.modules ? (...args) => commands.modules!(...args) : host.commands.modules,
			packages: commands.packages ? (...args) => commands.packages!(...args) : host.commands.packages,
		};
	};
}

export function withSetupArgs(values: Partial<SetupArgs>): HostConfig {
	return (_, args) => Object.assign(args, values);
}

// ─── TestWorkspace ────────────────────────────────────────────────────────────

export class TestWorkspace implements VSCodeWorkspace {
	readonly workspaceFolders: WorkspaceFolder[] = [];
	readonly config: Configuration = { ...defaultConfig };
	readonly fs = new FakeFileSystem();

	readonly #changeHandlers: ((e: ConfigurationChangeEvent) => void)[] = [];

	onDidChangeConfiguration(handler: (e: ConfigurationChangeEvent) => void) {
		this.#changeHandlers.push(handler);
		return { dispose: () => {} };
	}

	/** Fire a config-change event that says all keys are affected. */
	triggerConfigChange() {
		const event: ConfigurationChangeEvent = {
			affectsConfiguration: () => true,
		};
		for (const h of this.#changeHandlers) h(event);
	}

	saveAll(): Thenable<boolean> {
		return Promise.resolve(true);
	}

	getWorkspaceFolder(uri: Uri): WorkspaceFolder | undefined {
		return this.workspaceFolders.find(
			(ws) => ws.uri.fsPath === uri.fsPath || uri.fsPath.startsWith(`${ws.uri.fsPath}/`),
		);
	}

	getConfiguration(section: string, _scope?: ConfigurationScope | null): ConfigValue {
		if (section !== 'exp-vscode-go') return { get: () => undefined };
		return {
			get: <T>(name: string): T | undefined => {
				const prefix = 'testExplorer.';
				if (!name.startsWith(prefix)) return undefined;
				return this.config[name.substring(prefix.length) as keyof Configuration] as T;
			},
		};
	}
}

// ─── MockTestController ───────────────────────────────────────────────────────

export class MockTestController implements TestController {
	readonly items: TestItemCollection = new MapTestItemCollection(undefined);
	readonly invalidatedItems: TestItem[] = [];

	resolveHandler: ((item?: TestItem) => Thenable<void> | void) | undefined = undefined;
	refreshHandler: ((token: CancellationToken) => Thenable<void> | void) | undefined = undefined;

	invalidateTestResults(items?: TestItem | readonly TestItem[]) {
		if (!items) return;
		const arr = Array.isArray(items) ? items : [items];
		this.invalidatedItems.push(...(arr as TestItem[]));
	}

	createTestItem(id: string, label: string, uri?: Uri): TestItem {
		return new MockTestItem(id, label, uri);
	}

	createRunProfile(
		label: string,
		kind: TestRunProfileKind,
		runHandler: (request: TestRunRequest, token: CancellationToken) => Thenable<void> | void,
		isDefault?: boolean,
		tag?: TestTag,
		_supportsContinuousRun?: boolean,
	): TestRunProfile {
		return new MockTestRunProfile(label, kind, runHandler, isDefault, tag);
	}

	createTestRun(_request: TestRunRequest, _name?: string, _persist?: boolean): TestRun {
		return new MockTestRun();
	}

	dispose() {}
}

// ─── MockTestRun ──────────────────────────────────────────────────────────────

export class MockTestRun implements TestRun {
	readonly name = 'mock';
	readonly token: CancellationToken = {
		isCancellationRequested: false,
		onCancellationRequested: () => ({ dispose: () => {} }),
	};
	isPersisted = true;

	readonly startedItems: TestItem[] = [];
	readonly passedItems: Array<{ item: TestItem; duration?: number }> = [];
	readonly failedItems: Array<{ item: TestItem; messages: any; duration?: number }> = [];
	readonly skippedItems: TestItem[] = [];
	readonly erroredItems: Array<{ item: TestItem; messages: any; duration?: number }> = [];
	readonly output: Array<{ text: string; location?: any; item?: TestItem }> = [];
	readonly enqueuedItems: TestItem[] = [];
	ended = false;

	private readonly _onDidDispose = new EventEmitter<void>();
	readonly onDidDispose = this._onDidDispose.event;

	started(item: TestItem) {
		this.startedItems.push(item);
	}

	passed(item: TestItem, duration?: number) {
		this.passedItems.push({ item, duration });
	}

	failed(item: TestItem, message: any, duration?: number) {
		this.failedItems.push({ item, messages: message, duration });
	}

	skipped(item: TestItem) {
		this.skippedItems.push(item);
	}

	errored(item: TestItem, message: any, duration?: number) {
		this.erroredItems.push({ item, messages: message, duration });
	}

	appendOutput(text: string, location?: any, item?: TestItem) {
		this.output.push({ text, location, item });
	}

	enqueued(item: TestItem) {
		this.enqueuedItems.push(item);
	}

	addCoverage(_fileCoverage: any) {}

	end() {
		this.ended = true;
		this._onDidDispose.fire();
	}
}

// ─── MockTestItem ─────────────────────────────────────────────────────────────

export class MockTestItem implements TestItem {
	id: string;
	uri: Uri | undefined;
	children: TestItemCollection;
	parent: TestItem | undefined;
	tags: readonly TestTag[] = [];
	canResolveChildren = false;
	busy = false;
	label: string;
	description?: string;
	sortText?: string;
	range: Range | undefined;
	error: string | MarkdownString | undefined;

	constructor(id: string, label: string, uri?: Uri) {
		this.id = id;
		this.label = label;
		this.uri = uri;
		this.children = new MapTestItemCollection(this);
	}
}

export class MapTestItemCollection implements TestItemCollection {
	readonly #items = new Map<string, TestItem>();
	readonly #parent: TestItem | undefined;

	constructor(parent: TestItem | undefined) {
		this.#parent = parent;
	}

	get size() {
		return this.#items.size;
	}

	replace(items: readonly TestItem[]) {
		this.#items.clear();
		for (const item of items) this.#items.set(item.id, item);
	}

	forEach(callback: (item: TestItem, collection: TestItemCollection) => unknown, thisArg?: any) {
		this.#items.forEach((item) => callback.call(thisArg, item, this));
	}

	add(item: TestItem) {
		(item as MockTestItem).parent = this.#parent;
		this.#items.set(item.id, item);
	}

	delete(id: string) {
		this.#items.delete(id);
	}

	get(id: string): TestItem | undefined {
		return this.#items.get(id);
	}

	[Symbol.iterator](): Iterator<[string, TestItem]> {
		return this.#items[Symbol.iterator]();
	}
}

// ─── Private fakes ────────────────────────────────────────────────────────────

class MockTestRunProfile implements TestRunProfile {
	label: string;
	kind: TestRunProfileKind;
	isDefault: boolean;
	tag: TestTag | undefined;
	configureHandler: (() => void) | undefined;
	runHandler: (request: TestRunRequest, token: CancellationToken) => Thenable<void> | void;
	loadDetailedCoverage?: any;
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
		this.isDefault = isDefault ?? false;
		this.tag = tag;
	}
}

class FakeGoExtensionAPI implements GoExtensionAPI {
	readonly settings = {
		getExecutionCommand(_toolName: string): CommandInvocation | undefined {
			return { binPath: 'go' };
		},
	};
}

class FakeOutputChannel implements LogOutputChannel {
	name = 'fake';
	logLevel = 0;
	onDidChangeLogLevel = () => ({ dispose: () => {} });

	trace = (_msg: string) => {};
	debug = (_msg: string) => {};
	info = (_msg: string) => {};
	warn = (_msg: string) => {};
	error = (_err: string | Error) => {};
	append = (_v: string) => {};
	appendLine = (_v: string) => {};
	replace = (_v: string) => {};
	clear = () => {};
	show = () => {};
	hide = () => {};
	dispose = () => {};
}

class FakeMemento implements Memento {
	readonly #data: Record<string, any> = {};

	keys(): readonly string[] {
		return Object.keys(this.#data);
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T | undefined {
		return (this.#data[key] as T) ?? defaultValue;
	}

	async update(key: string, value: any): Promise<void> {
		this.#data[key] = value;
	}
}

class FakeFileSystem implements VSCodeFileSystem {
	async delete(_uri: Uri, _options?: { recursive?: boolean; useTrash?: boolean }): Promise<void> {}
	async createDirectory(_uri: Uri): Promise<void> {}
	async readFile(_uri: Uri): Promise<Uint8Array> {
		return new Uint8Array();
	}
}
