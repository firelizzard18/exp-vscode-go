import { Uri, FileSystem as FullFileSystem } from 'vscode';
import { afterAll, beforeAll } from '@jest/globals';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';

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
			[...entry].map(([name, value]) => [name, value instanceof MapFS ? FileType.Directory : FileType.File]),
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
	SymbolicLink = 64,
}

export class Workspace {
	path: string = '';
	uri: Uri = Uri.file('');

	private constructor() {}

	/**
	 * Dumps the txtar to a temp directory and deletes it afterwards.
	 * @param src The txtar source
	 * @returns The temp directory and URI
	 */
	static setup(src: string, wsdir?: string) {
		// Remove common leading whitespace
		src = removeIndentation(src);

		const ws = new Workspace();
		beforeAll(async () => {
			const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jest-'));
			ws.path = wsdir ? path.join(tmp, wsdir) : tmp;
			ws.uri = Uri.file(ws.path);
			console.log('Workspace:', ws.path);

			const txtar = new TxTar(src);
			await txtar.copyTo(tmp);
		});

		afterAll(async () => {
			await fs.rm(ws.path, { force: true, recursive: true });
		});

		return ws;
	}

	writeFile(file: string, content: string) {
		content = removeIndentation(content);
		return fs.writeFile(path.join(this.path, file), content);
	}
}

function removeIndentation(s: string) {
	// Remove common leading whitespace
	const lines = s.split('\n');
	const checkLines = lines.filter((l, i) => i > 0 && /\S/.test(l));
	let i = 0;
	for (; ; i++) {
		const s = checkLines.map((l) => l.substring(i, i + 1));
		if (s.some((s) => !/^\s*$/.test(s)) && (s.length < 2 || new Set(s).size !== 1)) {
			break;
		}
	}

	return lines.map((l) => l.replace(/^\s*/, (s) => (s.length > i ? s.substring(i) : ''))).join('\n');
}
