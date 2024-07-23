/* eslint-disable n/no-unpublished-import */
import type * as lsp from 'vscode-languageserver-types';
import type { Commands } from '../../../src/test/testSupport';
import { ExpectedTestItem, HostConfig, makeHost, withModule, withPackage, withWorkspace } from './host';

const nullPos: lsp.Position = { line: 0, character: 0 };
const nullRange: lsp.Range = { start: nullPos, end: nullPos };

const fooMod: Commands.Module = {
	GoMod: 'file:///foo/go.mod',
	Path: 'foo'
};

const fooPkgNoMod = {
	Path: 'foo',
	ForTest: 'foo',
	TestFiles: [
		{
			URI: 'file:///foo/foo_test.go',
			Tests: [{ Name: 'TestFoo', Loc: { uri: 'file:///foo/foo_test.go', range: nullRange } }]
		}
	]
};
const fooPkg: Commands.Package = {
	...fooPkgNoMod,
	ModulePath: 'foo'
};

describe('Go test controller', () => {
	it('resolves workspace tests', () =>
		expectHost(withWorkspace('foo', 'file:///foo'), withPackage(fooPkgNoMod)).toResolve([
			{
				kind: 'workspace',
				uri: 'file:///foo',
				children: [
					{
						kind: 'test',
						uri: 'file:///foo/foo_test.go'
					}
				]
			}
		]));

	it('resolves module tests', () =>
		expectHost(withWorkspace('foo', 'file:///foo'), withModule(fooMod), withPackage(fooPkg)).toResolve([
			{
				kind: 'module',
				uri: 'file:///foo/go.mod',
				children: [
					{
						kind: 'test',
						uri: 'file:///foo/foo_test.go'
					}
				]
			}
		]));
});

function expectHost(...config: HostConfig[]) {
	const { ctrl, goCtrl } = makeHost(...config);

	return new (class Expecter {
		async toResolve(expected: ExpectedTestItem[]) {
			await goCtrl.reload();
			expect(ctrl).toResolve(expected);
		}
	})();
}
