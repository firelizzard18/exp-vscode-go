/**
 * Interfaces to support testing.
 */

/* eslint-disable n/no-unpublished-import */
/* eslint-disable @typescript-eslint/no-namespace */
import type vscode from 'vscode';
import type * as lsp from 'vscode-languageserver-types';
import type { GoExtensionAPI } from '../vscode-go';
import type { Spawner } from '../test/utils';
import { ExtensionContext, Memento, TestItem, TestItemCollection } from 'vscode';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Tail<T extends any[]> = T extends [any, ...infer Tail] ? Tail : never;

// Signatures used by the component test mock to allow tests to wait for events
// to be processed.
declare module 'vscode' {
	export interface EventEmitter<T> {
		fire(data: T): void | Promise<void>;
	}
}

export interface Context extends Pick<vscode.ExtensionContext, 'storageUri'> {
	readonly testing: boolean;
	readonly go: GoExtensionAPI;
	readonly output: vscode.LogOutputChannel;
	readonly workspace: VSCodeWorkspace;
	readonly state: Memento;
	readonly commands: Commands;
	readonly spawn: Spawner;
	readonly debug: Spawner;
}

export type VSCodeFileSystem = Pick<vscode.FileSystem, 'delete' | 'createDirectory' | 'readFile'>;

// The subset of vscode.workspace that is used by the test explorer.
export type VSCodeWorkspace = Pick<typeof vscode.workspace, 'workspaceFolders' | 'getWorkspaceFolder' | 'saveAll'> & {
	getConfiguration(section: string, scope?: vscode.ConfigurationScope | null): ConfigValue;

	readonly fs: VSCodeFileSystem;
};

export interface ConfigValue {
	get<T>(section: string): T | undefined;
}

export type TestController = Pick<
	vscode.TestController,
	| 'items'
	| 'createTestItem'
	| 'createRunProfile'
	| 'createTestRun'
	| 'dispose'
	| 'resolveHandler'
	| 'refreshHandler'
	| 'invalidateTestResults'
>;

export interface Commands {
	modules(args: Commands.ModulesArgs): Thenable<Commands.ModulesResult>;
	packages(args: Commands.PackagesArgs): Thenable<Commands.PackagesResults>;
}

export namespace Commands {
	export interface ModulesArgs {
		Dir: lsp.URI;
		MaxDepth: number;
	}

	export interface ModulesResult {
		Modules?: Module[];
	}

	export interface PackagesArgs {
		Files: lsp.URI[];
		Recursive?: boolean;
		Mode?: number;
	}

	export interface PackagesResults {
		Packages?: Package[];
		Module?: Record<string, Module>;
	}

	export interface Module {
		Path: string;
		Version?: string;
		GoMod: lsp.URI;
	}

	export interface Package {
		Path: string;
		ForTest?: string;
		ModulePath?: string;
		TestFiles?: TestFile[];
	}

	export interface TestFile {
		URI: lsp.URI;
		Tests: TestCase[];
	}

	export interface TestCase {
		Name: string;
		Loc: lsp.Location;
	}
}

export const helpers = (ctx: ExtensionContext, testCtx: Context, commands: typeof vscode.commands) => ({
	event: <T>(event: vscode.Event<T>, msg: string, fn: (e: T) => unknown) => {
		ctx.subscriptions.push(event((e) => doSafe(testCtx, msg, () => fn(e))));
	},
	command: (name: string, fn: (...args: any[]) => any) => {
		ctx.subscriptions.push(
			commands.registerCommand(name, (...args) => doSafe(testCtx, `executing ${name}`, () => fn(...args))),
		);
	},
});

export const doSafe = async <T>(ctx: Context, msg: string, fn: () => T | Promise<T>) => {
	try {
		return await fn();
	} catch (error) {
		reportError(ctx, new Error(`${msg}: ${error}`, { cause: error }));
	}
};

export function reportError(ctx: Context, error: unknown) {
	if (ctx.testing) throw error;
	else ctx.output.error(`Error: ${error}`);
}

const debugResolve = false;

export function debugViewTree(root: TestItemCollection, label: string) {
	if (!debugResolve) return;
	const s = [label];
	const add = (item: TestItem, indent: string) => {
		if (indent === '  ' && item.children.size > 2) {
			console.error('wtf');
		}
		s.push(`${indent}${item.label}`);
		for (const [, child] of item.children) {
			add(child, indent + '  ');
		}
	};
	for (const [, item] of root) {
		add(item, '  ');
	}
	console.log(s.join('\n'));
}
