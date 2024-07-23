/* eslint-disable @typescript-eslint/no-namespace */
/* eslint-disable n/no-extraneous-import */
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
import type { MatcherFunction, ExpectationResult } from 'expect';
import { Commands, ConfigValue, Context, TestController, Workspace } from '../../../src/test/testSupport';
import { CommandInvocation, GoExtensionAPI } from '../../../src/vscode-go';
import { Spawner } from '../../../src/test/utils';
import { GoTestItem } from '../../../src/test/GoTestItem';
import { Module } from 'module';
import { GoTestController } from '../../../src/test/GoTestController';

interface Configuration {
	enable: boolean;
	discovery: 'on' | 'off';
	showFiles: boolean;
	nestPackages: boolean;
	runPackageBenchmarks: boolean;
}

export class TestHost implements Context {
	readonly modules: Commands.Module[] = [];
	readonly packages: Commands.Package[] = [];

	readonly testing = true;
	readonly go = new TestGoExtensionAPI();
	readonly commands = new TestCommands(this);
	readonly workspace = new TestWorkspace();
	readonly output = new FakeOutputChannel();

	spawn: Spawner = () => Promise.resolve();
	debug: Spawner = () => Promise.resolve();
}

export type HostConfig = (host: TestHost) => void;

export function makeHost(...config: HostConfig[]) {
	const host = new TestHost();
	config.forEach((x) => x(host));

	const ctrl = new MockTestController();
	const goCtrl = new GoTestController(host);
	goCtrl.setup({ createController: () => ctrl });

	return { host, ctrl, goCtrl };
}

export function withWorkspace(name: string, uri: string): HostConfig {
	return (host) =>
		host.workspace.workspaceFolders.push({
			name,
			uri: Uri.parse(uri),
			index: host.workspace.workspaceFolders.length
		});
}

export function withModule(mod: Commands.Module): HostConfig {
	return (host: TestHost) => host.modules.push(mod);
}

export function withPackage(pkg: Commands.Package): HostConfig {
	return (host: TestHost) => host.packages.push(pkg);
}

class TestCommands implements Commands {
	readonly #host: TestHost;

	constructor(host: TestHost) {
		this.#host = host;
	}

	modules = (args: Commands.ModulesArgs): Thenable<Commands.ModulesResult> =>
		Promise.resolve({
			Modules: this.#host.modules.filter((x) => {
				const dir = `${args.Dir}/`;
				if (!x.GoMod.startsWith(dir)) {
					return false;
				}
				if (args.MaxDepth < 0) {
					return true;
				}

				const rel = x.GoMod.replace(dir, '').replace(/\/go\.mod/, '');
				return [...rel.matchAll(/\//)].length <= args.MaxDepth;
			})
		});

	packages = (args: Commands.PackagesArgs): Thenable<Commands.PackagesResults> => {
		const dirs = args.Files.map((file) => {
			const isFile =
				this.#host.modules.some((mod) => mod.GoMod === file) ||
				this.#host.packages.some((pkg) => pkg.TestFiles?.some((f) => f.URI === file));
			if (isFile) {
				return file.replace(/\/[^/]+$/, '');
			}
			return file;
		});

		const Module: Record<string, Commands.Module> = {};
		const Packages = this.#host.packages.filter((pkg) =>
			pkg.TestFiles?.some((file) =>
				dirs.some((dir) => {
					const s = `${dir}/`;
					if (!file.URI.startsWith(s)) {
						return false;
					}
					if (!args.Recursive && file.URI.replace(s, '').includes('/')) {
						return false;
					}

					const mod = pkg.ModulePath && this.#host.modules.find((x) => x.Path === pkg.ModulePath);
					if (mod) {
						Module[pkg.ModulePath!] = mod;
					} else if (pkg.ModulePath) {
						throw new Error(`Missing module: ${pkg.ModulePath}`);
					}

					return true;
				})
			)
		);

		return Promise.resolve({ Module, Packages });
	};
}

class TestWorkspace implements Workspace {
	readonly workspaceFolders: WorkspaceFolder[] = [];
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

export interface ExpectedTestItem {
	kind: GoTestItem.Kind;
	uri: string;
	children?: ExpectedTestItem[];
}

const toResolve: MatcherFunction<[ExpectedTestItem[]]> = function (got, want): ExpectationResult {
	if (!(got instanceof MockTestController)) {
		throw new Error('Expected test controller');
	}

	const convert = (items: TestItemCollection) =>
		[...items].map(([, item]): ExpectedTestItem => {
			const { kind } = GoTestItem.parseId(item.id);
			return {
				kind,
				uri: item.uri!.toString(),
				children: convert(item.children)
			};
		});

	const addChildren = (items: ExpectedTestItem[]) =>
		items.forEach((item) => {
			if (!item.children) {
				item.children = [];
			} else {
				addChildren(item.children);
			}
		});

	const got2 = convert(got.items);
	addChildren(want);

	const gots = this.utils.printReceived(got2);
	const wants = this.utils.printExpected(want);
	if (this.equals(got2, want)) {
		return {
			message: () => `Want: ${wants}\nGot: ${gots}`,
			pass: true
		};
	}

	const diff = this.utils.diff(want, got2, { omitAnnotationLines: true });
	return {
		message: () => `Want: ${wants}\nGot: ${gots}\n\n${diff}`,
		pass: false
	};
};

expect.extend({ toResolve });

declare global {
	namespace jest {
		interface Matchers<R> {
			toResolve(expected: ExpectedTestItem[]): ExpectationResult;
		}
	}
}
