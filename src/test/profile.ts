/* eslint-disable @typescript-eslint/no-unused-vars */
import { createHash } from 'node:crypto';
import {
	CancellationToken,
	CustomDocument,
	CustomDocumentOpenContext,
	CustomReadonlyEditorProvider,
	ExtensionContext,
	TestRun,
	Uri,
	WebviewPanel
} from 'vscode';
import vscode from 'vscode';
import { GoTestItem } from './item';
import { BaseItem } from './itemBase';
import { ChildProcess, spawn } from 'node:child_process';
import { correctBinname, getTempDirPath } from '../utils/util';
import { GoExtensionAPI } from '../vscode-go';
import { killProcessTree } from '../utils/processUtils';
import { Browser } from '../browser';
import { Context } from './testing';
import { UriHandler } from '../urlHandler';

export class ProfileType {
	constructor(
		public readonly id: string,
		public readonly flag: string,
		public readonly label: string,
		public readonly description: string
	) {}

	enabled = false;
	picked = false;
}

export function makeProfileTypeSet() {
	return <const>[
		new ProfileType('cpu', '--cpuprofile', 'CPU', 'Profile CPU usage'),
		new ProfileType('mem', '--memprofile', 'Memory', 'Profile memory usage'),
		new ProfileType('mutex', '--mutexprofile', 'Mutexes', 'Profile mutex contention'),
		new ProfileType('block', '--blockprofile', 'Blocking', 'Profile blocking events')
	];
}

export abstract class ItemWithProfiles extends BaseItem {
	readonly profiles = new Set<CapturedProfile>();

	async addProfile(dir: Uri, type: ProfileType, time: Date) {
		const profile = await CapturedProfile.new(this, dir, type, time);
		this.profiles.add(profile);
		return profile;
	}

	removeProfile(profile: CapturedProfile) {
		this.profiles.delete(profile);
	}
}

/**
 * Represents a captured profile.
 */
export class CapturedProfile extends BaseItem implements GoTestItem {
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
	readonly parent: ItemWithProfiles;
	readonly hasChildren = false;

	static async new(parent: ItemWithProfiles, dir: Uri, type: ProfileType, time: Date) {
		// This is a simple way to make an ID from the package URI
		const hash = createHash('sha256').update(`${parent.uri}`).digest('hex').substring(0, 16);
		const file = Uri.joinPath(dir, `${hash}-${type.id}-${time.getTime()}.pprof`);
		const uri = await UriHandler.asUri('openProfile', { path: file.fsPath });
		return new this(parent, type, file, uri);
	}

	private constructor(parent: ItemWithProfiles, type: ProfileType, file: Uri, uri: Uri) {
		super();
		this.type = type;
		this.parent = parent;
		this.file = file;
		this.uri = uri;
	}

	get key() {
		return `${this.uri}`;
	}

	get label() {
		return `Profile (${this.type.id})`;
	}

	getParent() {
		return this.parent;
	}

	getChildren() {
		return [];
	}
}

export class ProfileDocument {
	static async open(ext: ExtensionContext, go: GoExtensionAPI, path: string): Promise<void> {
		const r = await this.#open(go, path);
		const base = Uri.parse(`http://localhost:${r.port}/ui`);
		const browser = new Browser(ext, 'pprof', base, 'Profile', {
			viewColumn: vscode.ViewColumn.Active,
			preserveFocus: true
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
					html: 'The `dot` command is required to display this profile. Please install Graphviz.'
				}
			};
		}

		const { binPath: goRuntimePath } = go.settings.getExecutionCommand('go') || {};
		if (!goRuntimePath) {
			return {
				error: {
					message: 'Failed to run "go test" as the "go" binary cannot be found in either GOROOT or PATH'
				}
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
				error: { message: `${error}` }
			};
		}
	}
}
