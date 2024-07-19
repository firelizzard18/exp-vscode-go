import * as vscode from 'vscode';
import { GoTestController } from './test/GoTestController';

export async function activate(ctx: vscode.ExtensionContext) {
	// The Go extension _must_ be activated first since this extension depends
	// on gopls
	const goExt = vscode.extensions.getExtension('golang.go');
	if (!goExt) {
		throw new Error('Cannot activate without the Go extension');
	}
	await goExt.activate();

	GoTestController.register(ctx);
}

export function deactivate() {}
