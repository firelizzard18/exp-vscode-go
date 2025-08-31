import { Workspace } from '../utils/testing';
import { ConfigurationScope, Uri } from 'vscode';
import { Minimatch } from 'minimatch';
import deepEqual from 'deep-equal';
import { resolvePath, substituteEnv } from '../utils/util';
import { Flags } from './utils';

/**
 * Wrapper for accessing test explorer configuration.
 */
export class TestConfig {
	readonly #workspace;
	readonly #scope;
	readonly #cache = new Map<string, any>();
	#excludeValue?: string[];
	#excludeCompiled?: Minimatch[];

	constructor(workspace: Workspace, scope?: ConfigurationScope) {
		this.#workspace = workspace;
		this.#scope = scope;
	}

	/**
	 * Create a new {@link TestConfig} for a the given scope.
	 */
	for(scope?: ConfigurationScope) {
		return new TestConfig(this.#workspace, scope);
	}

	/**
	 * Get a configuration value.
	 */
	get<T>(name: string) {
		return this.#get<T>(`testExplorer.${name}`, 'exp-vscode-go');
	}

	#get<T>(name: string, section: string): T {
		const key = `${section}::${name}`;
		if (this.#cache.has(key)) {
			return this.#cache.get(key) as T;
		}

		const config = this.#workspace.getConfiguration(section, this.#scope);
		const value = config.get(name);
		this.#cache.set(name, value);
		return value as T;
	}

	#calc<T>(key: string, calc: () => T) {
		key = `::${key}`;
		if (this.#cache.has(key)) {
			return this.#cache.get(key) as T;
		}

		const value = calc();
		this.#cache.set(key, value);
		return value;
	}

	readonly enable = () => this.get<boolean>('enable');
	readonly discovery = () => this.get<'on' | 'off'>('discovery');
	readonly update = () => this.get<'on-save' | 'on-edit' | 'off'>('update');
	readonly showFiles = () => this.get<boolean>('showFiles');
	readonly nestPackages = () => this.get<boolean>('nestPackages');
	readonly nestSubtests = () => this.get<boolean>('nestSubtests');
	readonly codeLens = () => this.get<true | false | 'run' | 'debug'>('codeLens');
	readonly runPackageBenchmarks = () => this.get<boolean>('runPackageBenchmarks');
	readonly dynamicSubtestLimit = () => this.get<number>('dynamicSubtestLimit');
	readonly testTags = () => this.#get<string[]>('testTags', 'go') || this.#get<string[]>('buildTags', 'go') || [];

	/**
	 * @returns `go.toolsEnvVars` with `${...}` expressions resolved.
	 */
	readonly toolsEnvVars = () => this.#calc('toolsEnvVars', () => this.#envVars('toolsEnvVars'));

	/**
	 * @returns `go.testEnvVars` and `go.toolsEnvVars` (merged) with `${...}` expressions resolved.
	 */
	readonly testEnvVars = () => this.#calc('testEnvVars', () => this.#envVars('toolsEnvVars', 'testEnvVars'));

	/**
	 * @returns An array of compiled minimatch patterns from
	 * `exp-vscode-go.testExplorer.exclude` and `files.exclude`.
	 */
	exclude() {
		return this.#calc('exclude', () => {
			// Merge files.exclude and exp-vscode-go.testExplorer.exclude
			const a = this.get<Record<string, boolean>>('exclude') || {};
			const b =
				this.#workspace.getConfiguration('files', this.#scope).get<Record<string, boolean>>('exclude') || {};
			const v = Object.assign({}, b, a);

			// List enabled patterns
			const patterns = Object.entries(v)
				.filter(([, v]) => v)
				.map(([k]) => k);

			// Only recompile if the patterns have changed
			if (deepEqual(patterns, this.#excludeValue)) {
				return this.#excludeCompiled;
			}

			this.#excludeValue = patterns;
			this.#excludeCompiled = patterns.map((x) => new Minimatch(x));
			return this.#excludeCompiled;
		});
	}

	/**
	 * @returns `go.testFlags` or `go.buildFlags`, converted to {@link Flags}.
	 */
	testFlags() {
		return this.#calc('testFlags', () => {
			// Determine the workspace folder from the scope
			const wsf =
				this.#scope instanceof Uri
					? this.#workspace.getWorkspaceFolder(this.#scope)
					: this.#scope?.uri
						? this.#workspace.getWorkspaceFolder(this.#scope.uri)
						: undefined;

			// Get go.testFlags or go.buildFlags
			const cfg = this.#workspace.getConfiguration('go', this.#scope);
			const flagArgs = cfg.get<string[]>('testFlags') || cfg.get<string[]>('buildFlags') || [];

			// Convert to an object
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

			// Get go.testTags or go.buildTags
			const tags = cfg.get<string>('testTags') ?? cfg.get<string>('buildTags') ?? '';
			if (tags) flags.tags = tags;

			return flags;
		});
	}

	#envVars(...names: string[]) {
		// Determine the workspace folder from the scope
		const wsf =
			this.#scope instanceof Uri
				? this.#workspace.getWorkspaceFolder(this.#scope)
				: this.#scope?.uri
					? this.#workspace.getWorkspaceFolder(this.#scope.uri)
					: undefined;

		// Get go.toolsEnvVars and go.testEnvVars
		const cfg = this.#workspace.getConfiguration('go', this.#scope);
		const env = Object.assign({}, process.env, ...names.map((x) => cfg.get<Record<string, string>>(x))) as Record<
			string,
			string
		>;

		// Resolve ${...} expressions
		for (const key in env) {
			env[key] = resolvePath(substituteEnv(env[key]), wsf?.uri?.fsPath);
		}

		return env;
	}
}
