/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Tokenizer, TokenParser, ParsedElementInfo } from '@streamparser/json';
import { stat } from 'node:fs/promises';
import { promisify } from 'node:util';
import { execFile, ExecFileOptions } from 'node:child_process';
import { Context } from './testing';
import { AsyncLocalStorage } from 'node:async_hooks';
import { Uri } from 'vscode';

export function pathContains(a: string | Uri, b: string | Uri) {
	if (typeof a !== 'string') a = a.fsPath;
	if (typeof b !== 'string') b = b.fsPath;

	// A contains B if and only if the relative path does not start with ../.
	// Additionally - on Windows - if A and B have different drive letters than
	// the 'relative' path will still be absolute.
	const rel = path.relative(a, b);
	return !(path.isAbsolute(rel) || rel.startsWith('..' + path.sep));
}

export function timeit<R>(display: string, fn: () => R) {
	const prefix = timeit.store.getStore() ?? '';
	const start = performance.now();
	console.log(`${prefix}> ${display} [${start}]`);

	try {
		timeit.store.enterWith(prefix + '  ');
		const r = fn();
		if (r && typeof r === 'object' && 'then' in r && typeof r.then === 'function') {
			return (r as Thenable<unknown>).then((r) => {
				console.log(`${prefix}  ${display}: ${performance.now() - start} ms`);
				return r;
			}) as R;
		}
		console.log(`${prefix}< ${display}: ${performance.now() - start} ms`);
		return r;
	} finally {
		timeit.store.enterWith(prefix);
	}
}

timeit.store = new AsyncLocalStorage<string>();

// From vscode-go

export function substituteEnv(input: string): string {
	return input.replace(/\${env:([^}]+)}/g, (match, capture) => {
		return process.env[capture.trim()] || '';
	});
}

/**
 * Expands ~ to homedir in non-Windows platform and resolves
 * ${workspaceFolder}, ${workspaceRoot} and ${workspaceFolderBasename}
 */
export function resolvePath(inputPath: string, workspaceFolder?: string): string {
	if (!inputPath || !inputPath.trim()) {
		return inputPath;
	}

	// if (!workspaceFolder && vscode.workspace.workspaceFolders) {
	// 	workspaceFolder = getWorkspaceFolderPath(
	// 		vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri
	// 	);
	// }

	if (workspaceFolder) {
		inputPath = inputPath.replace(/\${workspaceFolder}|\${workspaceRoot}/g, workspaceFolder);
		inputPath = inputPath.replace(/\${workspaceFolderBasename}/g, path.basename(workspaceFolder));
	}
	return resolveHomeDir(inputPath);
}

/**
 * Expands ~ to homedir in non-Windows platform
 */
export function resolveHomeDir(inputPath: string): string {
	if (!inputPath || !inputPath.trim()) {
		return inputPath;
	}
	return inputPath.startsWith('~') ? path.join(os.homedir(), inputPath.substr(1)) : inputPath;
}

export function correctBinname(toolName: string) {
	if (process.platform === 'win32') {
		return toolName + '.exe';
	}
	return toolName;
}

export function rmdirRecursive(dir: string) {
	if (fs.existsSync(dir)) {
		fs.readdirSync(dir).forEach((file) => {
			const relPath = path.join(dir, file);
			if (fs.lstatSync(relPath).isDirectory()) {
				rmdirRecursive(relPath);
			} else {
				try {
					fs.unlinkSync(relPath);
				} catch (err) {
					console.log(`failed to remove ${relPath}: ${err}`);
				}
			}
		});
		fs.rmdirSync(dir);
	}
}

let tmpDir: string | undefined;

export function getTempDirPath(): string {
	if (!tmpDir) {
		tmpDir = fs.mkdtempSync(os.tmpdir() + path.sep + 'vscode-go');
	}

	if (!fs.existsSync(tmpDir)) {
		fs.mkdirSync(tmpDir);
	}

	return tmpDir;
}

/**
 * Returns file path for given name in temp dir
 * @param name Name of the file
 */
export function getTempFilePath(name: string): string {
	return path.normalize(path.join(getTempDirPath(), name));
}

export function cleanupTempDir() {
	if (tmpDir) {
		rmdirRecursive(tmpDir);
	}
	tmpDir = undefined;
}

export type JsonValue = Exclude<ParsedElementInfo.ParsedElementInfo['value'], undefined>;

export function parseJSONStream(s: string, onValue: (_: JsonValue) => void) {
	const t = new Tokenizer();

	let p = new TokenParser();
	p.onValue = (x) => {
		if (x.parent || !x.value) return;
		onValue(x.value);
	};
	p.onEnd = () => {
		const { onValue, onEnd } = p;
		p = new TokenParser();
		Object.assign(p, { onValue, onEnd });
	};

	t.onToken = (t) => {
		p.write(t);
	};
	t.write(s);
}

export async function exists(s: string) {
	try {
		return await stat(s);
	} catch (err) {
		if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
			return;
		}
		throw err;
	}
}

export async function execGoStr(context: Context, args: string[], opts: ExecFileOptions) {
	const { binPath } = context.go.settings.getExecutionCommand('go') || {};
	if (!binPath) {
		throw new Error('Failed to run "go env" as the "go" binary cannot be found in either GOROOT or PATH');
	}
	const { stdout } = await promisify(execFile)(binPath, args, opts);
	return stdout.trim();
}
