/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-explicit-any */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Tokenizer, TokenParser, ParsedElementInfo } from '@streamparser/json';

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
 * Exapnds ~ to homedir in non-Windows platform
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

type JsonValue = Exclude<ParsedElementInfo.ParsedElementInfo['value'], undefined>;

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
