/* eslint-disable n/no-unpublished-import */
import type * as lsp from 'vscode-languageserver-types';
import type { Commands } from '../../../src/test/testSupport';
import { MockTestController, TestHost } from './host';
import { GoTestController } from '../../../src/test/GoTestController';
import { Uri } from 'vscode';
import assert from 'assert';
import { GoTestItem } from '../../../src/test/GoTestItem';

type Mod = Commands.Module;
type Pkg = Commands.Package;
type TF = Commands.TestFile;
type TC = Commands.TestCase;

const nullPos: lsp.Position = { line: 0, character: 0 };
const nullRange: lsp.Range = { start: nullPos, end: nullPos };

const fooGoModUri = 'file:///foo/go.mod';
const fooMod: Mod = { GoMod: fooGoModUri, Path: 'foo' };

const fooFileUri = 'file:///foo/foo_test.go';
const testFoo: TC = { Name: 'TestFoo', Loc: { uri: fooFileUri, range: nullRange } };
const fooFile: TF = { URI: fooFileUri, Tests: [testFoo] };
const fooPkg: Pkg = { Path: 'foo', ForTest: 'foo', ModulePath: 'foo', TestFiles: [fooFile] };

describe('Go test controller', () => {
	it('resolves tests', async () => {
		const host = new TestHost();
		host.workspace.workspaceFolders = [{ name: 'foo', uri: Uri.parse('file:///foo'), index: 0 }];
		host.commands.packages = () => Promise.resolve({ Module: { foo: fooMod }, Packages: [fooPkg] });

		const ctrl = new MockTestController();
		const x = new GoTestController(host);
		x.setup({ createController: () => ctrl });
		await x.reload();

		// Give the async events some time to resolve
		await new Promise((r) => setTimeout(r, 1));

		const rootItems = [...ctrl.items].map(([, item]) => item);
		assert.equal(rootItems.length, 1);
		let id = GoTestItem.parseId(rootItems[0].id);
		assert.equal(id.kind, 'workspace');

		const pkgItems = [...rootItems[0].children].map(([, item]) => item);
		assert.equal(pkgItems.length, 1);
		id = GoTestItem.parseId(pkgItems[0].id);
		assert.equal(id.kind, 'test');
	});
});
