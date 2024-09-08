import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// From vscode-go

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
