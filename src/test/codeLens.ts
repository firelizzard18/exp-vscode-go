import vscode from 'vscode';
import { Context } from './testing';
import { TestConfig } from './config';
import { GoTestItem, StaticTestCase, TestCase } from './item';
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
		const mode = new TestConfig(this.#context.workspace).codeLens();
		if (mode === 'off') {
			return [];
		}

		const lenses = [];
		for await (const test of this.#manager.find(document.uri)) {
			if (!(test instanceof StaticTestCase) || !test.range) {
				continue;
			}

			const run = new GoCodeLens(test.range, test, 'run');
			const debug = new GoCodeLens(test.range, test, 'debug');
			switch (mode) {
				case 'run':
					lenses.push(run);
					break;
				case 'debug':
					lenses.push(debug);
					break;
				default:
					lenses.push(run, debug);
					break;
			}
		}
		return lenses;
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
