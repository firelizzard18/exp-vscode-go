import { Workspace } from './testing';
import { ConfigurationScope } from 'vscode';
import { Minimatch } from 'minimatch';
import deepEqual from 'deep-equal';

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
}
