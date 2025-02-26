/* eslint-disable @typescript-eslint/no-explicit-any */
/*---------------------------------------------------------
 * Copyright 2021 The Go Authors. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import type { Uri } from 'vscode';
import type semver = require('semver');
import type moment = require('moment');
import type { DebugProtocol } from 'vscode-debugprotocol';

export interface Tool {
	name: string;
	importPath: string;
	modulePath: string;
	isImportant: boolean;
	replacedByGopls?: boolean;
	description: string;

	// If true, consider prerelease version in preview mode
	// (nightly & dev)
	usePrereleaseInPreviewMode?: boolean;
	// If set, this string will be used when installing the tool
	// instead of the default 'latest'. It can be used when
	// we need to pin a tool version (`deadbeaf`) or to use
	// a dev version available in a branch (e.g. `master`).
	defaultVersion?: string;

	// latestVersion and latestVersionTimestamp are hardcoded default values
	// for the last known version of the given tool. We also hardcode values
	// for the latest known pre-release of the tool for the Nightly extension.
	latestVersion?: semver.SemVer | null;
	latestVersionTimestamp?: moment.Moment;
	latestPrereleaseVersion?: semver.SemVer | null;
	latestPrereleaseVersionTimestamp?: moment.Moment;

	// minimumGoVersion and maximumGoVersion set the range for the versions of
	// Go with which this tool can be used.
	minimumGoVersion?: semver.SemVer | null;
	maximumGoVersion?: semver.SemVer | null;

	// close performs any shutdown tasks that a tool must execute before a new
	// version is installed. It returns a string containing an error message on
	// failure.
	close?: (env: NodeJS.Dict<string>) => Promise<string>;
}

/**
 * ToolAtVersion is a Tool at a specific version.
 * Lack of version implies the latest version.
 */
export interface ToolAtVersion extends Tool {
	version?: semver.SemVer;
}

export interface CommandInvocation {
	binPath: string;
}

export interface GoExtensionAPI {
	/** True if the extension is running in preview mode (e.g. prerelease) */
	isPreview?: boolean;

	settings: {
		/**
		 * Returns the execution command corresponding to the specified resource, taking into account
		 * any workspace-specific settings for the workspace to which this resource belongs.
		 */
		getExecutionCommand(toolName: string, resource?: Uri): CommandInvocation | undefined;
	};
}

export interface GoLaunchRequest extends DebugProtocol.LaunchRequestArguments {
	request: 'launch';
	[key: string]: any;
	program: string;
	stopOnEntry?: boolean;
	dlvFlags?: string[];
	args?: string[];
	showLog?: boolean;
	logOutput?: string;
	cwd?: string;
	env?: { [key: string]: string | undefined };
	mode?: 'auto' | 'debug' | 'remote' | 'test' | 'exec';
	remotePath?: string;
	port?: number;
	host?: string;
	buildFlags?: string;
	init?: string;
	// trace, info, warn are to match goLogging.
	// In practice, this adapter handles only verbose, log, and error
	//  verbose === trace,
	//  log === info === warn,
	//  error
	trace?: 'verbose' | 'trace' | 'info' | 'log' | 'warn' | 'error';
	backend?: string;
	output?: string;
	substitutePath?: { from: string; to: string }[];
	/** Delve LoadConfig parameters */
	dlvLoadConfig?: LoadConfig;
	dlvToolPath?: string;
	/** Delve Version */
	apiVersion?: number;
	/** Delve maximum stack trace depth */
	stackTraceDepth?: number;

	showGlobalVariables?: boolean;
	packagePathToGoModPathMap?: { [key: string]: string };

	/** Optional path to .env file. */
	// TODO: deprecate .env file processing from DA.
	// We expect the extension processes .env files
	// and send the information to DA using the 'env' property.
	envFile?: string | string[];
}

export interface GoAttachRequest extends DebugProtocol.AttachRequestArguments {
	request: 'attach';
	processId?: number;
	stopOnEntry?: boolean;
	dlvFlags?: string[];
	showLog?: boolean;
	logOutput?: string;
	cwd?: string;
	mode?: 'local' | 'remote';
	remotePath?: string;
	port?: number;
	host?: string;
	trace?: 'verbose' | 'trace' | 'info' | 'log' | 'warn' | 'error';
	backend?: string;
	substitutePath?: { from: string; to: string }[];
	/** Delve LoadConfig parameters */
	dlvLoadConfig?: LoadConfig;
	dlvToolPath: string;
	/** Delve Version */
	apiVersion: number;
	/** Delve maximum stack trace depth */
	stackTraceDepth: number;

	showGlobalVariables?: boolean;
}

interface LoadConfig {
	// FollowPointers requests pointers to be automatically dereferenced.
	followPointers: boolean;
	// MaxVariableRecurse is how far to recurse when evaluating nested types.
	maxVariableRecurse: number;
	// MaxStringLen is the maximum number of bytes read from a string
	maxStringLen: number;
	// MaxArrayValues is the maximum number of elements read from an array, a slice or a map.
	maxArrayValues: number;
	// MaxStructFields is the maximum number of fields read from a struct, -1 will read all fields.
	maxStructFields: number;
}
