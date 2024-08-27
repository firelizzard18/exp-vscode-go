/* eslint-disable n/no-unpublished-import */
import { TestHost, withConfiguration, withWorkspace } from './host';
import { afterAll, beforeAll, expect } from '@jest/globals';
import './expect';
import { Uri } from 'vscode';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { TxTar } from '../../utils/txtar';

const src = `
-- go.mod --
module foo

go 1.20

-- foo.go --
package foo

import "fmt"

func Foo() {
	fmt.Println("Foo")
}

func TestFoo2(t *testing.T) {
	Foo()
}

-- foo_test.go --
package foo

import "testing"

func callFoo() {
	Foo()
}

func TestFoo(t *testing.T) {
	callFoo()
}

-- foo2_test.go --
package foo_test

import "testing"

func TestBar(t *testing.T) {
	Foo()
}

-- baz/baz_test.go --
package baz

import "testing"

func TestBaz(*testing.T)      {}
func BenchmarkBaz(*testing.B) {}
func FuzzBaz(*testing.F)      {}
func ExampleBaz()             {}

-- bat/go.mod --
module bat

-- bat/bat_test.go --
package bat

import "testing"

func TestBat(*testing.T) {}
`;

describe('Go test controller', () => {
	// NOTE: These tests assume ~/go/bin/gopls exists and has test support

	// Dump the txtar to a temp directory and delete it afterwards
	let tmpdir: string, tmpdirUri: Uri;
	beforeAll(async () => {
		tmpdir = await fs.mkdtemp(path.join(os.tmpdir(), 'jest-'));
		tmpdirUri = Uri.file(tmpdir);

		const txtar = new TxTar(src);
		await txtar.copyTo(tmpdir);
	});

	afterAll(async () => {
		await fs.rm(tmpdir, { force: true, recursive: true });
	});

	it.skip('resolves workspace tests', async () => {
		const host = new TestHost(tmpdir, withWorkspace('foo', `${tmpdirUri}`));
		console.log(tmpdir);

		await host.manager.reload();
		expect(host).toResolve([
			{
				kind: 'workspace',
				uri: `${tmpdirUri}`,
				children: [
					{ kind: 'test', name: 'TestFoo', uri: `${tmpdirUri}/foo_test.go` },
					{ kind: 'test', name: 'TestFoo2', uri: `${tmpdirUri}/foo_test2.go` }
				]
			}
		]);
	});

	it('resolves module tests', async () => {
		const host = new TestHost(tmpdir, withWorkspace('foo', `${tmpdirUri}`));

		await host.manager.reload();
		expect(host).toResolve([
			{
				kind: 'module',
				uri: `${tmpdirUri}/go.mod`,
				children: [
					{
						kind: 'package',
						uri: `${tmpdirUri}/baz`,
						children: [
							{ kind: 'benchmark', name: 'BenchmarkBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
							{ kind: 'example', name: 'ExampleBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
							{ kind: 'fuzz', name: 'FuzzBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
							{ kind: 'test', name: 'TestBaz', uri: `${tmpdirUri}/baz/baz_test.go` }
						]
					},
					{ kind: 'test', name: 'TestFoo', uri: `${tmpdirUri}/foo_test.go` },
					{ kind: 'test', name: 'TestBar', uri: `${tmpdirUri}/foo2_test.go` }
				]
			}
		]);
	});

	describe('with showFiles', () => {
		it('resolves files', async () => {
			const host = new TestHost(
				tmpdir,
				withWorkspace('foo', `${tmpdirUri}`),
				withConfiguration({ showFiles: true })
			);

			await host.manager.reload();
			expect(host).toResolve([
				{
					kind: 'module',
					uri: `${tmpdirUri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${tmpdirUri}/baz`,
							children: [
								{
									kind: 'file',
									uri: `${tmpdirUri}/baz/baz_test.go`,
									children: [
										{
											kind: 'benchmark',
											name: 'BenchmarkBaz',
											uri: `${tmpdirUri}/baz/baz_test.go`
										},
										{ kind: 'example', name: 'ExampleBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
										{ kind: 'fuzz', name: 'FuzzBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
										{ kind: 'test', name: 'TestBaz', uri: `${tmpdirUri}/baz/baz_test.go` }
									]
								}
							]
						},
						{
							kind: 'file',
							uri: `${tmpdirUri}/foo_test.go`,
							children: [{ kind: 'test', name: 'TestFoo', uri: `${tmpdirUri}/foo_test.go` }]
						},
						{
							kind: 'file',
							uri: `${tmpdirUri}/foo2_test.go`,
							children: [{ kind: 'test', name: 'TestBar', uri: `${tmpdirUri}/foo2_test.go` }]
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
					uri: `${tmpdirUri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${tmpdirUri}/baz`,
							children: [
								{ kind: 'benchmark', name: 'BenchmarkBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'example', name: 'ExampleBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'fuzz', name: 'FuzzBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'test', name: 'TestBaz', uri: `${tmpdirUri}/baz/baz_test.go` }
							]
						},
						{ kind: 'test', name: 'TestFoo', uri: `${tmpdirUri}/foo_test.go` },
						{ kind: 'test', name: 'TestBar', uri: `${tmpdirUri}/foo2_test.go` }
					]
				}
			]);
		});
	});

	describe('without discovery', () => {
		it('resolves on-demand', async () => {
			const host = new TestHost(
				tmpdir,
				withWorkspace('foo', `${tmpdirUri}`),
				withConfiguration({ discovery: 'off' })
			);

			// Nothing is resolved initially
			await host.manager.reload();
			expect(host).toResolve([]);

			// Opening a file (which calls reload) causes the tests within it to be resolved
			await host.manager.reload(Uri.parse(`${tmpdirUri}/baz/baz_test.go`));
			expect(host).toResolve([
				{
					kind: 'module',
					uri: `${tmpdirUri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${tmpdirUri}/baz`,
							children: [
								{ kind: 'benchmark', name: 'BenchmarkBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'example', name: 'ExampleBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'fuzz', name: 'FuzzBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'test', name: 'TestBaz', uri: `${tmpdirUri}/baz/baz_test.go` }
							]
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
					uri: `${tmpdirUri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${tmpdirUri}/baz`,
							children: [
								{ kind: 'benchmark', name: 'BenchmarkBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'example', name: 'ExampleBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'fuzz', name: 'FuzzBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'test', name: 'TestBaz', uri: `${tmpdirUri}/baz/baz_test.go` }
							]
						},
						{ kind: 'test', name: 'TestFoo', uri: `${tmpdirUri}/foo_test.go` },
						{ kind: 'test', name: 'TestBar', uri: `${tmpdirUri}/foo2_test.go` }
					]
				}
			]);

			host.workspace.config.discovery = 'off';
			await host.manager.reload();
			expect(host).toResolve([
				{
					kind: 'module',
					uri: `${tmpdirUri}/go.mod`,
					children: [
						{
							kind: 'package',
							uri: `${tmpdirUri}/baz`,
							children: [
								{ kind: 'benchmark', name: 'BenchmarkBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'example', name: 'ExampleBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'fuzz', name: 'FuzzBaz', uri: `${tmpdirUri}/baz/baz_test.go` },
								{ kind: 'test', name: 'TestBaz', uri: `${tmpdirUri}/baz/baz_test.go` }
							]
						}
					]
				}
			]);
		});
	});
});
