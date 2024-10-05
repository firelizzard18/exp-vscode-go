/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable n/no-unpublished-import */
import { TestHost, withConfiguration, withWorkspace } from './host';
import { expect } from '@jest/globals';
import './expect';
import { Uri } from 'vscode';
import { Workspace } from '../../utils/txtar';
import { Module, Package, TestCase } from '../../../src/test/item';

describe('Test resolver', () => {
	// NOTE: These tests assume ~/go/bin/gopls exists and has test support

	describe('with no module', () => {
		const ws = Workspace.setup(
			`-- go.mod --
			module foo

			-- foo/foo.go --
			package foo

			-- foo/foo_test.go --
			package foo

			import "testing"

			func TestFoo(t *testing.T)`,

			'foo',
		);

		it('resolves tests', async () => {
			const host = await TestHost.setup(ws.path, withWorkspace('foo', `${ws.uri}`));

			await expect(host).toResolve([
				{
					kind: 'workspace',
					uri: `${ws.uri}`,
					children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }],
				},
			]);
		});
	});

	describe('with a simple module', () => {
		const ws = Workspace.setup(`
			-- go.mod --
			module foo

			-- foo.go --
			package foo

			-- foo_test.go --
			package foo

			import "testing"

			func TestFoo(t *testing.T)

			-- bar/bar_test.go --
			package bar

			import "testing"

			func TestBar(*testing.T)
		`);

		it('resolves all tests', async () => {
			const host = await TestHost.setup(ws.path, withWorkspace('foo', `${ws.uri}`));

			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
						{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` },
					],
				},
			]);
		});

		it('resolves files with showFiles', async () => {
			const host = await TestHost.setup(
				ws.path,
				withWorkspace('foo', `${ws.uri}`),
				withConfiguration({ showFiles: true }),
			);

			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [
								{
									kind: 'file',
									uri: `${ws.uri}/bar/bar_test.go`,
									children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
								},
							],
						},
						{
							kind: 'file',
							uri: `${ws.uri}/foo_test.go`,
							children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }],
						},
					],
				},
			]);

			// Changing config changes the resolved tests
			host.workspace.config.showFiles = false;
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
						{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` },
					],
				},
			]);
		});

		it('resolves on-demand without discovery', async () => {
			const host = await TestHost.setup(
				ws.path,
				withWorkspace('foo', `${ws.uri}`),
				withConfiguration({ discovery: 'off' }),
			);

			// Nothing is resolved initially
			await expect(host).toResolve([]);

			// Opening a file (which calls reload) causes the tests within it to be resolved
			await host.manager.reloadUri(Uri.parse(`${ws.uri}/bar/bar_test.go`));
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
					],
				},
			]);

			// Toggling the config behaves preserves which files have been opened
			host.workspace.config.discovery = 'on';
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
						{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` },
					],
				},
			]);

			host.workspace.config.discovery = 'off';
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
					],
				},
			]);
		});

		it('does not recreate items when reloading', async () => {
			const host = await TestHost.setup(ws.path, withWorkspace('foo', `${ws.uri}`));

			await host.manager.reloadView();
			const bMod = isa(Module, (await host.manager.rootGoTestItems)[0]);
			const bPkg = isa(Package, (await bMod.getPackages())[0]);
			const bTest = bPkg.getTests()?.[0];
			expect(bTest).toBeDefined();

			await host.manager.reloadView();
			const aMod = isa(Module, (await host.manager.rootGoTestItems)[0]);
			const aPkg = isa(Package, (await aMod.getPackages())[0]);
			const aTest = aPkg.getTests()?.[0];
			if (!Object.is(aMod, bMod)) throw new Error('Reloading recreated the module');
			if (!Object.is(aPkg, bPkg)) throw new Error('Reloading recreated the package');
			if (!Object.is(aTest, bTest)) throw new Error('Reloading recreated the test');
		});

		it('shows dynamic subtests', async () => {
			const host = await TestHost.setup(ws.path, withWorkspace('foo', `${ws.uri}`));

			const items = await (await host.manager.rootGoTestItems)[0]?.getChildren();
			const tc = items.find((x) => x.label === 'TestFoo') as TestCase;
			expect(tc).toBeDefined();
			expect(tc).toBeInstanceOf(TestCase);

			await host.manager.reloadGoItem(tc.file.package.findTest('TestFoo/Bar', true)!);
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
						{
							kind: 'test',
							name: 'TestFoo',
							uri: `${ws.uri}/foo_test.go`,
							children: [{ kind: 'test', name: 'TestFoo/Bar', uri: `${ws.uri}/foo_test.go` }],
						},
					],
				},
			]);
		});

		it('resets dynamic subtests between runs', async () => {
			const host = await TestHost.setup(ws.path, withWorkspace('foo', `${ws.uri}`));

			const items = await (await host.manager.rootGoTestItems)[0]?.getChildren();
			const tc = items.find((x) => x.label === 'TestFoo') as TestCase;
			expect(tc).toBeDefined();
			expect(tc).toBeInstanceOf(TestCase);

			await host.manager.reloadGoItem(tc.file.package.findTest('TestFoo/Bar', true)!);
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
						{
							kind: 'test',
							name: 'TestFoo',
							uri: `${ws.uri}/foo_test.go`,
							children: [{ kind: 'test', name: 'TestFoo/Bar', uri: `${ws.uri}/foo_test.go` }],
						},
					],
				},
			]);

			tc.removeDynamicTestCases();
			await host.manager.reloadGoItem(tc.file.package.findTest('TestFoo/Baz', true)!);
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
						{
							kind: 'test',
							name: 'TestFoo',
							uri: `${ws.uri}/foo_test.go`,
							children: [{ kind: 'test', name: 'TestFoo/Baz', uri: `${ws.uri}/foo_test.go` }],
						},
					],
				},
			]);
		});

		it('omits excluded files', async () => {
			const host = await TestHost.setup(
				ws.path,
				withWorkspace('foo', `${ws.uri}`),
				withConfiguration({ exclude: { 'foo_test.go': true } }),
			);

			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
					],
				},
			]);

			// Changing config changes the resolved tests
			host.workspace.config.exclude = {};
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
						{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` },
					],
				},
			]);
		});

		it('omits excluded packages', async () => {
			const host = await TestHost.setup(
				ws.path,
				withWorkspace('foo', `${ws.uri}`),
				withConfiguration({ exclude: { 'bar/**': true } }),
			);

			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }],
				},
			]);

			// Changing config changes the resolved tests
			host.workspace.config.exclude = {};
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
						{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` },
					],
				},
			]);
		});

		it('ignores disabled exclusions', async () => {
			const host = await TestHost.setup(
				ws.path,
				withWorkspace('foo', `${ws.uri}`),
				withConfiguration({ exclude: { 'foo_test.go': false } }),
			);

			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
						{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` },
					],
				},
			]);
		});
	});

	describe('with a nested package', () => {
		const ws = Workspace.setup(`
			-- go.mod --
			module foo

			-- bar/bar.go --
			package bar

			-- bar/bar_test.go --
			package bar

			import "testing"

			func TestBar(t *testing.T)

			-- bar/baz/baz.go --
			package baz

			-- bar/baz/baz_test.go --
			package baz

			import "testing"

			func TestBaz(t *testing.T)
		`);

		it('resolves tests in nested packages with nestPackages', async () => {
			const host = await TestHost.setup(
				ws.path,
				withWorkspace('foo', `${ws.uri}`),
				withConfiguration({ nestPackages: true }),
			);

			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [
								{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` },
								{
									kind: 'package',
									uri: `${ws.uri}/bar/baz`,
									children: [{ kind: 'test', name: 'TestBaz', uri: `${ws.uri}/bar/baz/baz_test.go` }],
								},
							],
						},
					],
				},
			]);

			// Changing config changes the resolved tests
			host.workspace.config.nestPackages = false;
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
						},
						{
							kind: 'package',
							uri: `${ws.uri}/bar/baz`,
							children: [{ kind: 'test', name: 'TestBaz', uri: `${ws.uri}/bar/baz/baz_test.go` }],
						},
					],
				},
			]);
		});
	});

	describe.skip('with a nested module', () => {
		// Testing this with the current setup is not feasible since gopls is
		// called with `cd <dir> && gopls execute <command> <args>`, and thus
		// gopls will only ever have one view loaded at a time

		const ws = Workspace.setup(`
			-- go.mod --
			module foo

			-- foo.go --
			package foo

			-- foo_test.go --
			package foo

			import "testing"

			func TestFoo(t *testing.T)

			-- bar/go.mod --
			module foo/bar

			-- bar/bar.go --
			package bar

			-- bar/bar_test.go --
			package bar

			import "testing"

			func TestBar(t *testing.T)
		`);

		it('does not cross module boundaries', async () => {
			const host = await TestHost.setup(ws.path, withWorkspace('foo', `${ws.uri}`));

			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }],
				},
			]);
		});

		it('resolves tests when a file in the module is opened', async () => {
			const host = await TestHost.setup(ws.path, withWorkspace('foo', `${ws.uri}`));

			await host.manager.reloadUri(Uri.parse(`${ws.uri}/bar/bar.go`));
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }],
				},
				{
					kind: 'module',
					uri: `${ws.uri}/bar/go.mod`,
					children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
				},
			]);
		});

		it('omits excluded modules', async () => {
			const host = await TestHost.setup(
				ws.path,
				withWorkspace('foo', `${ws.uri}`),
				withConfiguration({ exclude: { 'bar/**': true } }),
			);

			await host.manager.reloadUri(Uri.parse(`${ws.uri}/bar/bar.go`));
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }],
				},
			]);

			// Changing config changes the resolved tests
			host.workspace.config.exclude = {};
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }],
				},
				{
					kind: 'module',
					uri: `${ws.uri}/bar/go.mod`,
					children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }],
				},
			]);
		});
	});

	describe('with all test func types', () => {
		const ws = Workspace.setup(`
			-- go.mod --
			module foo

			-- foo.go --
			package foo

			-- foo_test.go --
			package foo

			import "testing"

			func TestBaz(*testing.T)      {}
			func BenchmarkBaz(*testing.B) {}
			func FuzzBaz(*testing.F)      {}
			func ExampleBaz()             {}
		`);

		it('resolves all test funcs', async () => {
			const host = await TestHost.setup(ws.path, withWorkspace('foo', `${ws.uri}`));

			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{ kind: 'benchmark', name: 'BenchmarkBaz', uri: `${ws.uri}/foo_test.go` },
						{ kind: 'example', name: 'ExampleBaz', uri: `${ws.uri}/foo_test.go` },
						{ kind: 'fuzz', name: 'FuzzBaz', uri: `${ws.uri}/foo_test.go` },
						{ kind: 'test', name: 'TestBaz', uri: `${ws.uri}/foo_test.go` },
					],
				},
			]);
		});
	});

	describe('with subtests', () => {
		const ws = Workspace.setup(`
			-- go.mod --
			module foo

			-- foo.go --
			package foo

			-- foo_test.go --
			package foo

			import "testing"

			func TestFoo(t *testing.T) {
				t.Run("Subtest", func(t *testing.T) {})
			}
		`);

		it('nests subtests', async () => {
			const host = await TestHost.setup(ws.path, withWorkspace('foo', `${ws.uri}`));

			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'test',
							name: 'TestFoo',
							uri: `${ws.uri}/foo_test.go`,
							children: [{ kind: 'test', name: 'TestFoo/Subtest', uri: `${ws.uri}/foo_test.go` }],
						},
					],
				},
			]);

			// Changing config changes the resolved tests
			host.workspace.config.nestSubtests = false;
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` },
						{ kind: 'test', name: 'TestFoo/Subtest', uri: `${ws.uri}/foo_test.go` },
					],
				},
			]);
		});
	});

	describe('when updating a file', () => {
		const ws = Workspace.setup(`
				-- go.mod --
				module foo

				-- foo.go --
				package foo

				-- foo_test.go --
				package foo

				import "testing"

				func TestFoo(t *testing.T) {}
			`);

		it('detects new tests', async () => {
			const host = await TestHost.setup(ws.path, withWorkspace('foo', `${ws.uri}`));

			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }],
				},
			]);

			await ws.writeFile(
				'foo_test.go',
				`
				package foo

				import "testing"

				func TestFoo(t *testing.T) {}
				func TestBar(t *testing.T) {}`,
			);
			await host.manager.reloadUri(Uri.parse(`${ws.uri}/foo_test.go`), [], true);
			await expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/foo_test.go` },
						{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` },
					],
				},
			]);
		});
	});
});

function isa<T extends new (...args: any[]) => any>(expected: T, value: any): InstanceType<T> {
	expect(value).toBeDefined();
	expect(value).toBeInstanceOf(expected);
	return value as InstanceType<T>;
}
