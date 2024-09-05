import vscode from 'vscode';
import { Context } from './testing';
import { TestConfig } from './config';
import { GoTestItem, StaticTestCase, TestCase, TestFile } from './item';
import { EventEmitter } from '../utils/eventEmitter';
import { TestManager } from './manager';
import { CodeLens, TextDocument, Range } from 'vscode';

export class CodeLensProvider implements vscode.CodeLensProvider<GoCodeLens> {
	readonly #didChangeCodeLenses = new EventEmitter<void>();
	readonly onDidChangeCodeLenses = this.#didChangeCodeLenses.event;

	readonly #context: Context;
	readonly #manager: TestManager;

	constructor(context: Context, manager: TestManager) {
		this.#context = context;
		this.#manager = manager;
	}

	async reload() {
		await this.#didChangeCodeLenses.fire();
	}

	async provideCodeLenses(document: TextDocument): Promise<GoCodeLens[]> {
		if (this.#mode() === 'off') {
			return [];
		}

		for (const root of await this.#manager.rootGoTestItems()) {
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

	*#fileCodeLenses(file: TestFile) {
		const mode = this.#mode(file.uri);
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

	async resolveCodeLens(lens: GoCodeLens): Promise<GoCodeLens> {
		lens.command = {
			title: `${lens.kind} ${lens.item.kind}`,
			command: `goExp.test.${lens.kind}`,
			arguments: [await this.#manager.resolveTestItem(lens.item)]
		};
		if (!(lens.item instanceof TestCase)) {
			lens.command.title += ' files';
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
