import vscode from 'vscode';
import { Context } from '../utils/testing';
import { TestConfig } from './config';
import { EventEmitter } from '../utils/eventEmitter';
import { CodeLens, TextDocument, Range } from 'vscode';
import { GoTestItem, StaticTestCase, TestCase, TestFile } from './model';
import { GoTestItemResolver } from './itemResolver';
import { ConfigValue, WorkspaceConfig } from './workspaceConfig';
import { Command } from './commands';

/**
 * Provides CodeLenses for running and debugging tests for users who prefer
 * those.
 */
export class CodeLensProvider implements vscode.CodeLensProvider<GoCodeLens> {
	readonly #config: WorkspaceConfig;
	readonly #resolver: GoTestItemResolver;

	constructor(config: WorkspaceConfig, resolver: GoTestItemResolver) {
		this.#config = config;
		this.#resolver = resolver;
	}

	/**
	 * Provide code lenses for a document.
	 */
	async provideCodeLenses(document: TextDocument): Promise<GoCodeLens[]> {
		const ws = this.#resolver.workspaceFor(document.uri);
		const mode = ws && this.#config.for(ws).codeLens.get();
		if (!mode) return [];

		const resolved = await this.#resolver.updateFile(document.uri);
		return resolved.flatMap((x) => [...this.#fileCodeLenses(mode, x)]);
	}

	/**
	 * Provide code lenses for a file.
	 */
	*#fileCodeLenses(mode: ConfigValue['codeLens'], file: TestFile) {
		const runPkg = new GoCodeLens(new Range(0, 0, 0, 0), file.package, 'run');
		const runFile = new GoCodeLens(new Range(0, 0, 0, 0), file, 'run');
		switch (mode) {
			case 'run':
			default:
				yield runPkg;
				yield runFile;
				break;
		}

		// Depending on the mode, create a run and/or debug code lens for each
		// test case that has a range. We can't do this for dynamic test cases
		// because `go test` does not provide a range for those.
		for (const test of file.tests) {
			if (test instanceof StaticTestCase && test.range) {
				const run = new GoCodeLens(test.range, test, 'run');
				const debug = new GoCodeLens(test.range, test, 'debug');
				switch (mode) {
					case 'run':
						yield run;
						break;
					case 'debug':
						yield debug;
						break;
					default:
						yield run;
						yield debug;
						break;
				}
			}
		}
	}

	/**
	 * Resolve the test item for a code lens.
	 */
	async resolveCodeLens(lens: GoCodeLens): Promise<GoCodeLens> {
		lens.command = {
			title: `${lens.kind} ${lens.item.kind}`,
			command: lens.kind === 'run' ? Command.Test.Run : Command.Test.Debug,
			arguments: [lens.item],
		};
		if (!(lens.item instanceof TestCase)) {
			lens.command.title += ' tests';
		}
		return lens;
	}
}

class GoCodeLens extends CodeLens {
	readonly item: GoTestItem;
	readonly kind: 'run' | 'debug';

	constructor(range: Range, item: GoTestItem, kind: 'run' | 'debug') {
		super(range);
		this.item = item;
		this.kind = kind;
	}
}
