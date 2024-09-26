import { Message } from './messages';

const vscode = acquireVsCodeApi<State>();

interface State {
	profile?: Profile;
}

export function postMessage(message: Message) {
	vscode.postMessage(message);
}
