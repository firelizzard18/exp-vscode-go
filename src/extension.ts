import vscode from 'vscode';
import { registerTestController } from './test/register';
import { cleanupTempDir } from './utils/util';
import { GoExtensionAPI } from './vscode-go';
import { UriHandler } from './urlHandler';

export async function activate(ctx: vscode.ExtensionContext) {
	// The Go extension _must_ be activated first since we depend on gopls
	const goExt = vscode.extensions.getExtension<GoExtensionAPI>('golang.go');
	if (!goExt) {
		throw new Error('Cannot activate without the Go extension');
	}

	const go = await goExt.activate();
	await registerTestController(ctx, go);

	ctx.subscriptions.push(vscode.window.registerUriHandler(new UriHandler()));
}

export function deactivate() {
	return Promise.all([
		// cancelRunningTests(),
		// killRunningPprof(),
		Promise.resolve(cleanupTempDir())
	]);
}
