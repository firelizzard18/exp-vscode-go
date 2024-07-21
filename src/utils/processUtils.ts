/* eslint-disable @typescript-eslint/no-explicit-any */
/*---------------------------------------------------------
 * Copyright 2020 The Go Authors. All rights reserved.
 * Licensed under the MIT License. See LICENSE in the project root for license information.
 *--------------------------------------------------------*/

import type { ChildProcess } from 'child_process';
import kill = require('tree-kill');
import cp from 'child_process';
import { LineBuffer } from './lineBuffer';
import { CancellationToken } from 'vscode';

// Kill a process and its children, returning a promise.
export function killProcessTree(p: ChildProcess, logger: (...args: any[]) => void = console.log): Promise<void> {
	if (!p || !p.pid || p.exitCode !== null) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		const { pid } = p;
		if (!pid) return;
		kill(pid, (err) => {
			if (err) {
				logger(`Error killing process ${pid}: ${err}`);
			}
			resolve();
		});
	});
}

interface SpawnOptions extends cp.SpawnOptions {
	cancel: CancellationToken;
	stdout: (line: string) => void;
	stderr: (line: string) => void;
}

interface ProcessResult {
	code: number | null;
	signal: NodeJS.Signals | null;
}

export function spawnProcess(command: string, args: readonly string[], options: SpawnOptions): Promise<ProcessResult> {
	return new Promise<ProcessResult>((resolve) => {
		const { stdout, stderr, cancel, ...rest } = options;
		if (cancel.isCancellationRequested) {
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
