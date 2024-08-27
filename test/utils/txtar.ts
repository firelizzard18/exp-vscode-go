import type { Uri, FileSystem as FullFileSystem } from 'vscode';
import path from 'node:path';
import fs from 'node:fs/promises';

type FileSystem = Pick<FullFileSystem, 'readFile' | 'readDirectory'>;

class MapFS extends Map<string, MapFS | Uint8Array> implements FileSystem {
	readonly path: string;

	constructor(path: string) {
		super();
		this.path = path;
	}

	async copyTo(dst: string) {
		for (const [name, entry] of this) {
			const loc = path.join(dst, name);
			if (entry instanceof MapFS) {
				await fs.mkdir(loc);
				await entry.copyTo(loc);
			} else {
				await fs.writeFile(loc, entry);
			}
		}
	}

	readFile(uri: Uri): Thenable<Uint8Array> {
		const entry = this.#read(uri.fsPath);
		if (!(entry instanceof Uint8Array)) {
			throw new Error(`${uri.fsPath} is not a file`);
		}

		return Promise.resolve(entry);
	}

	readDirectory(uri: Uri): Thenable<[string, FileType][]> {
		const entry = this.#read(uri.fsPath);
		if (!(entry instanceof MapFS)) {
			throw new Error(`${uri.fsPath} is not a directory`);
		}

		return Promise.resolve(
			[...entry].map(([name, value]) => [name, value instanceof MapFS ? FileType.Directory : FileType.File])
		);
	}

	mkdir(fsPath: string): MapFS {
		if (!fsPath || fsPath === '.') {
			return this;
		}

		const [base, rest] = fsPath.split('/', 2);
		let entry = this.get(base);
		if (!entry) {
			entry = new MapFS(path.join(this.path, base));
			this.set(base, entry);
		} else if (!(entry instanceof MapFS)) {
			throw new Error(`${path.join(this.path, fsPath)} is not a directory`);
		}

		return entry.mkdir(rest);
	}

	#read(fsPath: string): MapFS | Uint8Array | void {
		const [, base, rest] = fsPath.match(/([^/]+)?(?:\/(.*))?/) || [];
		const entry = !base ? this : this.get(base);
		if (!entry) {
			throw new Error(`${path.join(this.path, fsPath)} not found`);
		}
		if (!rest) {
			return entry;
		}

		if (!(entry instanceof MapFS)) {
			throw new Error(`${path.join(this.path, fsPath)} is not a directory`);
		}
		return entry.#read(rest);
	}
}

export class TxTar extends MapFS implements FileSystem {
	constructor(...args: Parameters<typeof Buffer.from>) {
		super('/');
		const txtar = Buffer.from(...args).toString('utf-8');
		const files = txtar.split(/^-- ([^\n]*) --$\n/gm).slice(1);
		while (files.length > 1) {
			const [file, content] = files.splice(0, 2);
			this.mkdir(path.dirname(file)).set(path.basename(file), Buffer.from(content, 'utf-8'));
		}
	}
}

// Stolen from VSCode
enum FileType {
	/**
	 * The file type is unknown.
	 */
	Unknown = 0,
	/**
	 * A regular file.
	 */
	File = 1,
	/**
	 * A directory.
	 */
	Directory = 2,
	/**
	 * A symbolic link to a file.
	 */
	SymbolicLink = 64
}
