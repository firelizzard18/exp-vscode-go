/* eslint-disable @typescript-eslint/no-unused-vars */
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
	Event,
	TestRun,
	Uri,
	window
} from 'vscode';
import { killProcessTree } from '../utils/processUtils';
import { Context } from './testing';

export interface SpawnOptions extends Pick<cp.SpawnOptions, 'env'> {
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
	(ctx: Context, command: string, flags: readonly string[], options: SpawnOptions): Promise<ProcessResult | void>;
}

export function spawnProcess(ctx: Context, command: string, flags: readonly string[], options: SpawnOptions) {
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

		const tp = cp.spawn(command, ['test', '-json', ...flags], {
			...rest,
			stdio: 'pipe'
		});
		cancel.onCancellationRequested(() => {
			killProcessTree(tp);
		});

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
const debugSessionOutput = new Map<string, Pick<SpawnOptions, 'stdout' | 'stderr'>>();
const debugAdapterOutput = window.createOutputChannel('Go Debug Debug', { log: true });

debug.registerDebugAdapterTrackerFactory('go', {
	createDebugAdapterTracker(s) {
		if (s.type !== 'go') return;

		const opts = debugSessionOutput.get(s.configuration.sessionID);
		if (!opts) return;

		return {
			onWillReceiveMessage(msg) {
				debugAdapterOutput?.info(`> ${JSON.stringify(msg)}`);
			},
			onDidSendMessage(msg: { type: string; event: string; body: { category: string; output: string } }) {
				debugAdapterOutput?.info(`< ${JSON.stringify(msg)}`);
				if (msg.type !== 'event') return;
				if (msg.event !== 'output') return;
				if (msg.body.category === 'stdout') {
					opts.stdout(msg.body.output);
				} else {
					opts.stderr(msg.body.output);
				}
			}
		};
	}
});

export async function debugProcess(
	ctx: Context,
	command: string,
	flags: readonly string[],
	options: SpawnOptions
): Promise<ProcessResult | void> {
	const { run, cancel, cwd, env, stdout, stderr } = options;
	if (cancel.isCancellationRequested) {
		return Promise.resolve();
	}

	const id = `debug #${debugSessionID++}`;
	const subs: Disposable[] = [];
	const event = <T>(event: Event<T>, fn: (e: T) => unknown) => {
		subs.push(event((e) => fn(e)));
	};

	// [Event] Debug session started
	const didStart = new Promise<DebugSession | void>((resolve) =>
		event(debug.onDidStartDebugSession, (s) => {
			if (s.configuration.sessionID !== id) {
				return;
			}
			resolve(s);
			cancel.onCancellationRequested(() => debug.stopDebugging(s));
		})
	);

	// [Event] Debug session terminated
	const didStop = new Promise<void>((resolve) =>
		event(debug.onDidTerminateDebugSession, (s) => {
			if (s.type !== 'go' || s.configuration.sessionID !== id) {
				return;
			}
			resolve();
		})
	);

	// Run go test2json to parse the output
	const outbuf = new LineBuffer();
	outbuf.onLine(stdout);
	outbuf.onDone((x) => x && stdout(x));

	const proc = cp.spawn(command, ['tool', 'test2json']);
	proc.stdout.on('data', (chunk) => outbuf.append(chunk.toString('utf-8')));
	proc.on('close', () => outbuf.done());
	subs.push({ dispose: () => killProcessTree(proc) });

	// Capture output
	debugSessionOutput.set(id, {
		stderr,
		stdout: (line) => proc.stdin.write(line)
	});
	subs.push({ dispose: () => debugSessionOutput.delete(id) });

	subs.push(
		debug.registerDebugAdapterTrackerFactory('go', {
			createDebugAdapterTracker(s) {
				if (s.type !== 'go' || s.configuration.sessionID !== id) {
					return;
				}
				return {
					onDidSendMessage(msg: { type: string; event: string; body: any }) {
						if (msg.type !== 'event') return;
						if (msg.event !== 'output') return;
						ctx.output.debug(`DAP: ${JSON.stringify(msg)}`);
					}
				};
			}
		})
	);

	const ws = ctx.workspace.getWorkspaceFolder(Uri.file(cwd));
	const config: DebugConfiguration = {
		sessionID: id,
		name: 'Debug test',
		type: 'go',
		request: 'launch',
		mode: 'test',
		program: cwd,
		env,
		args: ['-test.v', ...flags.map((x) => x.replace(/^-/, '-test.'))]
	};
	const dbgOpts: DebugSessionOptions = {};

	// This is necessary because testRun is not available in 1.75 so tsc complains
	Object.assign(dbgOpts, { testRun: run });

	try {
		if (!(await debug.startDebugging(ws, config, dbgOpts))) {
			return;
		}
		await didStart;
		await didStop;
	} finally {
		subs.forEach((s) => s.dispose());
	}
}
