import { Uri, WorkspaceFolder } from 'vscode';

import { Commands } from '@/utils/testing';

import { ItemSet } from './set';
import type { Module, Package } from '.';

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
}
