import { Module, RootItem, WorkspaceItem } from './item';
import { Commands, Context } from './testing';
import { WorkspaceFolder } from 'vscode';
import { TestConfig } from './config';
import { Uri } from 'vscode';

/**
 * Handles interaction with gopls commands.
 */
export class Commander {
	readonly #context: Context;
	#roots?: AllRoots;

	constructor(context: Context) {
		this.#context = context;
	}

	/**
	 * Retrieves the roots of all workspaces.
	 *
	 * @param reload - Whether to reload the roots if they are already loaded.
	 * @returns A collection of workspace roots.
	 */
	async getRoots(reload = false) {
		// Return the already loaded roots if they exist, unless reload == true
		if (this.#roots && !reload) {
			return this.#roots.values();
		}

		let roots: AllRoots;
		if (this.#roots) {
			roots = this.#roots;
		} else {
			roots = new AllRoots();
			this.#roots = roots;
		}

		if (this.#context.workspace.workspaceFolders) {
			await Promise.all(
				this.#context.workspace.workspaceFolders.map(async (ws) =>
					roots.set(ws, await this.#getWorkspaceRoots(ws))
				)
			);
		}

		return roots.values();
	}

	/**
	 * Retrieves the workspace roots for a given workspace folder.
	 *
	 * @param ws - The workspace folder to retrieve the roots for.
	 * @returns An array of `RootItem` objects representing the workspace roots.
	 */
	async #getWorkspaceRoots(ws: WorkspaceFolder) {
		const config = new TestConfig(this.#context.workspace, ws.uri);
		const roots: RootItem[] = [];

		// Ask gopls
		const { Modules } = await this.#context.commands.modules({
			Dir: ws.uri.toString(),
			MaxDepth: -1
		});

		// Create an item for the workspace unless it's the root of a module
		if (!Modules?.some((x) => Uri.joinPath(Uri.parse(x.GoMod), '..').toString() === ws.uri.toString())) {
			roots.push(new WorkspaceItem(config, this, ws));
		}

		// Make an item for each module
		if (Modules) {
			roots.push(...Modules.map((x) => new Module(config, this, x)));
		}

		return roots;
	}

	/**
	 * Retrieves the root a given package belongs to.
	 *
	 * @param pkg - The package for which to retrieve the root.
	 * @param opts - Options for retrieving the root.
	 * @param opts.tryReload - Specifies whether to try reloading the roots.
	 * @returns The root for the package or undefined if the package does not belong to any workspace.
	 * @throws Error if the package contains no test files.
	 */
	async getRootFor(pkg: Commands.Package, opts: { tryReload: boolean }) {
		if (!pkg.TestFiles?.length) {
			throw new Error('package contains no test files');
		}

		const ws = this.#context.workspace.getWorkspaceFolder(Uri.parse(pkg.TestFiles[0].URI));
		if (!ws) {
			return;
		}

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

class AllRoots {
	readonly #items = new Map<string, WorkspaceRoots>();

	*values() {
		for (const root of this.#items.values()) {
			yield* root.values();
		}
	}

	/**
	 * Sets the roots for a workspace. If the workspace roots have already been
	 * set, the new roots are merged with the existing ones. Old roots that are
	 * not present in the new set are removed.
	 *
	 * @param ws - The workspace folder.
	 * @param items - The roots.
	 */
	set(ws: WorkspaceFolder, items: RootItem[]) {
		// Fast path (no roots yet)
		const wsKey = ws.uri.toString();
		const roots = this.#items.get(wsKey);
		if (!roots) {
			this.#items.set(wsKey, new WorkspaceRoots(items));
			return;
		}

		// Delete roots that are no longer present
		const newKeys = new Set(items.map((x) => x.dir.toString()));
		for (const key of roots.keys()) {
			if (!newKeys.has(key)) {
				roots.remove(key);
			}
		}

		// Insert new items
		roots.add(...items);
	}

	/**
	 * Retrieves a module with the specified path.
	 *
	 * @param path - The path of the module to retrieve.
	 * @returns The module with the specified path, or `undefined` if not found.
	 */
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
		const roots = this.#items.get(wsKey);
		if (!roots) {
			this.#items.set(wsKey, new WorkspaceRoots([item]));
			return item;
		}

		if (roots.has(item)) {
			return roots.get(item)!;
		}

		roots.add(item);
		return item;
	}
}

class WorkspaceRoots {
	readonly #items: Map<string, RootItem>;

	constructor(items: RootItem[]) {
		this.#items = new Map(items.map((x) => [x.dir.toString(), x]));
	}

	*keys() {
		yield* this.#items.keys();
	}

	*values() {
		yield* this.#items.values();
	}

	has(item: string | RootItem) {
		return this.#items.has(typeof item === 'string' ? item : item.dir.toString());
	}

	add(...items: RootItem[]) {
		for (const item of items) {
			if (this.has(item)) continue;
			this.#items.set(item.dir.toString(), item);
		}
	}

	remove(item: string | RootItem) {
		this.#items.delete(typeof item === 'string' ? item : item.dir.toString());
	}

	get(item: string | RootItem) {
		return this.#items.get(typeof item === 'string' ? item : item.dir.toString());
	}
}
