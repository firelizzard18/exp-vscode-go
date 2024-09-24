/* eslint-disable @typescript-eslint/no-unused-vars */
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import {
	type ExtensionContext,
	type TestRun,
	Uri,
	type CustomReadonlyEditorProvider,
	ViewColumn,
	type CancellationToken,
	type CustomDocumentOpenContext,
	type WebviewPanel,
} from 'vscode';
import type { GoTestItem } from './item';
import { execFile, spawn } from 'node:child_process';
import { correctBinname, getTempDirPath } from '../utils/util';
import { GoExtensionAPI } from '../vscode-go';
import { killProcessTree } from '../utils/processUtils';
import { Browser } from '../browser';
import { Context } from './testing';
import moment from 'moment';

export class ProfileType {
	constructor(
		public readonly id: string,
		public readonly label: string,
		public readonly description: string,
	) {}

	enabled = false;
	picked = false;
}

export function makeProfileTypeSet() {
	return <const>[
		new ProfileType('cpu', 'CPU', 'Profile CPU usage'),
		new ProfileType('mem', 'Memory', 'Profile memory usage'),
		new ProfileType('mutex', 'Mutexes', 'Profile mutex contention'),
		new ProfileType('block', 'Blocking', 'Profile blocking events'),
	];
}

export class ProfileContainer implements GoTestItem {
	readonly kind = 'profile-container';
	readonly label = 'Profiles';
	readonly parent: GoTestItem;
	readonly profiles = new Map<number, ProfileSet>();

	constructor(parent: GoTestItem) {
		this.parent = parent;
	}

	get hasChildren() {
		return this.getChildren().length > 0;
	}

	getParent() {
		return this.parent;
	}

	getChildren() {
		return [...this.profiles.values()].filter((x) => x.hasChildren);
	}

	async addProfile(dir: Uri, type: ProfileType, time: Date): Promise<CapturedProfile> {
		let set = this.profiles.get(time.getTime());
		if (!set) {
			set = new ProfileSet(this, time);
			this.profiles.set(time.getTime(), set);
		}

		const profile = await CapturedProfile.new(set, dir, type, time);
		set.profiles.add(profile);
		return profile;
	}

	removeProfile(profile: CapturedProfile): void {
		this.profiles.forEach((x) => x.profiles.delete(profile));
	}
}

export class ProfileSet implements GoTestItem {
	readonly kind = 'profile-set';
	readonly time: Date;
	readonly parent: ProfileContainer;
	readonly profiles = new Set<CapturedProfile>();

	constructor(parent: ProfileContainer, time: Date) {
		this.parent = parent;
		this.time = time;
	}

	get label() {
		const now = new Date();
		if (now.getFullYear() !== this.time.getFullYear()) {
			return moment(this.time).format('YYYY-MM-DD HH:mm:ss');
		}
		if (now.getMonth() !== this.time.getMonth() || now.getDate() !== this.time.getDate()) {
			return moment(this.time).format('MM-DD HH:mm:ss');
		}
		return moment(this.time).format('HH:mm:ss');
	}

	get hasChildren() {
		return this.profiles.size > 0;
	}

	getParent() {
		return this.parent;
	}

	getChildren() {
		return [...this.profiles];
	}
}

/**
 * Represents a captured profile.
 */
export class CapturedProfile implements GoTestItem {
	/**
	 * Returns the storage directory for the captured profile. If the test run
	 * is persisted and supports onDidDispose, it returns the extensions's
	 * storage URI. Otherwise, it returns an OS temp directory path.
	 *
	 * @param context - The context object.
	 * @param run - The test run object.
	 * @returns The storage directory URI.
	 */
	static storageDir(context: Context, run: TestRun): Uri {
		// Profiles can be deleted when the run is disposed, but there's no way
		// to re-associated profiles with a past run when VSCode is closed and
		// reopened. So we always use the temp directory for now.
		// https://github.com/microsoft/vscode/issues/227924

		// if (run.isPersisted && run.onDidDispose && context.storageUri) {
		// 	return context.storageUri;
		// }

		return Uri.file(getTempDirPath());
	}

	readonly kind = 'profile';
	readonly type: ProfileType;
	readonly uri: Uri;
	readonly file: Uri;
	readonly parent: ProfileSet;
	readonly hasChildren = false;

	static async new(parent: ProfileSet, dir: Uri, type: ProfileType, time: Date) {
		// This is a simple way to make an ID from the package URI
		const hash = createHash('sha256').update(`${parent.parent.parent.uri}`).digest('hex').substring(0, 16);
		const file = Uri.joinPath(dir, `${hash}-${type.id}-${time.getTime()}.pprof`);
		// const uri = await UriHandler.asUri('openProfile', { path: file.fsPath });
		const uri = file;
		return new this(parent, type, file, uri);
	}

	private constructor(parent: ProfileSet, type: ProfileType, file: Uri, uri: Uri) {
		this.type = type;
		this.parent = parent;
		this.file = file;
		this.uri = uri;
	}

	get key() {
		return `${this.uri}`;
	}

	get label() {
		return this.type.label;
	}

	getParent() {
		return this.parent;
	}

	getChildren() {
		return [];
	}
}

class OldDoc {
	static async open(ext: ExtensionContext, go: GoExtensionAPI, path: string): Promise<void> {
		const r = await this.#open(go, path);
		const base = Uri.parse(`http://localhost:${r.port}/ui`);
		const browser = new Browser(ext, 'pprof', base, 'Profile', {
			viewColumn: ViewColumn.Active,
			preserveFocus: true,
		});

		if (r.proc) {
			browser.panel.onDidDispose(() => killProcessTree(r.proc));
			browser.navigate(base);
		} else {
			browser.show(r.error.html || r.error.message);
		}
	}

	static async #open(go: GoExtensionAPI, path: string) {
		const foundDot = await new Promise<boolean>((resolve, reject) => {
			const proc = spawn(correctBinname('dot'), ['-V']);

			proc.on('error', (err) => {
				// eslint-disable-next-line @typescript-eslint/no-explicit-any
				if ((err as any).code === 'ENOENT') resolve(false);
				else reject(err);
			});

			proc.on('exit', (code, signal) => {
				if (signal) reject(new Error(`Received signal ${signal}`));
				else if (code) reject(new Error(`Exited with code ${code}`));
				else resolve(true);
			});
		});
		if (!foundDot) {
			return {
				error: {
					message: 'Failed to execute dot',
					html: 'The `dot` command is required to display this profile. Please install Graphviz.',
				},
			};
		}

		const { binPath: goRuntimePath } = go.settings.getExecutionCommand('go') || {};
		if (!goRuntimePath) {
			return {
				error: {
					message: 'Failed to run "go test" as the "go" binary cannot be found in either GOROOT or PATH',
				},
			};
		}

		try {
			const proc = spawn(goRuntimePath, ['tool', 'pprof', '-http=:', '-no_browser', path]);
			const port = await new Promise<string | undefined>((resolve, reject) => {
				proc.on('error', (err) => reject(err));
				proc.on('exit', (code, signal) => reject(signal || code));

				let stderr = '';
				function captureStdout(b: Buffer) {
					stderr += b.toString('utf-8');

					const m = stderr.match(/^Serving web UI on http:\/\/localhost:(?<port>\d+)\n/);
					if (!m) return;

					resolve(m.groups?.port);
					proc.stdout.off('data', captureStdout);
				}

				proc.stderr.on('data', captureStdout);
			});

			return { proc, port };
		} catch (error) {
			return {
				error: { message: `${error}` },
			};
		}
	}
}

class ProfileDocument {
	readonly uri: Uri;

	constructor(uri: Uri) {
		this.uri = uri;
	}

	dispose() {}
}

export class ProfileEditorProvider implements CustomReadonlyEditorProvider<ProfileDocument> {
	readonly #ext: ExtensionContext;
	readonly #go: GoExtensionAPI;

	constructor(ext: ExtensionContext, go: GoExtensionAPI) {
		this.#ext = ext;
		this.#go = go;
	}

	openCustomDocument(uri: Uri, context: CustomDocumentOpenContext, token: CancellationToken): ProfileDocument {
		return new ProfileDocument(uri);
	}

	async resolveCustomEditor(document: ProfileDocument, panel: WebviewPanel, token: CancellationToken): Promise<void> {
		const { binPath } = this.#go.settings.getExecutionCommand('vscgo') || {};
		if (!binPath) {
			throw new Error('Cannot locate vscgo');
		}

		const { stdout: pprof } = await promisify(execFile)(binPath, ['dump-pprof', document.uri.fsPath]);

		const uriFor = (path: string) => panel.webview.asWebviewUri(Uri.joinPath(this.#ext.extensionUri, 'dist', path));
		panel.webview.options = { enableScripts: true, enableCommandUris: true };
		panel.webview.html = `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>Profile Custom Editor</title>
					<link href="${uriFor('pprof.css')}" rel="stylesheet">
					<script id="profile-data" type="application/json">${pprof}</script>
				</head>
				<body>
					<script src="${uriFor('pprof.js')}"></script>
				</body>
			</html>
		`;
	}
}
