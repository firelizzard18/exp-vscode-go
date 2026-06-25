import { describe, expect, it } from '@jest/globals';
import { EventEmitter, Uri } from 'vscode';

import { type ItemEvent } from '.';
import { type RunEvent } from '../run/controller';
import { ModelController } from './controller';
import { DynamicTestCase, StaticTestCase, TestCase } from './case';
import { WorkspaceConfig } from '../config';
import { TestWorkspace } from '../../../test/utils/host';
import { FakeCommands, moduleResult, modulePackagesResult } from '../../../test/utils/model';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeContext(workspace: TestWorkspace, commands: FakeCommands) {
	return {
		testing: true as const,
		output: { debug: () => {}, error: () => {}, info: () => {}, warn: () => {}, trace: () => {} },
		workspace,
		commands,
		go: { settings: { getExecutionCommand: () => ({ binPath: 'go' }) } },
		state: { get: () => undefined, update: async () => {}, keys: () => [] },
		storageUri: undefined,
		spawn: () => Promise.resolve({ code: 0, signal: null }),
		debug: () => Promise.resolve({ code: 0, signal: null }),
	} as any;
}

const WS_URI = 'file:///workspace';
const MOD_PATH = 'foo';
const GO_MOD = `${WS_URI}/go.mod`;

function makeWorkspaceFolder() {
	return { name: 'test', uri: Uri.parse(WS_URI), index: 0 };
}

// ─── workspaceFor ─────────────────────────────────────────────────────────────

describe('ModelController.workspaceFor', () => {
	it('creates a workspace on first call and returns same on second', () => {
		const ws = new TestWorkspace();
		ws.workspaceFolders.push(makeWorkspaceFolder());

		const runEvents = new EventEmitter<RunEvent>();
		const fake = new FakeCommands();
		const ctrl = new ModelController(makeContext(ws, fake), new WorkspaceConfig(ws), runEvents.event);

		const wsf = ws.workspaceFolders[0];
		const a = ctrl.workspaceFor(wsf);
		const b = ctrl.workspaceFor(wsf);

		expect(a).toBeDefined();
		expect(Object.is(a, b)).toBe(true);
	});

	it('returns undefined for URI outside any workspace', () => {
		const ws = new TestWorkspace();
		ws.workspaceFolders.push(makeWorkspaceFolder());

		const runEvents = new EventEmitter<RunEvent>();
		const fake = new FakeCommands();
		const ctrl = new ModelController(makeContext(ws, fake), new WorkspaceConfig(ws), runEvents.event);

		const outside = Uri.parse('file:///other/foo_test.go');
		expect(ctrl.workspaceFor(outside)).toBeUndefined();
	});

	it('respects exclusion globs', () => {
		const ws = new TestWorkspace();
		ws.workspaceFolders.push(makeWorkspaceFolder());
		ws.config.exclude = { 'vendor/**': true };

		const runEvents = new EventEmitter<RunEvent>();
		const fake = new FakeCommands();
		const ctrl = new ModelController(makeContext(ws, fake), new WorkspaceConfig(ws), runEvents.event);

		// A URI inside the excluded subtree should be rejected.
		const excluded = Uri.parse(`${WS_URI}/vendor/pkg/foo_test.go`);
		expect(ctrl.workspaceFor(excluded)).toBeUndefined();

		// A URI outside the exclusion should still work.
		const included = Uri.parse(`${WS_URI}/pkg/foo_test.go`);
		expect(ctrl.workspaceFor(included)).toBeDefined();
	});
});

// ─── #onRunEvent — dynamic test management ────────────────────────────────────

describe('ModelController RunEvent handling', () => {
	async function setup() {
		const ws = new TestWorkspace();
		ws.workspaceFolders.push(makeWorkspaceFolder());

		const runEvents = new EventEmitter<RunEvent>();
		const fake = new FakeCommands();

		fake.modulesResult = moduleResult(MOD_PATH, GO_MOD);
		fake.packagesResults = modulePackagesResult(MOD_PATH, GO_MOD, [
			{
				path: 'foo',
				files: [
					{
						uri: `${WS_URI}/foo_test.go`,
						tests: ['TestParent', 'TestOther'],
					},
				],
			},
		]);

		const ctrl = new ModelController(makeContext(ws, fake), new WorkspaceConfig(ws), runEvents.event);
		const wsf = ws.workspaceFolders[0];
		const workspace = ctrl.workspaceFor(wsf)!;
		await ctrl.populate(workspace);

		const mod = [...workspace.modules][0]!;
		await ctrl.populate(mod);
		const pkg = [...mod.packages][0]!;

		// Collect update events for assertions.
		const updates: ItemEvent[] = [];
		ctrl.onDidUpdate((evts) => updates.push(...evts));

		return { ctrl, pkg, runEvents, updates };
	}

	async function addDynamicTest(
		runEvents: EventEmitter<RunEvent>,
		pkg: any,
		name: string,
		run?: any,
	) {
		const fakeRun = run ?? makeFakeRun();
		await runEvents.fire({ type: 'subtest', run: fakeRun, pkg, name });
		return fakeRun;
	}

	it('creates a DynamicTestCase on subtest event', async () => {
		const { pkg, runEvents } = await setup();

		await runEvents.fire({ type: 'subtest', run: makeFakeRun(), pkg, name: 'TestParent/Sub' });

		const tests = [...pkg.allTests()];
		const dyn = tests.find((t) => t instanceof DynamicTestCase && t.name === 'TestParent/Sub');
		expect(dyn).toBeDefined();
	});

	it('does not duplicate an existing dynamic test on repeated subtest event', async () => {
		const { pkg, runEvents } = await setup();
		const run = makeFakeRun();

		await runEvents.fire({ type: 'subtest', run, pkg, name: 'TestParent/Sub' });
		await runEvents.fire({ type: 'subtest', run, pkg, name: 'TestParent/Sub' });

		const tests = [...pkg.allTests()].filter(
			(t) => t instanceof DynamicTestCase && t.name === 'TestParent/Sub',
		);
		expect(tests).toHaveLength(1);
	});

	it('removes dynamic tests under parent on start with no include set (whole-package run)', async () => {
		const { pkg, runEvents } = await setup();
		const run = makeFakeRun();

		// Add two dynamic subtests.
		await runEvents.fire({ type: 'subtest', run, pkg, name: 'TestParent/A' });
		await runEvents.fire({ type: 'subtest', run, pkg, name: 'TestParent/B' });
		expect([...pkg.allTests()].filter((t) => t instanceof DynamicTestCase)).toHaveLength(2);

		// A start event with no include/exclude means: run the whole package.
		await runEvents.fire({ type: 'start', run, pkg });

		const remaining = [...pkg.allTests()].filter((t) => t instanceof DynamicTestCase);
		expect(remaining).toHaveLength(0);
	});

	it('does NOT remove dynamic test when it is the exact included item', async () => {
		const { pkg, runEvents } = await setup();
		const run = makeFakeRun();

		await runEvents.fire({ type: 'subtest', run, pkg, name: 'TestParent/A' });

		const dynTest = [...pkg.allTests()].find(
			(t) => t instanceof DynamicTestCase && t.name === 'TestParent/A',
		) as TestCase;
		expect(dynTest).toBeDefined();

		// Include set contains only the dynamic test itself — it should be kept.
		await runEvents.fire({
			type: 'start',
			run,
			pkg,
			include: new Set([dynTest]),
		});

		const remaining = [...pkg.allTests()].filter((t) => t instanceof DynamicTestCase);
		expect(remaining).toHaveLength(1);
	});

	it('does NOT remove dynamic test when include does not cover it', async () => {
		const { pkg, runEvents } = await setup();
		const run = makeFakeRun();

		await runEvents.fire({ type: 'subtest', run, pkg, name: 'TestParent/A' });

		// Include only TestOther — TestParent/A is not covered, should be kept.
		const otherTest = [...pkg.allTests()].find(
			(t) => t instanceof StaticTestCase && t.name === 'TestOther',
		) as TestCase;
		expect(otherTest).toBeDefined();

		await runEvents.fire({
			type: 'start',
			run,
			pkg,
			include: new Set([otherTest]),
		});

		const remaining = [...pkg.allTests()].filter((t) => t instanceof DynamicTestCase);
		expect(remaining).toHaveLength(1);
	});

	it('does NOT remove dynamic test when it is excluded', async () => {
		const { pkg, runEvents } = await setup();
		const run = makeFakeRun();

		await runEvents.fire({ type: 'subtest', run, pkg, name: 'TestParent/A' });

		const dynTest = [...pkg.allTests()].find(
			(t) => t instanceof DynamicTestCase && t.name === 'TestParent/A',
		) as TestCase;
		const parentTest = [...pkg.allTests()].find(
			(t) => t instanceof StaticTestCase && t.name === 'TestParent',
		) as TestCase;

		// Include the parent (which covers the child) but also exclude the child.
		await runEvents.fire({
			type: 'start',
			run,
			pkg,
			include: new Set([parentTest]),
			exclude: new Set([dynTest]),
		});

		const remaining = [...pkg.allTests()].filter((t) => t instanceof DynamicTestCase);
		expect(remaining).toHaveLength(1);
	});

	it('removes child dynamic tests along with their parent', async () => {
		const { pkg, runEvents } = await setup();
		const run = makeFakeRun();

		// Two-level subtests: TestParent/A and TestParent/A/1
		await runEvents.fire({ type: 'subtest', run, pkg, name: 'TestParent/A' });
		await runEvents.fire({ type: 'subtest', run, pkg, name: 'TestParent/A/1' });
		expect([...pkg.allTests()].filter((t) => t instanceof DynamicTestCase)).toHaveLength(2);

		// Run the whole package — both should be removed.
		await runEvents.fire({ type: 'start', run, pkg });

		const remaining = [...pkg.allTests()].filter((t) => t instanceof DynamicTestCase);
		expect(remaining).toHaveLength(0);
	});

	it('removes dynamic tests associated with a run on disposed', async () => {
		const { pkg, runEvents } = await setup();
		const run = makeFakeRun();

		await runEvents.fire({ type: 'subtest', run, pkg, name: 'TestParent/A' });
		expect([...pkg.allTests()].filter((t) => t instanceof DynamicTestCase)).toHaveLength(1);

		await runEvents.fire({ type: 'disposed', run, pkg });

		const remaining = [...pkg.allTests()].filter((t) => t instanceof DynamicTestCase);
		expect(remaining).toHaveLength(0);
	});

	it('only removes dynamic tests for the disposed run, not others', async () => {
		const { pkg, runEvents } = await setup();
		const run1 = makeFakeRun();
		const run2 = makeFakeRun();

		await runEvents.fire({ type: 'subtest', run: run1, pkg, name: 'TestParent/A' });
		await runEvents.fire({ type: 'subtest', run: run2, pkg, name: 'TestParent/B' });

		await runEvents.fire({ type: 'disposed', run: run1, pkg });

		const remaining = [...pkg.allTests()].filter((t) => t instanceof DynamicTestCase);
		expect(remaining).toHaveLength(1);
		expect(remaining[0].name).toBe('TestParent/B');
	});
});

// ─── #consolidatePackages — via populate ─────────────────────────────────────

describe('ModelController consolidatePackages', () => {
	it('merges foo and foo_test packages into one', async () => {
		const ws = new TestWorkspace();
		ws.workspaceFolders.push(makeWorkspaceFolder());

		const runEvents = new EventEmitter<RunEvent>();
		const fake = new FakeCommands();

		// gopls returns both foo and foo_test as separate package entries
		fake.modulesResult = moduleResult(MOD_PATH, GO_MOD);
		fake.packagesResults = {
			Packages: [
				{
					Path: 'foo',
					ModulePath: 'foo',
					TestFiles: [{ URI: `${WS_URI}/foo_test.go`, Tests: [{ Name: 'TestFoo', Loc: { uri: `${WS_URI}/foo_test.go`, range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } } } }] }],
				},
				{
					// The external test package — gopls reports it with ForTest pointing back
					Path: 'foo_test',
					ForTest: 'foo',
					ModulePath: 'foo',
					TestFiles: [{ URI: `${WS_URI}/foo_external_test.go`, Tests: [{ Name: 'TestFooExternal', Loc: { uri: `${WS_URI}/foo_external_test.go`, range: { start: { line: 0, character: 0 }, end: { line: 5, character: 1 } } } }] }],
				},
			],
			Module: { foo: { Path: 'foo', GoMod: GO_MOD } },
		};

		const ctrl = new ModelController(makeContext(ws, fake), new WorkspaceConfig(ws), runEvents.event);
		const workspace = ctrl.workspaceFor(ws.workspaceFolders[0])!;
		await ctrl.populate(workspace);

		const mod = [...workspace.modules][0]!;
		await ctrl.populate(mod);
		// Should only be one package, not two
		expect([...mod.packages]).toHaveLength(1);
	});
});

// ─── private helpers ─────────────────────────────────────────────────────────

function makeFakeRun() {
	return {
		onDidDispose: undefined,
		started: () => {},
		passed: () => {},
		failed: () => {},
		skipped: () => {},
		errored: () => {},
		appendOutput: () => {},
		enqueued: () => {},
		end: () => {},
	} as any;
}
