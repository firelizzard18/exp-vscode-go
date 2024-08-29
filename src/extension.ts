import * as vscode from 'vscode';
import { registerTestController } from './test/register';

export async function activate(ctx: vscode.ExtensionContext) {
	await registerTestController(ctx);
}

export function deactivate() {}
