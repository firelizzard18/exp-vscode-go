import vscode from 'vscode';
import { Context } from '../utils/testing';
import { TestConfig } from './config';
import { GoTestItem, StaticTestCase, TestCase, TestFile } from './item';
import { EventEmitter } from '../utils/eventEmitter';
import { TestManager } from './manager';
import { CodeLens, TextDocument, Range } from 'vscode';

/**
 * Provides CodeLenses for running and debugging tests for users who prefer
 * those.
 */
export class CodeLensProvider implements vscode.CodeLensProvider<GoCodeLens> {
	// We only need to implement `onDidChangeCodeLenses?: Event<void>` if tests
	// are changing for reasons other than the files changing. VSCode detects
	// when the file changes and automatically updates the code lenses.

	readonly #context: Context;
	readonly #manager: TestManager;

	constructor(context: Context, manager: TestManager) {
		this.#context = context;
		this.#manager = manager;
	}

	/**
	 * Provide code lenses for a document.
	 */
	async provideCodeLenses(document: TextDocument): Promise<GoCodeLens[]> {
		if (!this.#mode()) {
			return [];
		}

		// We don't know which module/workspace/package the document belongs to,
		// and alternative build systems may confuse the matter even more so
		// we'll just iterate until we find the right file. This is only
		// expensive if packages have not yet been loaded.
		for (const root of await this.#manager.rootGoTestItems) {
			for (const pkg of await root.getPackages()) {
				for (const file of await pkg.files) {
					if (`${file.uri}` === `${document.uri}`) {
						return [...this.#fileCodeLenses(file)];
					}
				}
			}
		}
		return [];
	}

	/**
	 * Provide code lenses for a file.
	 */
	*#fileCodeLenses(file: TestFile) {
		const mode = this.#mode(file.uri);
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

	#mode(uri?: vscode.Uri) {
		return new TestConfig(this.#context.workspace, uri).codeLens();
	}

	/**
	 * Resolve the test item for a code lens.
	 */
	async resolveCodeLens(lens: GoCodeLens): Promise<GoCodeLens> {
		lens.command = {
			title: `${lens.kind} ${lens.item.kind}`,
			command: `goExp.test.${lens.kind}`,
			arguments: await this.#manager.resolveTestItem(lens.item, { children: true }),
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
