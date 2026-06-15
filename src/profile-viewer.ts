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
	Memento,
	ProgressLocation,
	ThemeIcon,
	QuickPickItem,
	env,
} from 'vscode';
import { GoExtensionAPI } from './vscode-go';
import { killProcessTree } from './utils/processUtils';
import { HoverEvent, Message } from '../webview/pprof/messages';
import { SemVer } from './utils/semver';
import { getTempFilePath } from './utils/util';
import axios from 'axios';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import type { CommandExecutor } from './extension';
import { Command } from './commands';

const nbsp = '\u00A0';

const vscgoCanServePprof = new SemVer(0, 43, 3);

export async function registerProfileEditor(ctx: ExtensionContext, go: GoExtensionAPI, command: CommandExecutor) {
	// Register the custom editor
	const provider = new ProfileEditorProvider(ctx, go);
	ctx.subscriptions.push(window.registerCustomEditorProvider('goExp.pprof', provider));

	// [Command] Show source
	command(Command.Profile.ShowSource, () => ProfileDocument.active?.showSource());

	// [Command] Ignore function
	command(Command.Profile.Ignore, () => ProfileDocument.active?.ignoreFunc());

	// [Command] Capture profile
	command(Command.Profile.Capture, () => captureProfile(ctx.workspaceState));
}

export class ProfileEditorProvider implements CustomEditorProvider<ProfileDocument | ErrorDocument> {
	readonly #ext: ExtensionContext;
	readonly #go: GoExtensionAPI;
	readonly decoration: TextEditorDecorationType;
	readonly emptyDecoration: TextEditorDecorationType;

	readonly didChange = new EventEmitter<CustomDocumentEditEvent<ProfileDocument | ErrorDocument>>();
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

	async saveCustomDocument(
		document: ProfileDocument | ErrorDocument,
		cancellation: CancellationToken,
	): Promise<void> {
		// Not actually editable
	}

	async saveCustomDocumentAs(
		document: ProfileDocument | ErrorDocument,
		destination: Uri,
		cancellation: CancellationToken,
	): Promise<void> {
		await workspace.fs.copy(document.uri, destination);
	}

	async revertCustomDocument(
		document: ProfileDocument | ErrorDocument,
		cancellation: CancellationToken,
	): Promise<void> {
		// TODO: Undo entire stack?
	}

	async backupCustomDocument(
		document: ProfileDocument | ErrorDocument,
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
	): Promise<ProfileDocument | ErrorDocument> {
		const { binPath } = this.#go.settings.getExecutionCommand('vscgo') || {};
		if (!binPath || !path.isAbsolute(binPath)) {
			installVSCGo(uri).catch((err) => {
				console.log('Failed to install vscgo:', err);
			});
			return new ErrorDocument(uri, 'vscgo is not installed');
		}

		// Check the version
		try {
			const { stdout: s } = await promisify(execFile)(binPath, ['version']);
			const version = s.split('\n')[0]?.split(':')[1]?.trim();
			const semver = SemVer.parse(version);
			if (!(version === '(devel)' || (semver && semver.cmp(vscgoCanServePprof) > 0))) {
				return new ErrorDocument(uri, `This feature is not available with vscode-go ${version}`);
			}
		} catch (error) {
			if (!error || typeof error !== 'object' || !('code' in error) || typeof error.code !== 'string') {
				return new ErrorDocument(uri, `An unexpected error occurred: ${error}`);
			}

			switch (error.code) {
				case 'ENOENT':
					return new ErrorDocument(uri, 'vscgo is not installed');
			}

			return new ErrorDocument(uri, `An unexpected error occurred: ${error}`);
		}

		const proc = spawn(binPath, ['serve-pprof', ':', uri.fsPath]);
		token.onCancellationRequested(() => killProcessTree(proc));

		try {
			const server = await new Promise<string>((resolve, reject) => {
				let stdout = '';
				let stderr = '';

				proc.stdout.on('data', capture);
				proc.stderr.on('data', (chunk) => (stderr += chunk.toString('utf-8')));

				function capture(b: Buffer) {
					stdout += b.toString('utf-8');
					if (!stdout.includes('\n')) return;

					try {
						const {
							Listen: { Port },
						} = JSON.parse(stdout) as {
							// IP is provided, but we're not currently using it
							// (see below).
							Listen: { IP: string; Port: string };
						};

						// We have to assume VSCode will handle port forwarding.
						// And while it can handle IPv6 listeners, it only
						// actually forwards IPv4 requests, so sending a request
						// to an IPv6 address won't work.
						resolve(`http://localhost:${Port}`);
					} catch (error) {
						killProcessTree(proc);
						reject(error);
					}
					proc.stdout.off('data', capture);
				}

				proc.on('error', (err) => reject(err));
				proc.on('exit', (code, signal) => {
					if (signal) {
						reject(`Killed by ${signal}\n\n${stderr}`);
					} else {
						reject(`Exited with code ${code}\n\n${stderr}`);
					}
				});
			});

			// If we're running in a remote extension host, we can't just use
			// `server` as is, we need to convert it to an external URI.
			const serverAsExternal = await env.asExternalUri(Uri.parse(server));
			return new ProfileDocument(this, uri, proc, serverAsExternal);
		} catch (error) {
			return new ErrorDocument(uri, `${error}`);
		}
	}

	resolveCustomEditor(document: ProfileDocument | ErrorDocument, panel: WebviewPanel, token: CancellationToken) {
		document.resolve(panel);
	}
}

let captureNum = 1;

async function installVSCGo(document: Uri) {
	const answer = await window.showWarningMessage('vscgo is required to view profiles. Install it now?', 'Install');
	if (!answer) return;

	// Ideally we'd just say "install vscgo" and vscode-go would pick up the
	// import and module path from it's own list, but it doesn't support that
	// today.
	await commands.executeCommand('go.tools.install', [
		{
			name: 'vscgo',
			importPath: 'github.com/golang/vscode-go/vscgo',
			modulePath: 'github.com/golang/vscode-go/vscgo',
		},
	]);

	// Attempt to close and reopen the editor to force it to refresh.
	//
	// TODO: I should probably merge the two document types so I can reload
	// without this nonsense.
	for (const group of window.tabGroups.all) {
		for (const tab of group.tabs) {
			if (
				tab.input &&
				typeof tab.input === 'object' &&
				'uri' in tab.input &&
				`${tab.input.uri}` === `${document}`
			) {
				await window.tabGroups.close(tab);
				await commands.executeCommand('vscode.openWith', document, 'goExp.pprof', group.viewColumn);
			}
		}
	}
}

export async function captureProfile(state: Memento) {
	const s = await window.showInputBox({
		title: 'Enter the URL to profile',
		value: state.get('last-captured-profile-url'),
		validateInput(value) {
			try {
				Uri.parse(value, true);
			} catch (error) {
				return `Invalid URL: ${error}`;
			}
		},
	});
	if (!s) return;
	await state.update('last-captured-profile-url', s);

	let url = Uri.parse(s);
	switch (url.path) {
		case '/debug/pprof':
		case '/debug/pprof/': {
			const selected = await promptForProfileType();
			if (!selected) return;

			url = url.with({ path: path.join(url.path, selected.path) });
			if (selected.duration) {
				url = url.with({ query: `seconds=${selected.duration}` });
			}
		}
	}

	const file = getTempFilePath(`capture-${captureNum}.pprof`);
	const fileStream = createWriteStream(file);
	captureNum++;

	const controller = new AbortController();
	const promise = axios
		.get(`${url}`, {
			responseType: 'stream',
			signal: controller.signal,
		})
		.then((res) => {
			return new Promise((resolve, reject) => {
				res.data.pipe(fileStream).on('finish', resolve).on('error', reject);
			});
		});

	// If it takes more than 100 ms to resolve...
	const timedOut = await Promise.race([
		promise.then(() => false),
		new Promise<boolean>((resolve) => setTimeout(() => resolve(true), 100)),
	]);

	//   then show progress.
	if (timedOut) {
		await window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: 'Capturing pprof profile...',
				cancellable: true,
			},
			(progress, cancel) => {
				cancel.onCancellationRequested(() => controller.abort());
				return promise;
			},
		);
	}

	// Open the file.
	await commands.executeCommand('vscode.open', Uri.file(file));
}

type ProfileTypeItem = QuickPickItem & { path: string; duration?: number };

const profileTypeItems = [
	{
		label: 'CPU',
		path: 'profile',
		duration: 30,
		buttons: [{ iconPath: new ThemeIcon('clock'), tooltip: 'Set duration' }],
	},
	{ label: 'Heap', path: 'heap' },
	{ label: 'Allocations', path: 'allocs' },
];

async function promptForProfileType() {
	const picker = window.createQuickPick<ProfileTypeItem>();
	picker.items = profileTypeItems;

	let resolving = false;
	const selectDuration = async (item: ProfileTypeItem, resolve: (_: ProfileTypeItem) => void) => {
		resolving = true;
		picker.hide();
		const duration = Number(
			await window.showInputBox({
				prompt: 'Duration (seconds)',
				value: String(item.duration ?? 30),
				validateInput: (v) => (isNaN(Number(v)) || Number(v) <= 0 ? 'Must be a positive number' : null),
			}),
		);
		resolving = false;
		if (isNaN(duration)) {
			picker.items = profileTypeItems;
			picker.show();
			return;
		}

		resolve({ ...item, duration });
	};

	return new Promise<ProfileTypeItem | undefined>((resolve) => {
		picker.onDidTriggerItemButton(({ item, button }) => selectDuration(item, resolve));
		picker.onDidAccept(() => {
			picker.hide();
			resolve(picker.selectedItems[0]);
		});
		picker.onDidHide(() => resolving || resolve(undefined));
		picker.show();
	});
}

class ErrorDocument {
	readonly uri;
	readonly error;
	constructor(uri: Uri, error: string) {
		this.uri = uri;
		this.error = error;
	}

	resolve(panel: WebviewPanel) {
		panel.webview.html = `
			<!DOCTYPE html>
			<html lang="en">
				<head style="height: 100vh">
					<meta charset="UTF-8">
					<meta name="viewport" content="width=device-width, initial-scale=1.0">
					<title>Profile Custom Editor</title>
				</head>
				<body style="height: 100vh; display: flex; justify-content: center; align-items: center">
					${this.error}
				</body>
			</html>
		`;
	}

	dispose() {}
}

class ProfileDocument {
	static #active?: ProfileDocument;
	static get active() {
		return this.#active;
	}

	readonly #provider;
	readonly uri;
	readonly #proc;
	readonly #server;
	readonly #subscriptions: Disposable[] = [];

	#hovered: HoverEvent = { event: 'hovered' };
	#panel?: WebviewPanel;

	constructor(provider: ProfileEditorProvider, uri: Uri, proc: ChildProcess, server: Uri) {
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

		const query = new URLSearchParams(this.uri.query);
		if (query.has('title')) {
			panel.title = query.get('title')!;
		}
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
