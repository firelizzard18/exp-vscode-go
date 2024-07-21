/* eslint-disable @typescript-eslint/no-explicit-any */
/*---------------------------------------------------------
 * Copyright 2020 The Go Authors. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import cp from 'child_process';
import { LineBuffer } from '../utils/lineBuffer';
import {
	CancellationToken,
	debug,
	DebugConfiguration,
	DebugSession,
	DebugSessionOptions,
	Disposable,
	TestRun,
	Uri
} from 'vscode';
import { killProcessTree } from '../utils/processUtils';
import { Context } from './testSupport';

interface SpawnOptions extends Pick<cp.SpawnOptions, 'env'> {
	run: TestRun;
	cwd: string;
	cancel: CancellationToken;
	stdout: (line: string) => void;
	stderr: (line: string) => void;
}

interface ProcessResult {
	code: number | null;
	signal: NodeJS.Signals | null;
}

export interface Spawner {
	(ctx: Context, command: string, args: readonly string[], options: SpawnOptions): Promise<ProcessResult | void>;
}

export function spawnProcess(ctx: Context, command: string, args: readonly string[], options: SpawnOptions) {
	return new Promise<ProcessResult | void>((resolve) => {
		const { stdout, stderr, cancel, ...rest } = options;
		if (cancel.isCancellationRequested) {
			resolve();
			return;
		}

		const outbuf = new LineBuffer();
		outbuf.onLine(stdout);
		outbuf.onDone((x) => x && stdout(x));

		const errbuf = new LineBuffer();
		errbuf.onLine(stderr);
		errbuf.onDone((x) => x && stderr(x));

		const tp = cp.spawn(command, args, {
			...rest,
			stdio: 'pipe'
		});
		cancel.onCancellationRequested(() => killProcessTree(tp));

		tp.stdout.on('data', (chunk) => outbuf.append(chunk.toString('utf-8')));
		tp.stderr.on('data', (chunk) => errbuf.append(chunk.toString('utf-8')));

		tp.on('close', (code, signal) => {
			outbuf.done();
			errbuf.done();
			resolve({ code, signal });
		});
	});
}

let debugSessionID = 0;

export async function debugProcess(
	ctx: Context,
	_: string, // Command
	args: readonly string[],
	options: SpawnOptions
): Promise<ProcessResult | void> {
	// TODO Can we get output from the debug session, in order to check for
	// run/pass/fail events?

	const { run, cancel, cwd, env } = options;
	if (cancel.isCancellationRequested) {
		return Promise.resolve();
	}

	const id = `debug #${debugSessionID++}`;
	const subs: Disposable[] = [];
	const sessionPromise = new Promise<DebugSession | void>((resolve) => {
		subs.push(
			debug.onDidStartDebugSession((s) => {
				if (s.configuration.sessionID !== id) {
					return;
				}
				resolve(s);
				cancel.onCancellationRequested(() => debug.stopDebugging(s));
			})
		);

		subs.push(
			cancel.onCancellationRequested(() => {
				resolve();
				subs.forEach((s) => s.dispose());
			})
		);
	});

	const config: DebugConfiguration = {
		sessionID: id,
		name: 'Debug test',
		type: 'go',
		request: 'launch',
		mode: 'test',
		program: cwd,
		env,
		args: args.map((x) => x.replace(/^-/, '-test.'))
	};
	const dbgOpts: DebugSessionOptions = {};

	// This is necessary because testRun is not available in 1.75 so tsc complains
	Object.assign(dbgOpts, { testRun: run });

	const ws = ctx.workspace.getWorkspaceFolder(Uri.file(cwd));
	const started = await debug.startDebugging(ws, config, dbgOpts);
	if (!started) {
		subs.forEach((s) => s.dispose());
		return;
	}

	const session = await sessionPromise;
	if (!session) {
		return;
	}

	await new Promise<void>((resolve) => {
		subs.push(
			debug.onDidTerminateDebugSession((s) => {
				if (s.id !== session.id) return;
				resolve();
				subs.forEach((s) => s.dispose());
			})
		);
	});
}
