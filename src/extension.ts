import * as vscode from 'vscode';
import { GoTestController } from './test/GoTestController';

export function activate(ctx: vscode.ExtensionContext) {
	GoTestController.register(ctx);
}

export function deactivate() {}
