import { describe, expect, it } from '@jest/globals';
import { EventEmitter, Uri } from 'vscode';

import { type RunEvent, newGoTestRequest, shouldRunBenchmarks } from './controller';
import { ModelController } from '../model/controller';
import { Package } from '../model/package';
import { TestWorkspace } from '../../../test/utils/host';
import { FakeCommands, moduleResult, modulePackagesResult } from '../../../test/utils/model';
import { WorkspaceConfig } from '../config';
import { TestRunRequest } from 'vscode';

const WS_URI = 'file:///workspace';
const MOD_PATH = 'foo';
const GO_MOD = `${WS_URI}/go.mod`;

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

async function makeModel(packages: Parameters<typeof modulePackagesResult>[2], configPatch = {}) {
	const ws = new TestWorkspace();
	ws.workspaceFolders.push({ name: 'test', uri: Uri.parse(WS_URI), index: 0 });
	Object.assign(ws.config, configPatch);

	const runEvents = new EventEmitter<RunEvent>();
	const fake = new FakeCommands();
	fake.modulesResult = moduleResult(MOD_PATH, GO_MOD);
	fake.packagesResults = modulePackagesResult(MOD_PATH, GO_MOD, packages);

	const config = new WorkspaceConfig(ws);
	const ctrl = new ModelController(makeContext(ws, fake), config, runEvents.event);

	const workspace = ctrl.workspaceFor(ws.workspaceFolders[0])!;
	await ctrl.populate(workspace);

	const mod = [...workspace.modules][0]!;
	await ctrl.populate(mod);
	const pkg = [...mod.packages][0]!;
	await ctrl.populate(pkg);

	return { ctrl, config, pkg };
}

// ─── shouldRunBenchmarks ──────────────────────────────────────────────────────

describe('shouldRunBenchmarks', () => {
	it('returns false when package has both tests and benchmarks', async () => {
		const { config, pkg } = await makeModel([
			{
				path: 'foo',
				files: [
					{
						uri: `${WS_URI}/foo_test.go`,
						tests: ['TestFoo', 'BenchmarkFoo'],
					},
				],
			},
		]);

		expect(shouldRunBenchmarks(config, pkg)).toBe(false);
	});

	it('returns true when package has only benchmarks', async () => {
		const { config, pkg } = await makeModel([
			{
				path: 'foo',
				files: [
					{
						uri: `${WS_URI}/bench_test.go`,
						tests: ['BenchmarkFoo', 'BenchmarkBar'],
					},
				],
			},
		]);

		expect(shouldRunBenchmarks(config, pkg)).toBe(true);
	});

	it('returns true when runPackageBenchmarks config is enabled', async () => {
		const { config, pkg } = await makeModel(
			[
				{
					path: 'foo',
					files: [
						{
							uri: `${WS_URI}/foo_test.go`,
							tests: ['TestFoo', 'BenchmarkFoo'],
						},
					],
				},
			],
			{ runPackageBenchmarks: true },
		);

		expect(shouldRunBenchmarks(config, pkg)).toBe(true);
	});

	it('returns false when package has no loaded files', () => {
		const ws = new TestWorkspace();
		const wsf = { name: 'test', uri: Uri.parse(WS_URI), index: 0 };
		ws.workspaceFolders.push(wsf);
		const config = new WorkspaceConfig(ws);

		// Construct a Package whose files have not been populated (files.size === 0).
		// This simulates a package discovered by module discovery but not yet lazy-loaded.
		const workspace = { kind: 'workspace' as const, ws: wsf, uri: wsf.uri, dir: wsf.uri, packages: null as any, modules: null as any, allPackages: null as any, key: WS_URI };
		const module = { kind: 'module' as const, workspace, path: MOD_PATH, uri: Uri.parse(GO_MOD), dir: Uri.parse(WS_URI), packages: null as any, key: MOD_PATH };
		const pkg = new Package(module as any, { Path: MOD_PATH, ModulePath: MOD_PATH, TestFiles: [] }, { Path: MOD_PATH, GoMod: GO_MOD });

		// files.size === 0 (never populated)
		expect(pkg.files.size).toBe(0);
		expect(shouldRunBenchmarks(config, pkg)).toBe(false);
	});
});

// ─── newGoTestRequest ─────────────────────────────────────────────────────────

describe('newGoTestRequest', () => {
	it('maps tests to their packages in pkgInclude', async () => {
		const { pkg } = await makeModel([
			{
				path: 'foo',
				files: [{ uri: `${WS_URI}/foo_test.go`, tests: ['TestFoo', 'TestBar'] }],
			},
		]);

		const file = [...pkg.files][0]!;
		const testFoo = [...file.tests].find((t) => t.name === 'TestFoo')!;
		const testBar = [...file.tests].find((t) => t.name === 'TestBar')!;

		const pkgSet = new Set([pkg]);
		const include = new Set([testFoo, testBar]);
		const exclude = new Set<any>();

		const req = newGoTestRequest(new TestRunRequest(), pkgSet, include, exclude);

		const pkgInclude = req.pkgInclude.get(pkg);
		expect(pkgInclude).toContain(testFoo);
		expect(pkgInclude).toContain(testBar);
	});

	it('maps excluded tests to their packages in pkgExclude', async () => {
		const { pkg } = await makeModel([
			{
				path: 'foo',
				files: [{ uri: `${WS_URI}/foo_test.go`, tests: ['TestFoo', 'TestBar'] }],
			},
		]);

		const file = [...pkg.files][0]!;
		const testFoo = [...file.tests].find((t) => t.name === 'TestFoo')!;

		const req = newGoTestRequest(
			new TestRunRequest(),
			new Set([pkg]),
			new Set([pkg]),
			new Set([testFoo]),
		);

		const pkgExclude = req.pkgExclude.get(pkg);
		expect(pkgExclude).toContain(testFoo);
	});

	it('expands file include to its tests in pkgInclude', async () => {
		const { pkg } = await makeModel([
			{
				path: 'foo',
				files: [{ uri: `${WS_URI}/foo_test.go`, tests: ['TestFoo', 'TestBar'] }],
			},
		]);

		const file = [...pkg.files][0]!;
		const req = newGoTestRequest(
			new TestRunRequest(),
			new Set([pkg]),
			new Set([file]),
			new Set(),
		);

		const pkgInclude = req.pkgInclude.get(pkg);
		expect(pkgInclude).toHaveLength(2);
	});
});
