import { describe, expect, it, jest } from '@jest/globals';
import path from 'node:path';
import { CancellationTokenSource, EventEmitter, TestRunProfileKind, TestRunRequest, Uri } from 'vscode';

import lokiDump from '../../../test/testdata/loki.json';
import { TestHost, TestWorkspace } from '../../../test/utils/host';
import { FakeCommands, modulePackagesResult, moduleResult } from '../../../test/utils/model';
import { type Spawner } from '../../utils/spawn';
import { WorkspaceConfig } from '../config';
import { DumpedWorkspace, loadDataModel, ModelController } from '../model';
import { Package } from '../model/package';
import { ViewController } from '../view/controller';
import { ModelViewPresenter } from '../view/presenter';
import { RunConfig } from './config';
import { newGoTestRequest, RunController, shouldRunBenchmarks, type RunEvent } from './controller';

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
		const workspace = {
			kind: 'workspace' as const,
			ws: wsf,
			uri: wsf.uri,
			dir: wsf.uri,
			packages: null as any,
			modules: null as any,
			allPackages: null as any,
			key: WS_URI,
		};
		const module = {
			kind: 'module' as const,
			workspace,
			path: MOD_PATH,
			uri: Uri.parse(GO_MOD),
			dir: Uri.parse(WS_URI),
			packages: null as any,
			key: MOD_PATH,
		};
		const pkg = new Package(module as any, { Path: MOD_PATH, ModulePath: MOD_PATH, TestFiles: [] });

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

		const req = newGoTestRequest(new TestRunRequest(), new Set([pkg]), new Set([pkg]), new Set([testFoo]));

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
		const req = newGoTestRequest(new TestRunRequest(), new Set([pkg]), new Set([file]), new Set());

		const pkgInclude = req.pkgInclude.get(pkg);
		expect(pkgInclude).toHaveLength(2);
	});
});

describe('Run controller (loki)', () => {
	const workspaces = lokiDump.map((x) =>
		loadDataModel(
			{
				workspace: {
					getWorkspaceFolder(uri) {
						return {
							index: 0,
							name: `${uri}`,
							uri,
						};
					},
				},
			},
			x as unknown as DumpedWorkspace,
		),
	);

	const host = TestHost.create();
	host.workspace.workspaceFolders.push(...workspaces.map((x) => x.ws));

	const spawn = jest.fn<Spawner>(() => Promise.resolve({ code: 0, signal: null }));
	host.spawn = spawn;

	const runEvents = new EventEmitter<RunEvent>();
	const config = new WorkspaceConfig(host.workspace);
	const model = new ModelController(host, config, runEvents.event);
	for (const ws of workspaces) {
		model.workspaces.add(ws);
	}

	const presenter = new ModelViewPresenter(config, model, runEvents.event);
	const resolver = new ViewController(host, model, presenter, host.controller, runEvents.event);
	const runConfig = new RunConfig(host, 'Run', TestRunProfileKind.Run);
	const token = new CancellationTokenSource().token;
	const runner = new RunController(host, config, host.controller, runConfig, token, resolver, model, runEvents);

	it('runs all tests', async () => {
		const packages = new Set(workspaces.flatMap((x) => [...x.allPackages()]));
		await runner.run(newGoTestRequest(new TestRunRequest(), packages, new Set(workspaces), new Set()));

		const ran = spawn.mock.calls.map((x) => './' + path.relative(workspaces[0].dir.fsPath, x[7].cwd!));
		expect(ran.sort()).toEqual([
			'./',
			'./2d/geometry',
			'./2d/terrain',
			'./2d/world',
			'./examples/bunnymark',
			'./examples/pong',
			'./internal',
			'./internal/bitset',
			'./multiplayer',
			'./multiplayer/eventlog',
			'./query',
			'./store',
			'./store/ops',
			'./store/v0',
			'./store/v1',
		]);
	});
});
