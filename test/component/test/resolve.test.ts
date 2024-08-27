/* eslint-disable n/no-unpublished-import */
import { TestHost, withConfiguration, withWorkspace } from './host';
import { afterAll, beforeAll, expect } from '@jest/globals';
import './expect';
import { Uri } from 'vscode';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { TxTar } from '../../utils/txtar';

describe('Go test controller', () => {
	// NOTE: These tests assume ~/go/bin/gopls exists and has test support

	describe('with no module', () => {
		const ws = setupWorkspace(
			`-- go.mod --
			module foo

			-- foo/foo.go --
			package foo

			-- foo/foo_test.go --
			package foo

			import "testing"

			func TestFoo(t *testing.T)`,

			'foo'
		);

		it('resolves tests', async () => {
			const host = new TestHost(ws.path, withWorkspace('foo', `${ws.uri}`));

			await host.manager.reload();
			expect(host).toResolve([
				{
					kind: 'workspace',
					uri: `${ws.uri}`,
					children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }]
				}
			]);
		});
	});

	describe('with a simple module', () => {
		const ws = setupWorkspace(`
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
			const host = new TestHost(ws.path, withWorkspace('foo', `${ws.uri}`));

			await host.manager.reload();
			expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${ws.uri}/bar`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }]
						},
						{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }
					]
				}
			]);
		});

		describe('with showFiles', () => {
			it('resolves files', async () => {
				const host = new TestHost(
					ws.path,
					withWorkspace('foo', `${ws.uri}`),
					withConfiguration({ showFiles: true })
				);

				await host.manager.reload();
				expect(host).toResolve([
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
										children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }]
									}
								]
							},
							{
								kind: 'file',
								uri: `${ws.uri}/foo_test.go`,
								children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }]
							}
						]
					}
				]);

				// Changing config changes the resolved tests
				host.workspace.config.showFiles = false;
				await host.manager.reload();
				expect(host).toResolve([
					{
						kind: 'module',
						uri: `${ws.uri}/go.mod`,
						children: [
							{
								kind: 'package',
								uri: `${ws.uri}/bar`,
								children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }]
							},
							{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }
						]
					}
				]);
			});
		});

		describe('without discovery', () => {
			it('resolves on-demand', async () => {
				const host = new TestHost(
					ws.path,
					withWorkspace('foo', `${ws.uri}`),
					withConfiguration({ discovery: 'off' })
				);

				// Nothing is resolved initially
				await host.manager.reload();
				expect(host).toResolve([]);

				// Opening a file (which calls reload) causes the tests within it to be resolved
				await host.manager.reload(Uri.parse(`${ws.uri}/bar/bar_test.go`));
				expect(host).toResolve([
					{
						kind: 'module',
						uri: `${ws.uri}/go.mod`,
						children: [
							{
								kind: 'package',
								uri: `${ws.uri}/bar`,
								children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }]
							}
						]
					}
				]);

				// Toggling the config behaves preserves which files have been opened
				host.workspace.config.discovery = 'on';
				await host.manager.reload();
				expect(host).toResolve([
					{
						kind: 'module',
						uri: `${ws.uri}/go.mod`,
						children: [
							{
								kind: 'package',
								uri: `${ws.uri}/bar`,
								children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }]
							},
							{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }
						]
					}
				]);

				host.workspace.config.discovery = 'off';
				await host.manager.reload();
				expect(host).toResolve([
					{
						kind: 'module',
						uri: `${ws.uri}/go.mod`,
						children: [
							{
								kind: 'package',
								uri: `${ws.uri}/bar`,
								children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }]
							}
						]
					}
				]);
			});
		});

		describe('with nestPackages', () => {
			const ws = setupWorkspace(`
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

			it('resolves tests in nested packages', async () => {
				const host = new TestHost(
					ws.path,
					withWorkspace('foo', `${ws.uri}`),
					withConfiguration({ nestPackages: true })
				);

				await host.manager.reload();
				expect(host).toResolve([
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
										children: [
											{ kind: 'test', name: 'TestBaz', uri: `${ws.uri}/bar/baz/baz_test.go` }
										]
									}
								]
							}
						]
					}
				]);

				// Changing config changes the resolved tests
				host.workspace.config.nestPackages = false;
				await host.manager.reload();
				expect(host).toResolve([
					{
						kind: 'module',
						uri: `${ws.uri}/go.mod`,
						children: [
							{
								kind: 'package',
								uri: `${ws.uri}/bar`,
								children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }]
							},
							{
								kind: 'package',
								uri: `${ws.uri}/bar/baz`,
								children: [{ kind: 'test', name: 'TestBaz', uri: `${ws.uri}/bar/baz/baz_test.go` }]
							}
						]
					}
				]);
			});
		});
	});

	describe.skip('with a nested module', () => {
		// Testing this with the current setup is not feasible since gopls is
		// called with `cd <dir> && gopls execute <command> <args>`, and thus
		// gopls will only ever have one view loaded at a time

		const ws = setupWorkspace(`
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
			const host = new TestHost(ws.path, withWorkspace('foo', `${ws.uri}`));

			await host.manager.reload();
			expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }]
				}
			]);
		});

		it('resolves tests when a file in the module is opened', async () => {
			const host = new TestHost(ws.path, withWorkspace('foo', `${ws.uri}`));

			await host.manager.reload(Uri.parse(`${ws.uri}/bar/bar.go`));
			expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` }]
				},
				{
					kind: 'module',
					uri: `${ws.uri}/bar/go.mod`,
					children: [{ kind: 'test', name: 'TestBar', uri: `${ws.uri}/bar/bar_test.go` }]
				}
			]);
		});
	});

	describe('with all test func types', () => {
		const ws = setupWorkspace(`
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
			const host = new TestHost(ws.path, withWorkspace('foo', `${ws.uri}`));

			await host.manager.reload();
			expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{ kind: 'benchmark', name: 'BenchmarkBaz', uri: `${ws.uri}/foo_test.go` },
						{ kind: 'example', name: 'ExampleBaz', uri: `${ws.uri}/foo_test.go` },
						{ kind: 'fuzz', name: 'FuzzBaz', uri: `${ws.uri}/foo_test.go` },
						{ kind: 'test', name: 'TestBaz', uri: `${ws.uri}/foo_test.go` }
					]
				}
			]);
		});
	});

	describe('with subtests', () => {
		const ws = setupWorkspace(`
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
			const host = new TestHost(ws.path, withWorkspace('foo', `${ws.uri}`));

			await host.manager.reload();
			expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{
							kind: 'test',
							name: 'TestFoo',
							uri: `${ws.uri}/foo_test.go`,
							children: [{ kind: 'test', name: 'TestFoo/Subtest', uri: `${ws.uri}/foo_test.go` }]
						}
					]
				}
			]);

			// Changing config changes the resolved tests
			host.workspace.config.nestSubtests = false;
			await host.manager.reload();
			expect(host).toResolve([
				{
					kind: 'module',
					uri: `${ws.uri}/go.mod`,
					children: [
						{ kind: 'test', name: 'TestFoo', uri: `${ws.uri}/foo_test.go` },
						{ kind: 'test', name: 'TestFoo/Subtest', uri: `${ws.uri}/foo_test.go` }
					]
				}
			]);
		});
	});

	// ...
});

/**
 * Dumps the txtar to a temp directory and deletes it afterwards.
 * @param src The txtar source
 * @returns The temp directory and URI
 */
function setupWorkspace(src: string, wsdir?: string) {
	const ws = {
		path: '',
		uri: Uri.file('')
	};

	// Remove common leading whitespace
	const lines = src.split('\n');
	const checkLines = lines.filter((l, i) => i > 0 && /\S/.test(l));
	let i = 0;
	for (; ; i++) {
		const s = checkLines.map((l) => l.substring(i, i + 1));
		if (s.some((s) => !/^\s*$/.test(s)) && new Set(s).size !== 1) {
			break;
		}
	}
	src = lines.map((l) => l.replace(/^\s*/, (s) => (s.length > i ? s.substring(i) : ''))).join('\n');

	beforeAll(async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'jest-'));
		ws.path = wsdir ? path.join(tmp, wsdir) : tmp;
		ws.uri = Uri.file(ws.path);
		console.log('Workspace:', ws.path);

		const txtar = new TxTar(src);
		await txtar.copyTo(tmp);
	});

	afterAll(async () => {
		await fs.rm(ws.path, { force: true, recursive: true });
	});

	return ws;
}
