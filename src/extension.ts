/* eslint-disable @typescript-eslint/no-explicit-any */
import vscode from 'vscode';
import { CanceledError } from 'axios';

import { cleanupTempDir } from './utils/util';
import { type GoExtensionAPI } from './vscode-go';
import { registerTestingFeatures } from './test/register';
import { Browser } from './browser';
import { GoGenerateManager } from './go-generate/manager';
import { registerProfileEditor } from './profile-viewer';
import { Command } from './commands';

const output = vscode.window.createOutputChannel('Go Companion', { log: true });

export type CommandExecutor = (name: string, fn: (...args: any[]) => any) => void;

export async function activate(ctx: vscode.ExtensionContext) {
	const command: CommandExecutor = (name, fn) => {
		ctx.subscriptions.push(
			vscode.commands.registerCommand(name, async (...args) => {
				try {
					await fn(...args);
				} catch (error) {
					if (error instanceof CanceledError) {
						return;
					}
					output.error(error as Error);
					console.error(error);
				}
			}),
		);
	};

	// The Go extension _must_ be activated first since we depend on gopls
	const goExt = vscode.extensions.getExtension<GoExtensionAPI>('golang.go');
	if (!goExt) {
		throw new Error('Cannot activate without the Go extension');
	}

	const go = await goExt.activate();
	await registerTestingFeatures(ctx, go, output);
	await registerProfileEditor(ctx, go, command);
	await GoGenerateManager.register(ctx, go, output);

	// [Command] Render documentation
	command(Command.RenderDocs, () => Browser.renderDocs(ctx));
}

export function deactivate() {
	return Promise.all([Promise.resolve(cleanupTempDir())]);
}
