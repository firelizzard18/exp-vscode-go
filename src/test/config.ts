import { Workspace } from './testing';
import { ConfigurationScope, Uri } from 'vscode';
import { Minimatch } from 'minimatch';
import deepEqual from 'deep-equal';
import { resolvePath, substituteEnv } from '../utils/util';
import { Flags } from './utils';

/**
 * Wrapper for accessing test explorer configuration.
 */
export class TestConfig {
	readonly #workspace: Workspace;
	readonly #scope?: ConfigurationScope;

	constructor(workspace: Workspace, scope?: ConfigurationScope) {
		this.#workspace = workspace;
		this.#scope = scope;
	}

	for(scope?: ConfigurationScope) {
		return new TestConfig(this.#workspace, scope);
	}

	get<T>(name: string) {
		return this.#workspace.getConfiguration('goExp', this.#scope).get<T>(`testExplorer.${name}`);
	}

	readonly enable = () => this.get<boolean>('enable');
	readonly discovery = () => this.get<'on' | 'off'>('discovery');
	readonly showFiles = () => this.get<boolean>('showFiles');
	readonly nestPackages = () => this.get<boolean>('nestPackages');
	readonly nestSubtests = () => this.get<boolean>('nestSubtests');
	readonly codeLens = () => this.get<'on' | 'off' | 'run' | 'debug'>('codeLens');
	readonly runPackageBenchmarks = () => this.get<boolean>('runPackageBenchmarks');
	readonly dynamicSubtestLimit = () => this.get<number>('dynamicSubtestLimit');

	#excludeValue?: string[];
	#excludeCompiled?: Minimatch[];

	readonly exclude = () => {
		// Merge files.exclude and goExp.testExplorer.exclude
		const a = this.get<Record<string, boolean>>('exclude') || {};
		const b = this.#workspace.getConfiguration('files', this.#scope).get<Record<string, boolean>>('exclude') || {};
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
	};

	readonly testTags = () => {
		const cfg = this.#workspace.getConfiguration('go', this.#scope);
		return cfg.get<string[]>('testTags') || cfg.get<string[]>('buildTags') || [];
	};

	readonly testFlags = () => {
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
	};

	readonly testEnvVars = () => {
		// Determine the workspace folder from the scope
		const wsf =
			this.#scope instanceof Uri
				? this.#workspace.getWorkspaceFolder(this.#scope)
				: this.#scope?.uri
					? this.#workspace.getWorkspaceFolder(this.#scope.uri)
					: undefined;

		// Get go.toolsEnvVars and go.testEnvVars
		const cfg = this.#workspace.getConfiguration('go', this.#scope);
		const env = Object.assign(
			{},
			process.env,
			cfg.get<Record<string, string>>('toolsEnvVars'),
			cfg.get<Record<string, string>>('testEnvVars')
		) as Record<string, string>;

		// Resolve ${...} expressions
		for (const key in env) {
			env[key] = resolvePath(substituteEnv(env[key]), wsf?.uri?.fsPath);
		}

		return env;
	};
}
