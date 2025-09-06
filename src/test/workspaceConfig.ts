import { ConfigurationChangeEvent, ConfigurationScope, Uri } from 'vscode';
import { VSCodeWorkspace } from '../utils/testing';
import { Minimatch } from 'minimatch';
import { Flags } from './utils';
import { resolvePath, substituteEnv } from '../utils/util';
import { GoTestItem, Workspace } from './model';

const dispose = new FinalizationRegistry<() => void>((fn) => fn());

export class WorkspaceConfig {
	readonly #vsc;
	readonly #workspaces = new WeakMap<Workspace, ConfigSet>();

	constructor(workspace: VSCodeWorkspace) {
		this.#vsc = workspace;
	}

	/** Returns a {@link TestConfig} for the workspace of the given item. */
	for(item: GoTestItem) {
		for (;;) {
			switch (item.kind) {
				case 'workspace':
					break;

				case 'module':
					item = item.workspace;
					continue;
				case 'package':
					item = item.parent;
					continue;
				case 'file':
					item = item.package;
					continue;
				case 'profile-container':
				case 'profile-set':
				case 'profile':
					item = item.parent;
					continue;
				default:
					item = item.file;
					continue;
			}

			// Cache config objects.
			const existing = this.#workspaces.get(item);
			if (existing) return existing;

			const config = new ConfigSet(this.#vsc, item.ws);
			this.#workspaces.set(item, config);
			return config;
		}
	}
}

class ConfigSet {
	readonly #workspace;
	readonly #scope;
	readonly #items: Item<unknown>[] = [];

	constructor(workspace: VSCodeWorkspace, scope?: ConfigurationScope) {
		this.#workspace = workspace;
		this.#scope = scope;

		// Subscribe to config changes, and unsubscribe when the Workspace is
		// collected.
		const sub = workspace.onDidChangeConfiguration((e) => this.invalidate(e));
		dispose.register(this, () => sub.dispose());
	}

	/** Invalidates cached configuration values. */
	invalidate(e: ConfigurationChangeEvent) {
		for (const item of this.#items) {
			if (item.isAffected(e)) {
				item.invalidate();
			}
		}
	}

	#config<T>(section: string, name: string) {
		const item = new ConfigItem<T>(this.#workspace, this.#scope, section, name);
		this.#items.push(item);
		return item;
	}

	#calc<In extends any[], Out>(fn: (...args: In) => Out, ...items: ItemsFor<In>) {
		const item = new CalculatedItem<In, Out>(fn, ...items);
		this.#items.push(item);
		return item;
	}

	readonly enable = this.#config<boolean | 'auto'>('exp-vscode-go', 'testExplorer.enable');
	readonly discovery = this.#config<'on' | 'off'>('exp-vscode-go', 'testExplorer.discovery');
	readonly update = this.#config<'on-save' | 'on-edit' | 'off'>('exp-vscode-go', 'testExplorer.update');
	readonly showFiles = this.#config<boolean>('exp-vscode-go', 'testExplorer.showFiles');
	readonly nestPackages = this.#config<boolean>('exp-vscode-go', 'testExplorer.nestPackages');
	readonly nestSubtests = this.#config<boolean>('exp-vscode-go', 'testExplorer.nestSubtests');
	readonly codeLens = this.#config<true | false | 'run' | 'debug'>('exp-vscode-go', 'testExplorer.codeLens');
	readonly runPackageBenchmarks = this.#config<boolean>('exp-vscode-go', 'testExplorer.runPackageBenchmarks');
	readonly dynamicSubtestLimit = this.#config<number>('exp-vscode-go', 'testExplorer.dynamicSubtestLimit');

	/** `go.toolsEnvVars` with `${...}` expressions resolved. */
	readonly toolsEnvVars = () =>
		this.#calc((x) => this.#resolve(x), this.#config<Record<string, string>>('go', 'toolsEnvVars'));

	/** `go.testEnvVars` and `go.toolsEnvVars` (merged) with `${...}`
	 *  expressions resolved. */
	readonly testEnvVars = () =>
		this.#calc(
			(test, tools) => this.#resolve(test, tools),
			this.#config<Record<string, string>>('go', 'testEnvVars'),
			this.#config<Record<string, string>>('go', 'toolsEnvVars'),
		);

	/** An array of compiled minimatch patterns from
	 *  `exp-vscode-go.testExplorer.exclude` and `files.exclude`. */
	readonly exclude = this.#calc(
		(a, b) => {
			const v = Object.assign({}, b, a);
			return Object.entries(v)
				.filter(([, v]) => v)
				.map(([k]) => k)
				.map((x) => new Minimatch(x));
		},
		this.#config<Record<string, boolean>>('exp-vscode-go', 'testExplorer.exclude'),
		this.#config<Record<string, boolean>>('files', 'exclude'),
	);

	/** `go.testFlags` or `go.buildFlags`, converted to {@link Flags}. */
	readonly testFlags = this.#calc(
		(testFlags, buildFlags, testTags, buildTags) => {
			// Get go.testFlags or go.buildFlags.
			const flagArgs = testFlags ?? buildFlags ?? [];

			// Determine the workspace folder from the scope.
			const wsf =
				this.#scope instanceof Uri
					? this.#workspace.getWorkspaceFolder(this.#scope)
					: this.#scope?.uri
						? this.#workspace.getWorkspaceFolder(this.#scope.uri)
						: undefined;

			// Convert to an object.
			const flags: Flags = {};
			for (let arg of flagArgs) {
				arg = arg.replace(/^--?/, '');
				const i = arg.indexOf('=');
				if (i === -1) {
					flags[arg] = true;
				} else {
					flags[arg.slice(0, i)] = resolvePath(arg.slice(i + 1), wsf?.uri?.fsPath);
				}
			}

			// Get go.testTags or go.buildTags.
			const tags = testTags ?? buildTags;
			if (tags !== undefined) flags.tags = tags;

			return flags;
		},
		this.#config<string[] | undefined>('go', 'testFlags'),
		this.#config<string[] | undefined>('go', 'buildFlags'),
		this.#config<string | undefined>('go', 'testTags'),
		this.#config<string | undefined>('go', 'buildTags'),
	);

	/** Resolves ${...} expressions in environment variable maps. */
	#resolve(...vars: Record<string, string>[]) {
		// Determine the workspace folder from the scope.
		const wsf =
			this.#scope instanceof Uri
				? this.#workspace.getWorkspaceFolder(this.#scope)
				: this.#scope?.uri
					? this.#workspace.getWorkspaceFolder(this.#scope.uri)
					: undefined;

		// Merge everything.
		const env = Object.assign({}, process.env, ...vars.reverse()) as Record<string, string>;

		// Resolve ${...} expressions.
		for (const key in env) {
			env[key] = resolvePath(substituteEnv(env[key]), wsf?.uri?.fsPath);
		}

		return env;
	}
}

interface Item<T> {
	get(): T;
	isAffected(e: ConfigurationChangeEvent): boolean;
	invalidate(): void;
}

class ConfigItem<T> implements Item<T> {
	readonly #workspace;
	readonly #scope;
	readonly #section;
	readonly #name;

	#has = false;
	#value?: T;

	constructor(workspace: VSCodeWorkspace, scope: ConfigurationScope | undefined, section: string, name: string) {
		this.#workspace = workspace;
		this.#scope = scope;
		this.#section = section;
		this.#name = name;
	}

	get() {
		if (this.#has) {
			return this.#value!;
		}

		this.#has = true;
		this.#value = this.#workspace.getConfiguration(this.#section, this.#scope).get<T>(this.#name);
		return this.#value!;
	}

	isAffected(e: ConfigurationChangeEvent) {
		return e.affectsConfiguration(`${this.#section}.${this.#name}`, this.#scope);
	}

	invalidate() {
		this.#has = false;
		this.#value = undefined;
	}
}

type ItemsFor<In extends any[]> = { [K in keyof In]: Item<In[K]> };

class CalculatedItem<In extends any[], Out> implements Item<Out> {
	readonly #fn;
	readonly #items;

	#has = false;
	#value?: Out;

	constructor(fn: (...args: In) => Out, ...items: ItemsFor<In>) {
		this.#fn = fn;
		this.#items = items;
	}

	get() {
		if (this.#has) {
			return this.#value!;
		}

		const args = this.#items.map((x) => x.get()) as In;
		this.#has = true;
		this.#value = this.#fn(...args);
		return this.#value;
	}

	isAffected(e: ConfigurationChangeEvent) {
		return this.#items.some((x) => x.isAffected(e));
	}

	invalidate(): void {
		this.#has = false;
		this.#value = undefined;
	}
}
