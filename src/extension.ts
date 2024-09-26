import vscode from 'vscode';
import { cleanupTempDir } from './utils/util';
import { GoExtensionAPI } from './vscode-go';
import { registerTestingFeatures } from './test/register';

export async function activate(ctx: vscode.ExtensionContext) {
	// The Go extension _must_ be activated first since we depend on gopls
	const goExt = vscode.extensions.getExtension<GoExtensionAPI>('golang.go');
	if (!goExt) {
		throw new Error('Cannot activate without the Go extension');
	}

	const go = await goExt.activate();
	await registerTestingFeatures(ctx, go);
}

export function deactivate() {
	return Promise.all([
		// cancelRunningTests(),
		// killRunningPprof(),
		Promise.resolve(cleanupTempDir()),
	]);
}
