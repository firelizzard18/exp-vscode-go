import { Uri } from 'vscode';

import { type Commands } from '@/utils/common';

import type { Package, Workspace } from '.';
import { ItemSet } from './set';

export class Module {
	readonly kind = 'module';
	readonly uri;
	readonly path;
	readonly workspace;
	readonly packages = new ItemSet<Package>();

	constructor(workspace: Workspace, mod: Commands.Module) {
		this.workspace = workspace;
		this.uri = Uri.parse(mod.GoMod);
		this.path = mod.Path;
	}

	get dir(): Uri {
		return Uri.joinPath(this.uri, '..');
	}

	static keyOf(x: Commands.Module) {
		return x.Path;
	}

	get key() {
		return this.path;
	}
}
