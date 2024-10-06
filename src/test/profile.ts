/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { ChildProcess, execFile, spawn } from 'node:child_process';
import {
	Uri,
	window,
	type ExtensionContext,
	type CancellationToken,
	type CustomDocumentOpenContext,
	type WebviewPanel,
	commands,
	Disposable,
	workspace,
	Range,
	TextEditorDecorationType,
	CustomEditorProvider,
	CustomDocumentBackup,
	CustomDocumentBackupContext,
	CustomDocumentEditEvent,
	EventEmitter,
} from 'vscode';
import type { GoTestItem } from './item';
import { GoExtensionAPI } from '../vscode-go';
import { killProcessTree } from '../utils/processUtils';
import { Context, doSafe } from './testing';
import moment from 'moment';
import { HoverEvent, Message } from '../../webview/pprof/messages';

export async function registerProfileEditor(ctx: ExtensionContext, testCtx: Context) {
	const command = (name: string, fn: (...args: any[]) => any) => {
		ctx.subscriptions.push(
			commands.registerCommand(name, (...args) => doSafe(testCtx, `executing ${name}`, () => fn(...args))),
		);
	};

	// Register the custom editor
	const provider = new ProfileEditorProvider(ctx, testCtx.go);
	ctx.subscriptions.push(window.registerCustomEditorProvider('goExp.pprof', provider));

	// [Command] Show source
	command('goExp.pprof.showSource', () => ProfileDocument.active?.showSource());

	// [Command] Ignore function
	command('goExp.pprof.ignore', () => ProfileDocument.active?.ignoreFunc());
}

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

		const profile = await CapturedProfile.new(set, dir, type);
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
	readonly kind = 'profile';
	readonly type: ProfileType;
	readonly uri: Uri;
	readonly parent: ProfileSet;
	readonly hasChildren = false;

	static async new(parent: ProfileSet, dir: Uri, type: ProfileType) {
		const file = Uri.joinPath(dir, `${type.id}.pprof`);
		return new this(parent, type, file);
	}

	private constructor(parent: ProfileSet, type: ProfileType, uri: Uri) {
		this.type = type;
		this.parent = parent;
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

const nbsp = '\u00A0';

class ProfileDocument {
	static #active?: ProfileDocument;
	static get active() {
		return this.#active;
	}

	readonly #provider: ProfileEditorProvider;
	readonly uri: Uri;
	readonly #server: string;
	readonly #proc: ChildProcess;
	readonly #subscriptions: Disposable[] = [];

	#hovered: HoverEvent = { event: 'hovered' };
	#panel?: WebviewPanel;

	constructor(provider: ProfileEditorProvider, uri: Uri, proc: ChildProcess, server: string) {
		this.#provider = provider;
		this.uri = uri;
		this.#proc = proc;
		this.#server = server;
	}

	dispose() {
		killProcessTree(this.#proc);
		this.#subscriptions.forEach((x) => x.dispose());
	}

	resolve(panel: WebviewPanel) {
		ProfileDocument.#active = this;
		this.#panel = panel;
		panel.onDidChangeViewState(
			(e) => {
				if (e.webviewPanel.active) {
					ProfileDocument.#active = this;
				} else if (ProfileDocument.#active === this) {
					ProfileDocument.#active = undefined;
				}
			},
			null,
			this.#subscriptions,
		);

		panel.webview.options = { enableScripts: true, enableCommandUris: true };
		panel.webview.onDidReceiveMessage(
			(x) => {
				if (!x || typeof x !== 'object') return;
				if (!('event' in x || 'command' in x)) return;
				this.#didReceiveMessage(x);
			},
			null,
			this.#subscriptions,
		);
		panel.webview.html = `
			<!DOCTYPE html>
			<html lang="en">
				<head>
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>Profile Custom Editor</title>
					<link href="${this.#provider.uriFor(panel, 'pprof.css')}" rel="stylesheet">
					<script id="profile-data" type="application/json" src="${this.#server}"></script>
				</head>
				<body>
					<script src="${this.#provider.uriFor(panel, 'pprof.js')}"></script>
				</body>
			</html>
		`;
	}

	async #postMessage(message: Message) {
		const ok = await this.#panel?.webview.postMessage(message);
		if (!ok) console.error('Failed to post message');
	}

	#didReceiveMessage(message: Message) {
		if (!('event' in message)) return;

		switch (message.event) {
			case 'hovered':
				this.#hovered = message;
				break;

			case 'action': {
				const { action, label } = message;
				this.#provider.didChange.fire({
					document: this,
					label,
					undo: () => this.#postMessage({ command: 'undo', action }),
					redo: () => this.#postMessage({ command: 'redo', action }),
				});
				break;
			}
		}
	}

	async showSource() {
		const { func, lines } = this.#hovered;
		if (!func) return;

		const range = new Range(func.line - 1, 0, func.line - 1, 0);
		const doc = await workspace.openTextDocument(func.file);
		const editor = await window.showTextDocument(doc, {
			preview: true,
			selection: range,
		});

		if (!lines) return;

		const valueWidth = Math.max(...lines.map(({ value }) => value.length));
		const unitWidth = Math.max(...lines.map(({ unit }) => unit.length));
		const ratioWidth = Math.max(...lines.map(({ ratio }) => ratio.length + 3));
		const fullWidth = valueWidth + 1 + unitWidth + 1 + ratioWidth + 1;

		editor.setDecorations(
			this.#provider.decoration,
			lines.map(({ line, value, unit, ratio }) => {
				const valueStr = value.padStart(valueWidth, nbsp);
				const unitStr = unit.padStart(unitWidth + 1, nbsp);
				const ratioStr = `(${ratio}%)`.padStart(ratioWidth + 1, nbsp);
				return {
					range: new Range(line, 0, line, 0),
					renderOptions: {
						before: {
							contentText: `${valueStr}${unitStr}${ratioStr}`,
							width: `${fullWidth}ch`,
							color: 'rgba(153, 153, 153, 0.65)',
						},
					},
				};
			}),
		);

		// Add empty decorations so everything is aligned
		let lastLine = 0;
		const empty: number[] = [];
		for (const { line } of lines) {
			for (; lastLine < line; lastLine++) {
				empty.push(lastLine);
			}
			lastLine = line + 1;
		}
		for (; lastLine < doc.lineCount; lastLine++) {
			empty.push(lastLine);
		}
		editor.setDecorations(
			this.#provider.emptyDecoration,
			empty.map((line) => ({
				range: new Range(line, 0, line, 0),
				renderOptions: { before: { contentText: '', width: `${fullWidth}ch` } },
			})),
		);
	}

	async ignoreFunc() {
		const { func } = this.#hovered;
		if (!func) return;

		await this.#postMessage({ command: 'ignore-func', func });
	}
}

export class ProfileEditorProvider implements CustomEditorProvider<ProfileDocument> {
	readonly #ext: ExtensionContext;
	readonly #go: GoExtensionAPI;
	readonly decoration: TextEditorDecorationType;
	readonly emptyDecoration: TextEditorDecorationType;

	readonly didChange = new EventEmitter<CustomDocumentEditEvent<ProfileDocument>>();
	readonly onDidChangeCustomDocument = this.didChange.event;

	constructor(ext: ExtensionContext, go: GoExtensionAPI) {
		this.#ext = ext;
		this.#go = go;
		this.decoration = window.createTextEditorDecorationType({
			backgroundColor: 'rgba(255, 255, 255, 0.1)',
			isWholeLine: true,
		});
		this.emptyDecoration = window.createTextEditorDecorationType({});
		ext.subscriptions.push(this.decoration);
	}

	async saveCustomDocument(document: ProfileDocument, cancellation: CancellationToken): Promise<void> {
		// Not actually editable
	}

	async saveCustomDocumentAs(
		document: ProfileDocument,
		destination: Uri,
		cancellation: CancellationToken,
	): Promise<void> {
		await workspace.fs.copy(document.uri, destination);
	}

	async revertCustomDocument(document: ProfileDocument, cancellation: CancellationToken): Promise<void> {
		// TODO: Undo entire stack?
	}

	async backupCustomDocument(
		document: ProfileDocument,
		context: CustomDocumentBackupContext,
		cancellation: CancellationToken,
	): Promise<CustomDocumentBackup> {
		// Nothing to do
		return {
			id: `${document.uri}`,
			delete() {},
		};
	}

	uriFor(panel: WebviewPanel, path: string) {
		return panel.webview.asWebviewUri(Uri.joinPath(this.#ext.extensionUri, 'dist', path));
	}

	async openCustomDocument(
		uri: Uri,
		context: CustomDocumentOpenContext,
		token: CancellationToken,
	): Promise<ProfileDocument> {
		const { binPath } = this.#go.settings.getExecutionCommand('vscgo') || {};
		if (!binPath) {
			throw new Error('Cannot locate vscgo');
		}

		// Check the version
		const { stdout: s } = await promisify(execFile)(binPath, ['version']);
		const version = s.split('\n')[0]?.split(':')[1]?.trim();
		if (version !== '(devel)') {
			throw new Error(`This feature is not available with vscgo ${version}`);
		}

		const proc = spawn(binPath, ['serve-pprof', ':', uri.fsPath]);
		token.onCancellationRequested(() => killProcessTree(proc));

		const server = await new Promise<string>((resolve, reject) => {
			proc.on('error', (err) => reject(err));
			proc.on('exit', (code, signal) => reject(signal || code));

			let stdout = '';
			function capture(b: Buffer) {
				stdout += b.toString('utf-8');
				if (!stdout.includes('\n')) return;

				try {
					const {
						Listen: { IP, Port },
					} = JSON.parse(stdout);
					resolve(`http://${IP.includes(':') ? `[${IP}]` : IP}:${Port}`);
				} catch (error) {
					killProcessTree(proc);
					reject(error);
				}
				proc.stdout.off('data', capture);
			}

			proc.stdout.on('data', capture);
		});

		return new ProfileDocument(this, uri, proc, server);
	}

	resolveCustomEditor(document: ProfileDocument, panel: WebviewPanel, token: CancellationToken) {
		document.resolve(panel);
	}
}
