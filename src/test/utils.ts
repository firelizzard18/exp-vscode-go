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

export type Flags = { [key: string]: string | boolean };

export interface Spawner {
	(ctx: Context, scope: Uri, flags: Flags, options: SpawnOptions): Promise<ProcessResult | void>;
}

export function spawnProcess(context: Context, scope: Uri, flags: Flags, options: SpawnOptions) {
	return new Promise<ProcessResult | void>((resolve) => {
		const { stdout, stderr, cancel, ...rest } = options;
		if (cancel.isCancellationRequested) {
			resolve();
			return;
		}

		const { binPath } = context.go.settings.getExecutionCommand('go', scope) || {};
		if (!binPath) {
			throw new Error('Failed to run "go test" as the "go" binary cannot be found in either GOROOT or PATH');
		}

		const outbuf = new LineBuffer();
		outbuf.onLine(stdout);
		outbuf.onDone((x) => x && stdout(x));

		const errbuf = new LineBuffer();
		errbuf.onLine(stderr);
		errbuf.onDone((x) => x && stderr(x));

		flags.json = true;
		const tp = cp.spawn(binPath, ['test', ...flags2args(flags)], {
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

debug?.registerDebugAdapterTrackerFactory('go', {
	createDebugAdapterTracker(s) {
		if (s.type !== 'go') return;

		const opts = debugSessionOutput.get(s.configuration.sessionID);
		if (!opts) return;

		return {
			onDidSendMessage(msg: { type: string; event: string; body: { category: string; output: string } }) {
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

/**
 * Spawns a debug session with the given flags.
 *
 * VSCode does not provide a mechanism to capture the output of a debug session.
 * So instead of something clean like `debugSession.output`, we have to use a
 * debug adapter tracker to capture events and then pipe them to the caller.
 * However, we may be able to work around this issue by asking delve to copy the
 * test output to a secondary stream, or by using custom events.
 *
 * As an additional complication, delve does not have an equivalent to `go test
 * -json` so we have to pipe the output to `go tool test2json` to parse it.
 *
 * @see https://github.com/microsoft/vscode/issues/104208
 * @see https://github.com/microsoft/vscode/issues/108145
 */
export async function debugProcess(
	ctx: Context,
	scope: Uri,
	flags: Flags,
	options: SpawnOptions
): Promise<ProcessResult | void> {
	const { run, cancel, cwd, env, stdout, stderr } = options;
	if (cancel.isCancellationRequested) {
		return Promise.resolve();
	}

	const { binPath } = ctx.go.settings.getExecutionCommand('go', scope) || {};
	if (!binPath) {
		throw new Error('Failed to run "go test" as the "go" binary cannot be found in either GOROOT or PATH');
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

	const proc = cp.spawn(binPath, ['tool', 'test2json']);
	proc.stdout.on('data', (chunk) => outbuf.append(chunk.toString('utf-8')));
	proc.on('close', () => outbuf.done());
	subs.push({ dispose: () => killProcessTree(proc) });

	// Capture output
	debugSessionOutput.set(id, {
		stderr,
		stdout: (line) => proc.stdin.write(line)
	});
	subs.push({ dispose: () => debugSessionOutput.delete(id) });

	const flagArgs = [];
	const buildFlags = [];
	for (const [flag, value] of Object.entries(flags)) {
		// Build flags must be handled separately, test flags must be prefixed
		if (isBuildFlag(flag)) {
			buildFlags.push(flag2arg(flag, value));
		} else {
			flagArgs.push(flag2arg(`test.${flag}`, value));
		}
	}

	const ws = ctx.workspace.getWorkspaceFolder(Uri.file(cwd));
	const config: DebugConfiguration = {
		sessionID: id,
		name: 'Debug test',
		type: 'go',
		request: 'launch',
		mode: 'test',
		program: cwd,
		env,
		buildFlags,
		args: ['-test.v', ...flagArgs]
	};

	try {
		if (!(await debug.startDebugging(ws, config, { testRun: run }))) {
			return;
		}
		await didStart;
		await didStop;
	} finally {
		subs.forEach((s) => s.dispose());
	}
}

export function flags2args(flags: Flags) {
	return Object.entries(flags).map(([k, v]) => flag2arg(k, v));
}

function flag2arg(name: string, value: string | boolean) {
	return value === true ? `-${name}` : `-${name}=${value}`;
}

function isBuildFlag(name: string) {
	switch (name) {
		case 'a':
		case 'race':
		case 'msan':
		case 'asan':
		case 'cover':
		case 'covermode':
		case 'coverpkg':
		case 'asmflags':
		case 'buildvcs':
		case 'compiler':
		case 'gccgoflags':
		case 'gcflags':
		case 'ldflags':
		case 'mod':
		case 'modcacherw':
		case 'modfile':
		case 'overlay':
		case 'pgo':
		case 'tags':
		case 'trimpath':
		case 'toolexec':
			return true;

		default:
			return false;
	}
}
