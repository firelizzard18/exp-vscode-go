import { Command } from '@/commands';
import vscode, { CodeLens, Range, TextDocument } from 'vscode';
import { ConfigValue, WorkspaceConfig } from './config';
import { GoTestItem, ModelController, StaticTestCase, TestCase, TestFile } from './model';

/**
 * Provides CodeLenses for running and debugging tests for users who prefer
 * those.
 */
export class CodeLensProvider implements vscode.CodeLensProvider<GoCodeLens> {
	readonly #config: WorkspaceConfig;
	readonly #model: ModelController;

	constructor(config: WorkspaceConfig, model: ModelController) {
		this.#config = config;
		this.#model = model;
	}

	/**
	 * Provide code lenses for a document.
	 */
	async provideCodeLenses(document: TextDocument): Promise<GoCodeLens[]> {
		const ws = this.#model.workspaceFor(document.uri);
		const mode = ws && this.#config.for(ws).codeLens.get();
		if (!mode) return [];

		const resolved = await this.#model.updateFile(document.uri);
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
