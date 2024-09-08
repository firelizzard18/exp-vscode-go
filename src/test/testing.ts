/**
 * Interfaces to support testing.
 */

/* eslint-disable n/no-unpublished-import */
/* eslint-disable @typescript-eslint/no-namespace */
import type vscode from 'vscode';
import type * as lsp from 'vscode-languageserver-types';
import type { GoExtensionAPI } from '../vscode-go';
import type { Spawner } from './utils';
import { Memento } from 'vscode';

// Signatures used by the component test mock to allow tests to wait for events
// to be processed.
declare module 'vscode' {
	export interface EventEmitter<T> {
		fire(data: T): void | Promise<void>;
	}

	export interface TestItemCollection {
		replace(items: readonly TestItem[]): Promise<void>;
		add(item: TestItem): Promise<void>;
	}
}

export interface Context extends Pick<vscode.ExtensionContext, 'storageUri'> {
	readonly testing: boolean;
	readonly go: GoExtensionAPI;
	readonly output: vscode.LogOutputChannel;
	readonly workspace: Workspace;
	readonly state: Memento;
	readonly commands: Commands;
	readonly spawn: Spawner;
	readonly debug: Spawner;
}

export type FileSystem = Pick<vscode.FileSystem, 'delete' | 'createDirectory'>;

// The subset of vscode.workspace that is used by the test explorer.
export type Workspace = Pick<typeof vscode.workspace, 'workspaceFolders' | 'getWorkspaceFolder' | 'saveAll'> & {
	// Only allow reading the goExp config
	getConfiguration(section: string, scope?: vscode.ConfigurationScope | null): ConfigValue;

	readonly fs: FileSystem;
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
