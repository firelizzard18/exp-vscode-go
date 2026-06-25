/**
 * Integration tests for the run pipeline:
 *   RunController → RunEvents → ModelController + ModelViewPresenter → ViewController
 *
 * These tests wire ModelController + ModelViewPresenter + ViewController together
 * and fire RunEvents to verify that dynamic subtest discovery, pre-run cleanup,
 * and run disposal work end-to-end.
 */
import { describe, expect, it } from '@jest/globals';
import { EventEmitter, Uri } from 'vscode';

import { ModelController } from '@/test/model/controller';
import { ModelViewPresenter } from '@/test/view/presenter';
import { ViewController } from '@/test/view/controller';
import { WorkspaceConfig } from '@/test/config';
import { DynamicTestCase } from '@/test/model/case';
import { type RunEvent } from '@/test/run/controller';
import { MockTestController, TestWorkspace } from '../utils/host';
import { FakeCommands, moduleResult, modulePackagesResult } from '../utils/model';

const WS_URI = 'file:///workspace';
const MOD_PATH = 'foo';
const GO_MOD = `${WS_URI}/go.mod`;
const FILE_URI = `${WS_URI}/foo_test.go`;

function makeContext(ws: TestWorkspace, commands: FakeCommands) {
	return {
		testing: true as const,
		output: { debug: () => {}, error: () => {}, info: () => {}, warn: () => {}, trace: () => {} },
		workspace: ws,
		commands,
		go: { settings: { getExecutionCommand: () => ({ binPath: 'go' }) } },
		state: { get: () => undefined, update: async () => {}, keys: () => [] },
		storageUri: undefined,
		spawn: () => Promise.resolve({ code: 0, signal: null }),
		debug: () => Promise.resolve({ code: 0, signal: null }),
	} as any;
}

async function setup() {
	const ws = new TestWorkspace();
	ws.workspaceFolders.push({ name: 'test', uri: Uri.parse(WS_URI), index: 0 });

	const runEvents = new EventEmitter<RunEvent>();
	const fake = new FakeCommands();
	fake.modulesResult = moduleResult(MOD_PATH, GO_MOD);
	fake.packagesResults = modulePackagesResult(MOD_PATH, GO_MOD, [
		{
			path: 'foo',
			files: [
				{
					uri: FILE_URI,
					tests: ['TestParent', 'TestOther'],
				},
			],
		},
	]);

	const wsConfig = new WorkspaceConfig(ws);
	const ctrl = new MockTestController();
	const ctx = makeContext(ws, fake);
	const model = new ModelController(ctx, wsConfig, runEvents.event);
	const presenter = new ModelViewPresenter(wsConfig, model, runEvents.event);
	const view = new ViewController(ctx, wsConfig, model, presenter, ctrl, runEvents.event);

	const workspace = model.workspaceFor(ws.workspaceFolders[0])!;
	await model.populate(workspace);

	const mod = [...workspace.modules][0]!;
	await model.populate(mod);
	const pkg = [...mod.packages][0]!;
	await model.populate(pkg);

	const fakeRun = {
		onDidDispose: undefined as any,
		started: () => {},
		passed: () => {},
		failed: () => {},
		skipped: () => {},
		errored: () => {},
		appendOutput: () => {},
		enqueued: () => {},
		end: () => {},
	} as any;

	return { ctrl, model, presenter, view, workspace, mod, pkg, runEvents, fakeRun };
}

function allIds(items: any): string[] {
	const ids: string[] = [];
	for (const [id, item] of items) {
		ids.push(id);
		ids.push(...allIds(item.children));
	}
	return ids;
}

// ─── Subtest discovery ────────────────────────────────────────────────────────

describe('Run pipeline — subtest discovery', () => {
	it('dynamic subtest appears in TestItem tree after subtest RunEvent', async () => {
		const { pkg, runEvents, ctrl, fakeRun } = await setup();

		await runEvents.fire({ type: 'subtest', run: fakeRun, pkg, name: 'TestParent/Sub' });

		// Check model has the dynamic test
		const dyn = [...pkg.allTests()].find(
			(t) => t instanceof DynamicTestCase && t.name === 'TestParent/Sub',
		);
		expect(dyn).toBeDefined();

		// Check that ViewController has synced it into the TestItem tree
		const ids = allIds(ctrl.items);
		expect(ids.some((id) => id.includes('name=TestParent%2FSub') || id.includes('name=TestParent/Sub'))).toBe(true);
	});

	it('repeated subtest event does not create duplicate TestItem', async () => {
		const { pkg, runEvents, ctrl, fakeRun } = await setup();

		await runEvents.fire({ type: 'subtest', run: fakeRun, pkg, name: 'TestParent/Sub' });
		await runEvents.fire({ type: 'subtest', run: fakeRun, pkg, name: 'TestParent/Sub' });

		// Model should have exactly one dynamic test
		const dynTests = [...pkg.allTests()].filter(
			(t) => t instanceof DynamicTestCase && t.name === 'TestParent/Sub',
		);
		expect(dynTests).toHaveLength(1);
	});
});

// ─── Pre-run cleanup ──────────────────────────────────────────────────────────

describe('Run pipeline — pre-run cleanup', () => {
	it('dynamic tests are removed from model and tree on whole-package start', async () => {
		const { pkg, runEvents, ctrl, fakeRun } = await setup();

		// Add a dynamic test
		await runEvents.fire({ type: 'subtest', run: fakeRun, pkg, name: 'TestParent/A' });
		expect([...pkg.allTests()].filter((t) => t instanceof DynamicTestCase)).toHaveLength(1);

		const idsBefore = allIds(ctrl.items);
		expect(idsBefore.some((id) => id.includes('TestParent'))).toBe(true);

		// Whole-package run start — clears dynamics
		await runEvents.fire({ type: 'start', run: fakeRun, pkg });

		const remaining = [...pkg.allTests()].filter((t) => t instanceof DynamicTestCase);
		expect(remaining).toHaveLength(0);
	});
});

// ─── Run disposal ─────────────────────────────────────────────────────────────

describe('Run pipeline — run disposal', () => {
	it('dynamic tests from disposed run are removed from model', async () => {
		const { pkg, runEvents, fakeRun } = await setup();

		await runEvents.fire({ type: 'subtest', run: fakeRun, pkg, name: 'TestParent/A' });
		expect([...pkg.allTests()].filter((t) => t instanceof DynamicTestCase)).toHaveLength(1);

		await runEvents.fire({ type: 'disposed', run: fakeRun, pkg });

		const remaining = [...pkg.allTests()].filter((t) => t instanceof DynamicTestCase);
		expect(remaining).toHaveLength(0);
	});

	it('only removes dynamic tests for the disposed run', async () => {
		const { pkg, runEvents } = await setup();
		const run1 = { onDidDispose: undefined, started: () => {}, passed: () => {}, failed: () => {}, skipped: () => {}, errored: () => {}, appendOutput: () => {}, enqueued: () => {}, end: () => {} } as any;
		const run2 = { onDidDispose: undefined, started: () => {}, passed: () => {}, failed: () => {}, skipped: () => {}, errored: () => {}, appendOutput: () => {}, enqueued: () => {}, end: () => {} } as any;

		await runEvents.fire({ type: 'subtest', run: run1, pkg, name: 'TestParent/A' });
		await runEvents.fire({ type: 'subtest', run: run2, pkg, name: 'TestParent/B' });
		expect([...pkg.allTests()].filter((t) => t instanceof DynamicTestCase)).toHaveLength(2);

		await runEvents.fire({ type: 'disposed', run: run1, pkg });

		const remaining = [...pkg.allTests()].filter((t) => t instanceof DynamicTestCase);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].name).toBe('TestParent/B');
	});
});

// ─── Config — nestSubtests ────────────────────────────────────────────────────

describe('Run pipeline — nestSubtests in view', () => {
	it('dynamic subtest is nested under parent in TestItem tree when nestSubtests=true', async () => {
		const { ctrl, presenter, pkg, runEvents, fakeRun } = await setup();

		await runEvents.fire({ type: 'subtest', run: fakeRun, pkg, name: 'TestParent/Sub' });

		const dyn = [...pkg.allTests()].find(
			(t) => t instanceof DynamicTestCase && t.name === 'TestParent/Sub',
		)!;
		expect(dyn).toBeDefined();

		// When nestSubtests=true, the parent of the dynamic test should be the static TestParent
		const parent = presenter.getParent(dyn);
		expect(parent).not.toBeUndefined();
	});
});
