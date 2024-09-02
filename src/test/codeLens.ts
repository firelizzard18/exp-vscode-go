import vscode from 'vscode';
import { Context } from './testing';
import { TestConfig } from './config';
import { StaticTestCase, TestCase } from './item';
import { EventEmitter } from '../utils/eventEmitter';
import { TestManager } from './manager';

export class CodeLensProvider implements vscode.CodeLensProvider<CodeLens> {
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

	async provideCodeLenses(document: vscode.TextDocument): Promise<CodeLens[]> {
		const mode = new TestConfig(this.#context.workspace).codeLens();
		if (mode === 'off') {
			return [];
		}

		const lenses = [];
		for await (const test of this.#manager.find(document.uri)) {
			if (test instanceof StaticTestCase && test.range) {
				const run = new CodeLens(test.range, test, 'run');
				const debug = new CodeLens(test.range, test, 'debug');
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
		}
		return lenses;
	}

	async resolveCodeLens(codeLens: CodeLens): Promise<CodeLens> {
		codeLens.command = {
			title: `${codeLens.kind} test`,
			command: `goExp.test.${codeLens.kind}`,
			arguments: [await this.#manager.resolveTestItem(codeLens.test)]
		};
		return codeLens;
	}
}

class CodeLens extends vscode.CodeLens {
	readonly test: TestCase;
	readonly kind: 'run' | 'debug';

	constructor(range: vscode.Range, test: TestCase, kind: 'run' | 'debug') {
		super(range);
		this.test = test;
		this.kind = kind;
	}
}
