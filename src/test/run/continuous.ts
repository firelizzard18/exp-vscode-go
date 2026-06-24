import type { Event } from 'vscode';

import { Disposer } from '@/utils/disposable';

import { type EditorEvent } from '../manager';
import { type GoTestItem, type ItemEvent, type Package, TestCase } from '../model';
import { type GoTestRequest, newGoTestRequest } from './controller';

export class ContinuousRunTracker extends Disposer {
	readonly #rq;
	readonly #onExecute;
	readonly #packages = new Set<Package>();
	readonly #queued = new Set<TestCase>();

	constructor(
		rq: GoTestRequest,
		editorEvents: Event<EditorEvent>,
		modelEvents: Event<ItemEvent[]>,
		onExecute: (rq: GoTestRequest) => void,
	) {
		super();
		this.#rq = rq;
		this.#onExecute = onExecute;

		this.disposeOf = editorEvents((x) => this.#onEditorEvent(x));
		this.disposeOf = modelEvents((x) => this.#onItemEvent(x));
	}

	#onEditorEvent(event: EditorEvent) {
		// Trigger a run when unsaved changes are committed.
		if (event.type !== 'file-saved') return;
		if (event.uri.scheme !== 'file') return;
		if (!event.uri.path.endsWith('.go')) return;
		if (this.#queued.size === 0) return;

		const rq2 = newGoTestRequest(
			this.#rq.request,
			new Set(this.#packages),
			new Set(this.#queued),
			this.#rq.exclude,
		);
		this.#packages.clear();
		this.#queued.clear();
		this.#onExecute(rq2);
	}

	#onItemEvent(updates: ItemEvent[]) {
		// Queue uncommitted updates (unsaved changes) for execution.
		const tests = updates
			.filter((x): x is ItemEvent<TestCase> => x.item instanceof TestCase && x.type === 'modified')
			.map((x) => x.item);

		let didAdd = false;
		for (const test of tests) {
			if (belongsTo(test, this.#rq.exclude)) {
				continue;
			}
			if (belongsTo(test, this.#rq.include)) {
				this.#queued.add(test);
				this.#packages.add(test.file.package);
				didAdd = true;
			}
		}
		return didAdd;
	}
}

function belongsTo(item: TestCase, set: Set<GoTestItem>) {
	return set.has(item) || set.has(item.file) || set.has(item.file.package) || set.has(item.file.package.root);
}
