import { Module, RootItem, WorkspaceItem } from './item';
import { Commands, Context } from './testing';
import { WorkspaceFolder } from 'vscode';
import { TestConfig } from './config';

export class Commander {
	readonly #context: Context;
	#roots?: RootMap;

	constructor(context: Context) {
		this.#context = context;
	}

	async getRoots(reload = false) {
		if (this.#roots && !reload) {
			return this.#roots.values();
		}

		const roots = this.#roots || new RootMap();
		this.#roots = roots;

		await Promise.all(
			(this.#context.workspace.workspaceFolders || []).map(async (ws) => {
				// Ask gopls for a list of modules for each workspace folder
				const { Modules } = await this.#context.commands.modules({
					Dir: ws.uri.toString(),
					MaxDepth: -1
				});

				// Make an item for each module
				const config = new TestConfig(this.#context.workspace, ws.uri);
				let modules: RootItem[] = (Modules || []).map((x) => new Module(config, this, x));

				// If the workspace is not a module, create a WorkspaceItem for it
				if (!modules.some((x) => x.dir.toString() === ws.uri.toString())) {
					modules = [new WorkspaceItem(config, this, ws), ...modules];
				}

				roots.set(ws, modules);
			})
		);

		return roots.values();
	}

	async getRootFor(ws: WorkspaceFolder, pkg: Commands.Package, opts: { tryReload: boolean }) {
		// If the roots haven't been loaded, load them
		if (!this.#roots) {
			opts.tryReload = false;
			await this.getRoots();
		}

		if (pkg.ModulePath) {
			// Does the package belong to a module and do we have it?
			let mod = this.#roots!.getModule(pkg.ModulePath);
			if (mod) return mod;

			// If not, reload the roots and check again, but only reload once
			// per reloadPackages call
			if (opts.tryReload) {
				opts.tryReload = false;
				await this.getRoots(true);
			}

			// Check again
			mod = this.#roots!.getModule(pkg.ModulePath);
			if (mod) return mod;
		}

		const config = new TestConfig(this.#context.workspace, ws.uri);
		return this.#roots!.getWorkspace(new WorkspaceItem(config, this, ws));
	}

	getPackages(args: Commands.PackagesArgs) {
		return this.#context.commands.packages(args);
	}
}

class RootMap {
	readonly #items = new Map<string, Map<string, RootItem>>();

	*values() {
		for (const root of this.#items.values()) {
			yield* root.values();
		}
	}

	set(ws: WorkspaceFolder, items: RootItem[]) {
		const got = new Map(items.map((x) => [x.dir.toString(), x]));
		const wsKey = ws.uri.toString();
		const have = this.#items.get(wsKey);

		// If `have` is not present, set it to `got`
		if (!have) {
			this.#items.set(wsKey, got);
			return;
		}

		// Delete items that appear in `have` but not `got`
		for (const key of have.keys()) {
			if (!got.has(key)) {
				have.delete(key);
			}
		}

		// Insert items that appear in `got` but not `have`
		for (const [key, item] of got) {
			if (!have.has(key)) {
				have.set(key, item);
			}
		}
	}

	getModule(path: string) {
		for (const item of this.values()) {
			if (item instanceof Module && item.path === path) {
				return item;
			}
		}
	}

	/**
	 * Get or create an item for the root directory of a workspace.
	 */
	getWorkspace(item: WorkspaceItem) {
		const wsKey = item.uri.toString();
		const wsi = this.#items.get(wsKey);
		if (!wsi) {
			this.#items.set(wsKey, new Map([[item.dir.toString(), item]]));
			return item;
		}

		if (wsi.has(wsKey)) {
			return wsi.get(wsKey)!;
		}

		wsi.set(wsKey, item);
		return item;
	}
}
