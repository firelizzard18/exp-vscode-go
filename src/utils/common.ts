import type vscode from 'vscode';
import { type Memento } from 'vscode';
import type * as lsp from 'vscode-languageserver-types';

import { type GoExtensionAPI } from '@/vscode-go';

import { type Spawner } from './spawn';

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

// The subset of vscode.workspace that is used by the test explorer.
export type VSCodeWorkspace = Pick<
	typeof vscode.workspace,
	'workspaceFolders' | 'getWorkspaceFolder' | 'saveAll' | 'onDidChangeConfiguration'
> & {
	getConfiguration(section: string, scope?: vscode.ConfigurationScope | null): ConfigValue;

	readonly fs: VSCodeFileSystem;
};

export type VSCodeFileSystem = Pick<vscode.FileSystem, 'delete' | 'createDirectory' | 'readFile'>;

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
		Mode?: PackagesMode;
	}

	export enum PackagesMode {
		NeedTests = 1,
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
		Tests?: TestCase[];
	}

	export interface TestCase {
		Name: string;
		Loc: lsp.Location;
	}
}

export interface ConfigValue {
	get<T>(section: string): T | undefined;
}
