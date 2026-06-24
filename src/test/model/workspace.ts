import { type Uri, type WorkspaceFolder } from 'vscode';

import { type Commands } from '@/utils/common';

import type { Module, Package } from '.';
import { ItemSet } from './set';

export class Workspace {
	readonly kind = 'workspace';
	readonly ws;
	readonly modules = new ItemSet<Module, Commands.Module>((x) => x.Path);
	readonly packages = new ItemSet<Package, Commands.Package>((x) => x.Path);

	constructor(ws: WorkspaceFolder) {
		this.ws = ws;
	}

	get uri() {
		return this.ws.uri;
	}

	get dir(): Uri {
		return this.ws.uri;
	}

	get key() {
		return `${this.uri}`;
	}

	*allPackages() {
		yield* this.packages;
		for (const mod of this.modules) {
			yield* mod.packages;
		}
	}
}
