import { Commands } from '@/utils/testing';
import { Uri } from 'vscode';
import type { Package, Workspace } from '.';
import { ItemSet } from './set';

export class Module {
	readonly kind = 'module';
	readonly uri;
	readonly path;
	readonly workspace;
	readonly packages = new ItemSet<Package, Commands.Package>((x) => x.Path);

	constructor(workspace: Workspace, mod: Commands.Module) {
		this.workspace = workspace;
		this.uri = Uri.parse(mod.GoMod);
		this.path = mod.Path;
	}

	get dir(): Uri {
		return Uri.joinPath(this.uri, '..');
	}

	get key() {
		return this.path;
	}
}
