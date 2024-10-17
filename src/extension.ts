/* eslint-disable @typescript-eslint/no-explicit-any */
import vscode from 'vscode';
import { cleanupTempDir } from './utils/util';
import { GoExtensionAPI } from './vscode-go';
import { registerTestingFeatures } from './test/register';
import { Browser } from './browser';

const output = vscode.window.createOutputChannel('Go Companion', { log: true });

export async function activate(ctx: vscode.ExtensionContext) {
	const command = (name: string, fn: (...args: any[]) => any) => {
		ctx.subscriptions.push(
			vscode.commands.registerCommand(name, async (...args) => {
				try {
					await fn(...args);
				} catch (error) {
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
	await registerTestingFeatures(ctx, go);

	// [Command] Render documentation
	command('goExp.renderDocs', () => Browser.renderDocs(ctx));
}

export function deactivate() {
	return Promise.all([Promise.resolve(cleanupTempDir())]);
}
