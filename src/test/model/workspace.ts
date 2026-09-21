import { type Uri, type WorkspaceFolder } from 'vscode';

import type { Module, Package } from '.';
import { ItemSet } from './set';

export class Workspace {
	readonly kind = 'workspace';
	readonly ws;
	readonly modules = new ItemSet<Module>();
	readonly packages = new ItemSet<Package>();

	constructor(ws: WorkspaceFolder) {
		this.ws = ws;
	}

	get uri() {
		return this.ws.uri;
	}

	get dir(): Uri {
		return this.ws.uri;
	}

	static keyOf(x: WorkspaceFolder) {
		return `${x.uri}`;
	}

	get key() {
		return Workspace.keyOf(this.ws);
	}

	*allPackages() {
		yield* this.packages;
		for (const mod of this.modules) {
			yield* mod.packages;
		}
	}
}
