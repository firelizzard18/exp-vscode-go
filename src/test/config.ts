import { Workspace } from './testing';
import { ConfigurationScope } from 'vscode';

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
}
