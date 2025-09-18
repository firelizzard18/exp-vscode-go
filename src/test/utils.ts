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
	Location,
	TestItem,
	TestRun,
	Uri,
} from 'vscode';
import { killProcessTree } from '../utils/processUtils';
import { Context } from '../utils/testing';
import { GoLaunchRequest } from '../vscode-go';
import { createHash } from 'crypto';
import { getTempDirPath } from '../utils/util';

export interface SpawnOptions extends Pick<cp.SpawnOptions, 'env'> {
	cwd: string;
	cancel: CancellationToken;
	stdout: (line: string) => void;
	stderr: (line: string) => void;
	debug?: Partial<GoLaunchRequest>;
	mode: 'test' | 'run';
}

export interface ProcessResult {
	code: number | null;
	signal: NodeJS.Signals | null;
}

export type Flags = { [key: string]: string | boolean };

export interface TestRunContext {
	testItem: TestItem;
	run: TestRun;
	append(output: string, location?: Location, test?: TestItem): void;
}

export interface Spawner {
	(
		ctx: Context,
		run: TestRunContext,
		flags: Flags,
		userFlags: Flags,
		args: string[],
		options: SpawnOptions,
	): Promise<ProcessResult>;
}

export function spawnProcess(
	context: Context,
	run: TestRunContext,
	flags: Flags,
	userFlags: Flags,
	args: string[],
	options: SpawnOptions,
) {
	return new Promise<ProcessResult>((resolve) => {
		const { mode, stdout, stderr, cancel, ...rest } = options;
		if (cancel.isCancellationRequested) {
			resolve({ code: null, signal: null });
			return;
		}

		const { binPath } = context.go.settings.getExecutionCommand('go', run.testItem.uri!) || {};
		if (!binPath) {
			throw new Error(`Failed to run "go ${mode}" as the "go" binary cannot be found in either GOROOT or PATH`);
		}

		const outbuf = new LineBuffer();
		outbuf.onLine(stdout);
		outbuf.onDone((x) => x && stdout(x));

		const errbuf = new LineBuffer();
		errbuf.onLine(stderr);
		errbuf.onDone((x) => x && stderr(x));

		if (mode === 'test') {
			flags.json = true;
			fixTestFlags(run, flags, userFlags);

			const ws = context.workspace.getWorkspaceFolder(run.testItem.uri!);
			const niceFlags = Object.assign({}, flags);
			if (ws) {
				for (const [flag, value] of Object.entries(niceFlags)) {
					if (typeof value === 'string') {
						niceFlags[flag] = value.replace(ws.uri.fsPath, '${workspaceFolder}');
					}
				}
			}
		}

		run.append(
			`$ cd ${run.testItem.uri!.fsPath}\n$ go ${mode} ${[...prettyPrintFlags(context, run, flags, userFlags), ...args].join(' ')}\n\n`,
			undefined,
			run.testItem,
		);

		const tp = cp.spawn(binPath, [mode, ...flags2args(flags), ...flags2args(userFlags), ...args], {
			...rest,
			stdio: 'pipe',
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
			},
		};
	},
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
	run: TestRunContext,
	flags: Flags,
	userFlags: Flags,
	args: string[],
	spawnOptions: SpawnOptions,
): Promise<ProcessResult> {
	const mode = spawnOptions.mode === 'run' ? 'debug' : spawnOptions.mode;
	const { cancel, cwd, env, stdout, stderr } = spawnOptions;
	if (cancel.isCancellationRequested) {
		return { code: null, signal: null };
	}

	const { binPath } = ctx.go.settings.getExecutionCommand('go', run.testItem.uri!) || {};
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
			event(run.run.token.onCancellationRequested, () => debug.stopDebugging(s));
			event(cancel.onCancellationRequested, () => debug.stopDebugging(s));
		}),
	);

	// [Event] Debug session terminated
	const didStop = new Promise<void>((resolve) =>
		event(debug.onDidTerminateDebugSession, (s) => {
			if (s.type !== 'go' || s.configuration.sessionID !== id) {
				return;
			}
			resolve();
		}),
	);

	switch (mode) {
		case 'debug':
			// Capture output
			debugSessionOutput.set(id, { stderr, stdout });
			subs.push({ dispose: () => debugSessionOutput.delete(id) });
			break;

		case 'test': {
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
				stdout: (line) => proc.stdin.write(line),
			});
			subs.push({ dispose: () => debugSessionOutput.delete(id) });
			break;
		}
	}

	// Build flags must be handled separately, test flags must be prefixed
	const testFlags: Flags = {};
	const buildFlags: Flags = {};
	if (mode === 'test') {
		fixTestFlags(run, flags, userFlags);
		testFlags['test.v'] = true; // TODO: use 'test2json' and ignore -v and -test.v user flags
	}

	for (const [flag, value] of Object.entries(flags)) {
		if (isBuildFlag(flag) || mode === 'debug') {
			buildFlags[flag] = value;
		} else {
			testFlags[`test.${flag}`] = value;
		}
	}

	// Handle user flags
	for (const [flag, value] of Object.entries(userFlags)) {
		if (flag === 'args') {
			// ignore
		} else if (isBuildFlag(flag)) {
			buildFlags[flag] = value;
		} else if (flag.startsWith('test.')) {
			testFlags[flag] = value;
		} else {
			testFlags[`test.${flag}`] = value;
		}
	}

	const program = mode === 'debug' ? args.shift() : cwd;
	if (!program) {
		throw new Error('No package to run!');
	}

	const prettyBuildFlags = prettyPrintFlags(ctx, run, buildFlags).join(' ');
	run.append(
		`$ cd ${cwd}\n$ dlv ${mode} ${prettyBuildFlags && `--build-flags "${prettyBuildFlags}" `}${mode === 'debug' ? program + ' ' : ''}-- ${[...prettyPrintFlags(ctx, run, testFlags), ...args].join(' ')}\n\n`,
		undefined,
		run.testItem,
	);

	const ws = ctx.workspace.getWorkspaceFolder(Uri.file(cwd));
	const config: DebugConfiguration = {
		...(spawnOptions.debug || {}),
		sessionID: id,
		name: 'Debug test',
		type: 'go',
		request: 'launch',
		mode,
		program,
		env,
		buildFlags: flags2args(buildFlags).join(' '),
		args: flags2args(testFlags),
	} satisfies GoLaunchRequest;

	try {
		if (!(await debug.startDebugging(ws, config, { testRun: run.run }))) {
			return { code: null, signal: null };
		}
		await didStart;
		await didStop;
		return { code: null, signal: null };
	} finally {
		subs.forEach((s) => s.dispose());
	}
}

function flags2args(flags: Flags) {
	return Object.entries(flags).map(([k, v]) => (v === true ? `-${k}` : `-${k}=${v}`));
}

function fixTestFlags(run: TestRunContext, flags: Flags, userFlags: Flags) {
	// Always use -json (the caller must add this), but don't combine it with -v
	// because weird things happen (https://github.com/golang/go/issues/70384)
	delete flags.v;

	// Don't change the user's flags but warn them that it might cause
	// problems
	if (userFlags.v || userFlags['test.v']) {
		run.append('!!! Setting -v or -test.v may degrade your experience due to golang/go#70384\n');
	}
}

function prettyPrintFlags(context: Context, run: TestRunContext, ...flags: Flags[]) {
	const ws = context.workspace.getWorkspaceFolder(run.testItem.uri!);
	const niceFlags: Flags = {};
	flags.forEach((x) => Object.assign(niceFlags, x));
	if (ws) {
		for (const [flag, value] of Object.entries(niceFlags)) {
			if (typeof value === 'string') {
				niceFlags[flag] = value.replace(ws.uri.fsPath, '${workspaceFolder}');
			}
		}
	}
	return flags2args(niceFlags);
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

const captureDirs = new WeakMap<TestRun, Map<Uri, Uri>>();

/**
 * Creates a storage directory for captures taken during a test run.
 *
 * Ideally, if the test run is persisted and supports onDidDispose, it would
 * return the extensions's storage URI. However there are issues with that (see
 * the comment in the function).
 *
 * @param context - The context object.
 * @param run - The test run object.
 * @returns The storage directory URI.
 */
export async function makeCaptureDir(context: Context, run: TestRun, scope: Uri, time: Date): Promise<Uri> {
	// Avoid multiple FS calls
	let cache = captureDirs.get(run);
	if (!cache) {
		cache = new Map();
		captureDirs.set(run, cache);
	}
	if (cache.has(scope)) {
		return cache.get(scope)!;
	}

	const tmp = captureTempDir();

	// This is a simple way to make an ID from the package URI
	const hash = createHash('sha256').update(`${scope}`).digest('hex');
	const dir = Uri.joinPath(tmp, `${hash.substring(0, 16)}-${time.getTime()}`);

	// Store before awaiting to avoid concurrency issues
	cache.set(scope, dir);

	const { fs } = context.workspace;
	await fs.createDirectory(dir);
	run.onDidDispose?.(() => fs.delete(dir, { recursive: true }));

	return dir;
}

function captureTempDir(): Uri {
	// Profiles can be deleted when the run is disposed, but there's no way to
	// re-associated profiles with a past run when VSCode is closed and
	// reopened. So we always use the OS temp directory for now.
	// https://github.com/microsoft/vscode/issues/227924

	// if (run.isPersisted && run.onDidDispose && context.storageUri) {
	// 	return context.storageUri;
	// }

	return Uri.file(getTempDirPath());
}
