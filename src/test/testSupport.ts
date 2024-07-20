/**
 * Support for testing {@link GoTestController}
 */

/* eslint-disable n/no-unpublished-import */
/* eslint-disable @typescript-eslint/no-namespace */
import * as vscode from 'vscode';
import type * as lsp from 'vscode-languageserver-types';

// The subset of vscode.FileSystem that is used by the test explorer.
export type FileSystem = Pick<vscode.FileSystem, 'readFile' | 'readDirectory'>;

// The subset of vscode.workspace that is used by the test explorer.
export interface Workspace extends Pick<typeof vscode.workspace, WorkspaceProps> {
	// use custom FS type
	readonly fs: FileSystem;

	// only include one overload
	openTextDocument(uri: vscode.Uri): Thenable<vscode.TextDocument>;
}

type WorkspaceProps = 'workspaceFolders' | 'getWorkspaceFolder' | 'textDocuments' | 'getConfiguration' | 'saveAll';

// Arguments for GoTestController.setup
export interface SetupArgs {
	createController(id: string, label: string): vscode.TestController;
	doSafe?: <T>(msg: string, fn: () => T | Promise<T>) => T | undefined | Promise<T | undefined>;
}

export interface Commands {
	modules(args: Commands.ModulesArgs): Thenable<Commands.ModulesResult>;
	packages(args: Commands.PackagesArgs): Thenable<Commands.PackagesResults>;
}

export namespace Commands {
	export interface ModulesArgs {
		Dir: lsp.URI;
		MaxDepth?: number;
	}

	export interface ModulesResult {
		Modules: Module[];
	}

	export interface PackagesArgs {
		Files: lsp.URI[];
		Recursive?: boolean;
		Mode?: number;
	}

	export interface PackagesResults {
		Packages: Package[];
		Module: Record<string, Module>;
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
