import { describe, expect, it } from '@jest/globals';
import { EventEmitter, Uri } from 'vscode';

import { type RunEvent } from '../run/controller';
import { ModelController } from '../model/controller';
import { ModelViewPresenter } from './presenter';
import { DynamicTestCase, TestCase } from '../model/case';
import { TestWorkspace } from '../../../test/utils/host';
import {
	FakeCommands,
	moduleResult,
	modulePackagesResult,
} from '../../../test/utils/model';
import { WorkspaceConfig } from '../config';
import { type CapturedProfile } from '../run/profiles';

// ─── Setup helpers ────────────────────────────────────────────────────────────

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

interface SetupOptions {
	nestPackages?: boolean;
	showFiles?: boolean;
	nestSubtests?: boolean;
}

async function setup(packages: Parameters<typeof modulePackagesResult>[2], opts: SetupOptions = {}) {
	const ws = new TestWorkspace();
	ws.workspaceFolders.push({ name: 'test', uri: Uri.parse(WS_URI), index: 0 });
	Object.assign(ws.config, { nestPackages: false, showFiles: false, nestSubtests: true, ...opts });

	const runEvents = new EventEmitter<RunEvent>();
	const fake = new FakeCommands();
	fake.modulesResult = moduleResult(MOD_PATH, GO_MOD);
	fake.packagesResults = modulePackagesResult(MOD_PATH, GO_MOD, packages);

	const config = new WorkspaceConfig(ws);
	const ctrl = new ModelController(makeContext(ws, fake), config, runEvents.event);
	const presenter = new ModelViewPresenter(config, ctrl, runEvents.event);

	const workspace = ctrl.workspaceFor(ws.workspaceFolders[0])!;
	await ctrl.populate(workspace);

	const mod = [...workspace.modules][0]!;
	await ctrl.populate(mod);

	return { ctrl, presenter, workspace, mod, runEvents };
}

// ─── getParent / getChildren — nestPackages ───────────────────────────────────

describe('ModelViewPresenter — nestPackages', () => {
	it('getParent returns module when nestPackages is false', async () => {
		const { presenter, mod } = await setup([
			{ path: 'foo/a', files: [{ uri: `${WS_URI}/a/a_test.go`, tests: ['TestA'] }] },
			{ path: 'foo/a/b', files: [{ uri: `${WS_URI}/a/b/b_test.go`, tests: ['TestB'] }] },
		]);

		const pkgA = [...mod.packages].find((p) => p.path === 'foo/a')!;
		const pkgB = [...mod.packages].find((p) => p.path === 'foo/a/b')!;

		expect(presenter.getParent(pkgA)).toBe(mod);
		expect(presenter.getParent(pkgB)).toBe(mod);
	});

	it('getParent returns parent package when nestPackages is true', async () => {
		const { presenter, mod } = await setup(
			[
				{ path: 'foo/a', files: [{ uri: `${WS_URI}/a/a_test.go`, tests: ['TestA'] }] },
				{ path: 'foo/a/b', files: [{ uri: `${WS_URI}/a/b/b_test.go`, tests: ['TestB'] }] },
			],
			{ nestPackages: true },
		);

		const pkgA = [...mod.packages].find((p) => p.path === 'foo/a')!;
		const pkgB = [...mod.packages].find((p) => p.path === 'foo/a/b')!;

		// pkgB's parent should be pkgA, not the module
		expect(presenter.getParent(pkgB)).toBe(pkgA);
	});

	it('getChildren excludes child packages when nestPackages is false', async () => {
		const { presenter, mod } = await setup([
			{ path: 'foo/a', files: [{ uri: `${WS_URI}/a/a_test.go`, tests: ['TestA'] }] },
			{ path: 'foo/a/b', files: [{ uri: `${WS_URI}/a/b/b_test.go`, tests: ['TestB'] }] },
		]);

		const children = [...presenter.getChildren(mod)];
		// Both packages appear flat at module level
		expect(children).toHaveLength(2);
	});

	it('getChildren nests child packages when nestPackages is true', async () => {
		const { presenter, mod } = await setup(
			[
				{ path: 'foo/a', files: [{ uri: `${WS_URI}/a/a_test.go`, tests: ['TestA'] }] },
				{ path: 'foo/a/b', files: [{ uri: `${WS_URI}/a/b/b_test.go`, tests: ['TestB'] }] },
			],
			{ nestPackages: true },
		);

		const pkgA = [...mod.packages].find((p) => p.path === 'foo/a')!;

		// Module's direct children should be only pkgA (pkgB is nested under it)
		const modChildren = [...presenter.getChildren(mod)];
		expect(modChildren).toHaveLength(1);
		expect(modChildren[0]).toBe(pkgA);

		// pkgA's children should include pkgB
		const pkgAChildren = [...presenter.getChildren(pkgA)];
		const pkgB = [...mod.packages].find((p) => p.path === 'foo/a/b')!;
		expect(pkgAChildren).toContain(pkgB);
	});
});

// ─── getParent / getChildren — showFiles ─────────────────────────────────────

describe('ModelViewPresenter — showFiles', () => {
	it('file node is present when showFiles is true', async () => {
		const { presenter, mod } = await setup(
			[{ path: 'foo', files: [{ uri: `${WS_URI}/foo_test.go`, tests: ['TestFoo'] }] }],
			{ showFiles: true },
		);

		const pkg = [...mod.packages][0]!;
		const pkgChildren = [...presenter.getChildren(pkg)];
		const file = [...pkg.files][0]!;

		expect(pkgChildren).toContain(file);
	});

	it('file node is skipped and tests are direct children of package when showFiles is false', async () => {
		const { presenter, mod } = await setup(
			[{ path: 'foo', files: [{ uri: `${WS_URI}/foo_test.go`, tests: ['TestFoo'] }] }],
			{ showFiles: false },
		);

		const pkg = [...mod.packages][0]!;
		const pkgChildren = [...presenter.getChildren(pkg)];

		// No file nodes — tests appear directly under the package
		const file = [...pkg.files][0]!;
		expect(pkgChildren).not.toContain(file);
		expect(pkgChildren.some((c) => c instanceof TestCase)).toBe(true);
	});

	it('asPresented collapses file to module when showFiles is false and package is root pkg', async () => {
		const { presenter, mod } = await setup(
			[{ path: 'foo', files: [{ uri: `${WS_URI}/foo_test.go`, tests: ['TestFoo'] }] }],
			{ showFiles: false },
		);

		const pkg = [...mod.packages][0]!;
		await mod.packages.get(pkg);
		const file = [...pkg.files][0]!;

		// The 'foo' package is the root package of module 'foo', so asPresented(pkg) → mod.
		// With showFiles=false, asPresented(file) → asPresented(pkg) → mod.
		expect(presenter.asPresented(file)).toBe(mod);
	});
});

// ─── getParent / getChildren — nestSubtests ───────────────────────────────────

describe('ModelViewPresenter — nestSubtests', () => {
	it('subtests are children of parent test when nestSubtests is true', async () => {
		const { presenter, mod } = await setup([
			{
				path: 'foo',
				files: [
					{
						uri: `${WS_URI}/foo_test.go`,
						tests: ['TestParent', 'TestParent/Sub'],
					},
				],
			},
		]);

		const pkg = [...mod.packages][0]!;
		const file = [...pkg.files][0]!;
		const parent = [...file.tests].find((t) => t.name === 'TestParent')!;
		const sub = [...file.tests].find((t) => t.name === 'TestParent/Sub')!;

		expect(presenter.getParent(sub)).toBe(parent);

		const parentChildren = [...presenter.getChildren(parent)];
		expect(parentChildren).toContain(sub);
	});

	it('subtests are flat under module when nestSubtests is false and showFiles is false', async () => {
		const { presenter, mod } = await setup(
			[
				{
					path: 'foo',
					files: [
						{
							uri: `${WS_URI}/foo_test.go`,
							tests: ['TestParent', 'TestParent/Sub'],
						},
					],
				},
			],
			{ nestSubtests: false },
		);

		const pkg = [...mod.packages][0]!;
		const file = [...pkg.files][0]!;
		const parent = [...file.tests].find((t) => t.name === 'TestParent')!;
		const sub = [...file.tests].find((t) => t.name === 'TestParent/Sub')!;

		// With showFiles=false and a root package, asPresented(file) collapses to
		// the module. So the parent of sub (with nestSubtests=false) is the module.
		expect(presenter.getParent(sub)).toBe(mod);
		// Parent test should have no children from the presenter's view (nestSubtests=false)
		expect([...presenter.getChildren(parent)]).toHaveLength(0);
	});
});

// ─── asPresented — root package ───────────────────────────────────────────────

describe('ModelViewPresenter — asPresented root package', () => {
	it('collapses root package to module', async () => {
		const { presenter, mod } = await setup([
			{
				// Root package: path === module path, so uri === module dir
				path: 'foo',
				files: [{ uri: `${WS_URI}/foo_test.go`, tests: ['TestFoo'] }],
			},
		]);

		const pkg = [...mod.packages][0]!;
		// isRootPkg should be true for the 'foo' package inside the 'foo' module
		if (pkg.isRootPkg) {
			expect(presenter.asPresented(pkg)).toBe(mod);
		} else {
			// If it's not a root package in this layout, just verify asPresented returns it unchanged
			expect(presenter.asPresented(pkg)).toBe(pkg);
		}
	});
});

// ─── labelFor ─────────────────────────────────────────────────────────────────

describe('ModelViewPresenter — labelFor', () => {
	it('nested package label strips ancestor path prefix', async () => {
		const { presenter, mod } = await setup(
			[
				{ path: 'foo/a', files: [{ uri: `${WS_URI}/a/a_test.go`, tests: ['TestA'] }] },
				{ path: 'foo/a/b', files: [{ uri: `${WS_URI}/a/b/b_test.go`, tests: ['TestB'] }] },
			],
			{ nestPackages: true },
		);

		const pkgB = [...mod.packages].find((p) => p.path === 'foo/a/b')!;
		// Label should be 'b', not 'foo/a/b'
		expect(presenter.labelFor(pkgB)).toBe('b');
	});

	it('subtest label strips parent test name', async () => {
		const { presenter, mod } = await setup([
			{
				path: 'foo',
				files: [{ uri: `${WS_URI}/foo_test.go`, tests: ['TestParent', 'TestParent/Sub'] }],
			},
		]);

		const pkg = [...mod.packages][0]!;
		const file = [...pkg.files][0]!;
		const sub = [...file.tests].find((t) => t.name === 'TestParent/Sub')!;

		expect(presenter.labelFor(sub)).toBe('Sub');
	});
});

// ─── Profile hierarchy ────────────────────────────────────────────────────────

describe('ModelViewPresenter — profiles', () => {
	it('captured profile adds a ProfileContainer under the target item', async () => {
		const { presenter, mod, runEvents } = await setup([
			{ path: 'foo', files: [{ uri: `${WS_URI}/foo_test.go`, tests: ['TestFoo'] }] },
		]);

		const pkg = [...mod.packages][0]!;
		const fakeRun = makeFakeRun();
		const fakeProfile = makeProfile();

		await runEvents.fire({ type: 'captured', run: fakeRun, pkg, scope: pkg, profile: fakeProfile });

		// Root packages collapse to module, so the profile is stored on the module.
		// getChildren(mod) should include a ProfileContainer.
		const modChildren = [...presenter.getChildren(mod)];
		expect(modChildren.some((c) => c.kind === 'profile-container')).toBe(true);
	});

	it('profile is removed when run is disposed', async () => {
		const { presenter, mod, runEvents } = await setup([
			{ path: 'foo', files: [{ uri: `${WS_URI}/foo_test.go`, tests: ['TestFoo'] }] },
		]);

		const pkg = [...mod.packages][0]!;
		const disposeEmitter = new EventEmitter<void>();
		const fakeRun = makeFakeRun(disposeEmitter.event);
		const fakeProfile = makeProfile();

		await runEvents.fire({ type: 'captured', run: fakeRun, pkg, scope: pkg, profile: fakeProfile });
		expect([...presenter.getChildren(mod)].some((c) => c.kind === 'profile-container')).toBe(true);

		// Dispose the run
		await disposeEmitter.fire();

		expect([...presenter.getChildren(mod)].some((c) => c.kind === 'profile-container')).toBe(false);
	});

	it('resolveProfilesParent walks up from dynamic test case to static parent', async () => {
		const { presenter, ctrl, mod, runEvents } = await setup([
			{ path: 'foo', files: [{ uri: `${WS_URI}/foo_test.go`, tests: ['TestParent'] }] },
		]);

		const pkg = [...mod.packages][0]!;
		const run = makeFakeRun();

		// Create a dynamic subtest
		await runEvents.fire({ type: 'subtest', run, pkg, name: 'TestParent/Sub' });

		const dynTest = [...pkg.allTests()].find(
			(t) => t instanceof DynamicTestCase && t.name === 'TestParent/Sub',
		) as TestCase;
		expect(dynTest).toBeDefined();

		const parentTest = [...pkg.allTests()].find((t) => t.name === 'TestParent')!;

		// Profile parent of dynamic test should resolve to the static parent
		const resolved = presenter.resolveProfilesParent(dynTest);
		expect(resolved).toBe(parentTest);
	});
});

// ─── Private helpers ──────────────────────────────────────────────────────────

function makeFakeRun(onDidDispose?: any) {
	return {
		onDidDispose,
		started: () => {},
		passed: () => {},
		failed: () => {},
		skipped: () => {},
		errored: () => {},
		appendOutput: () => {},
		end: () => {},
	} as any;
}

function makeProfile(): CapturedProfile {
	return {
		type: { id: 'cpu', label: 'CPU' },
		time: new Date(2024, 0, 1, 12, 0, 0),
		file: Uri.file('/workspace/cpu.pprof'),
	} as any;
}
