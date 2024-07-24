/* eslint-disable n/no-unpublished-import */
import type * as lsp from 'vscode-languageserver-types';
import type { Commands } from '../../../src/test/testSupport';
import { TestHost, withConfiguration, withModule, withPackage, withWorkspace } from './host';
import { expect } from '@jest/globals';
import './expect';
import { Uri } from 'vscode';

const nullPos: lsp.Position = { line: 0, character: 0 };
const nullRange: lsp.Range = { start: nullPos, end: nullPos };

const fooMod: Commands.Module = {
	GoMod: 'file:///foo/go.mod',
	Path: 'foo'
};

const fooPkgNoMod: Commands.Package = {
	Path: 'foo',
	ForTest: 'foo',
	TestFiles: [
		{
			URI: 'file:///foo/foo_test.go',
			Tests: [{ Name: 'TestFoo', Loc: { uri: 'file:///foo/foo_test.go', range: nullRange } }]
		},
		{
			URI: 'file:///foo/foo_test2.go',
			Tests: [{ Name: 'TestFoo2', Loc: { uri: 'file:///foo/foo_test2.go', range: nullRange } }]
		}
	]
};
const fooPkg: Commands.Package = {
	...fooPkgNoMod,
	ModulePath: 'foo'
};

const barPkg: Commands.Package = {
	Path: 'foo/bar',
	ForTest: 'foo/bar',
	ModulePath: 'foo',
	TestFiles: [
		{
			URI: 'file:///foo/bar/bar_test.go',
			Tests: [{ Name: 'TestBar', Loc: { uri: 'file:///foo/bar/bar_test.go', range: nullRange } }]
		}
	]
};

describe('Go test controller', () => {
	it('resolves workspace tests', async () => {
		const host = new TestHost(withWorkspace('foo', 'file:///foo'), withPackage(fooPkgNoMod));

		await host.manager.reload();
		expect(host).toResolve([
			{
				kind: 'workspace',
				uri: 'file:///foo',
				children: [
					{ kind: 'test', name: 'TestFoo', uri: 'file:///foo/foo_test.go' },
					{ kind: 'test', name: 'TestFoo2', uri: 'file:///foo/foo_test2.go' }
				]
			}
		]);
	});

	it('resolves module tests', async () => {
		const host = new TestHost(withWorkspace('foo', 'file:///foo'), withModule(fooMod), withPackage(fooPkg));

		await host.manager.reload();
		expect(host).toResolve([
			{
				kind: 'module',
				uri: 'file:///foo/go.mod',
				children: [
					{ kind: 'test', name: 'TestFoo', uri: 'file:///foo/foo_test.go' },
					{ kind: 'test', name: 'TestFoo2', uri: 'file:///foo/foo_test2.go' }
				]
			}
		]);
	});

	describe('with showFiles', () => {
		it('resolves files', async () => {
			const host = new TestHost(
				withWorkspace('foo', 'file:///foo'),
				withConfiguration({ showFiles: true }),
				withModule(fooMod),
				withPackage(fooPkg)
			);

			await host.manager.reload();
			expect(host).toResolve([
				{
					kind: 'module',
					uri: 'file:///foo/go.mod',
					children: [
						{
							kind: 'file',
							uri: 'file:///foo/foo_test.go',
							children: [{ kind: 'test', name: 'TestFoo', uri: 'file:///foo/foo_test.go' }]
						},
						{
							kind: 'file',
							uri: 'file:///foo/foo_test2.go',
							children: [{ kind: 'test', name: 'TestFoo2', uri: 'file:///foo/foo_test2.go' }]
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
					uri: 'file:///foo/go.mod',
					children: [
						{ kind: 'test', name: 'TestFoo', uri: 'file:///foo/foo_test.go' },
						{ kind: 'test', name: 'TestFoo2', uri: 'file:///foo/foo_test2.go' }
					]
				}
			]);
		});
	});

	describe('without discovery', () => {
		it('resolves on-demand', async () => {
			const host = new TestHost(
				withWorkspace('foo', 'file:///foo'),
				withConfiguration({ discovery: 'off' }),
				withModule(fooMod),
				withPackage(fooPkg),
				withPackage(barPkg)
			);

			// Nothing is resolved initially
			await host.manager.reload();
			expect(host).toResolve([]);

			// Opening a file (which calls reload) causes the tests within it to be resolved
			await host.manager.reload(Uri.parse('file:///foo/bar/bar_test.go'));
			expect(host).toResolve([
				{
					kind: 'module',
					uri: 'file:///foo/go.mod',
					children: [
						{
							kind: 'package',
							uri: 'file:///foo/bar',
							children: [{ kind: 'test', name: 'TestBar', uri: 'file:///foo/bar/bar_test.go' }]
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
					uri: 'file:///foo/go.mod',
					children: [
						{
							kind: 'package',
							uri: 'file:///foo/bar',
							children: [{ kind: 'test', name: 'TestBar', uri: 'file:///foo/bar/bar_test.go' }]
						},
						{ kind: 'test', name: 'TestFoo', uri: 'file:///foo/foo_test.go' },
						{ kind: 'test', name: 'TestFoo2', uri: 'file:///foo/foo_test2.go' }
					]
				}
			]);

			host.workspace.config.discovery = 'off';
			await host.manager.reload();
			expect(host).toResolve([
				{
					kind: 'module',
					uri: 'file:///foo/go.mod',
					children: [
						{
							kind: 'package',
							uri: 'file:///foo/bar',
							children: [{ kind: 'test', name: 'TestBar', uri: 'file:///foo/bar/bar_test.go' }]
						}
					]
				}
			]);
		});
	});
});
