/* eslint-disable @typescript-eslint/no-unused-vars */
import { createHash } from 'node:crypto';
import {
	CancellationToken,
	CustomDocument,
	CustomDocumentOpenContext,
	CustomReadonlyEditorProvider,
	ExtensionContext,
	Uri,
	WebviewPanel
} from 'vscode';
import vscode from 'vscode';
import { GoTestItem } from './item';
import { BaseItem } from './itemBase';
import { ChildProcess, spawn } from 'node:child_process';
import { correctBinname } from '../utils/util';
import { GoExtensionAPI } from '../vscode-go';
import { killProcessTree } from '../utils/processUtils';
import { Browser } from '../browser';

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

	addProfile(dir: Uri, type: ProfileType, time: Date) {
		const profile = new CapturedProfile(this, dir, type, time);
		this.profiles.add(profile);
		return profile;
	}

	removeProfile(profile: CapturedProfile) {
		this.profiles.delete(profile);
	}
}

export class CapturedProfile extends BaseItem implements GoTestItem {
	readonly kind = 'profile';
	readonly type: ProfileType;
	readonly uri: Uri;
	readonly parent: ItemWithProfiles;
	readonly hasChildren = false;

	constructor(parent: ItemWithProfiles, dir: Uri, type: ProfileType, time: Date) {
		super();

		// This is a simple way to make an ID from the package URI
		const hash = createHash('sha256').update(`${parent.uri}`).digest('hex').substring(0, 16);

		this.type = type;
		this.uri = Uri.joinPath(dir, `${hash}-${type.id}-${time.getTime()}.pprof`);
		this.parent = parent;
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

interface Failure {
	message: string;
	html?: string;
}

class ProfileDocument implements CustomDocument {
	readonly uri: Uri;
	readonly error?: Failure;
	readonly proc?: ChildProcess;
	readonly port?: string;

	constructor(args: { uri: Uri; error?: Failure; proc?: ChildProcess; port?: string }) {
		this.uri = args.uri;
		this.error = args.error;
		this.proc = args.proc;
		this.port = args.port;
	}

	dispose(): void {
		this.proc && killProcessTree(this.proc);
	}
}

export class ProfileDocumentProvider implements CustomReadonlyEditorProvider<ProfileDocument> {
	readonly #ext: ExtensionContext;
	readonly #go: GoExtensionAPI;

	constructor(ext: ExtensionContext, go: GoExtensionAPI) {
		this.#ext = ext;
		this.#go = go;
	}

	async openCustomDocument(
		uri: Uri,
		openContext: CustomDocumentOpenContext,
		token: CancellationToken
	): Promise<ProfileDocument> {
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
			return new ProfileDocument({
				uri,
				error: {
					message: 'Failed to execute dot',
					html: 'The `dot` command is required to display this profile. Please install Graphviz.'
				}
			});
		}

		const { binPath: goRuntimePath } = this.#go.settings.getExecutionCommand('go') || {};
		if (!goRuntimePath) {
			return new ProfileDocument({
				uri,
				error: {
					message: 'Failed to run "go test" as the "go" binary cannot be found in either GOROOT or PATH'
				}
			});
		}

		try {
			const proc = spawn(goRuntimePath, ['tool', 'pprof', '-http=:', '-no_browser', uri.fsPath]);
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

			return new ProfileDocument({ uri, proc, port });
		} catch (error) {
			return new ProfileDocument({
				uri,
				error: { message: `${error}` }
			});
		}
	}

	async resolveCustomEditor(document: ProfileDocument, panel: WebviewPanel): Promise<void> {
		const browser = new Browser(this.#ext, panel, Uri.parse(`http://localhost:${document.port}/ui`));
		browser.navigate('./');
	}
}
