import vscode, { Uri } from 'vscode';

export class UriHandler implements vscode.UriHandler {
	static async asUri(command: string, args: { path?: string; query?: string }) {
		const uri = Uri.parse(`${vscode.env.uriScheme}://ethan-reesor.exp-vscode-go`);
		return await vscode.env.asExternalUri(uri.with({ ...args, fragment: command }));
	}

	async handleUri(uri: Uri): Promise<void> {
		switch (uri.fragment) {
			case 'openProfile':
				vscode.commands.executeCommand('goExp.openProfile', uri.path);
				break;
			default:
				console.log('Unknown command: ', uri);
				break;
		}
	}
}
