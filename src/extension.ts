import * as vscode from 'vscode';
import { registerTestController } from './test/register';
import { cleanupTempDir } from './utils/util';

export async function activate(ctx: vscode.ExtensionContext) {
	await registerTestController(ctx);
}

export function deactivate() {
	return Promise.all([
		// cancelRunningTests(),
		// killRunningPprof(),
		Promise.resolve(cleanupTempDir())
	]);
}
