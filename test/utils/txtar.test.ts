import { Uri } from 'vscode';
import { TxTar } from './txtar';
import { expect } from '@jest/globals';

const src = `
-- foo.go --
package foo

-- bar/bar.go --
package bar

-- bar/baz/baz.go --
package baz

`;

describe('TxTar', () => {
	it('can parse a txtar', async () => {
		const txtar = new TxTar(src, 'utf-8');
		let dir = await txtar.readDirectory(Uri.file('/'));
		expect(dir.map(([x]) => x)).toStrictEqual(['foo.go', 'bar']);

		dir = await txtar.readDirectory(Uri.file('/bar'));
		expect(dir.map(([x]) => x)).toStrictEqual(['bar.go', 'baz']);

		dir = await txtar.readDirectory(Uri.file('/bar/baz'));
		expect(dir.map(([x]) => x)).toStrictEqual(['baz.go']);

		let file = await txtar.readFile(Uri.file('/foo.go'));
		expect(Buffer.from(file).toString('utf-8')).toStrictEqual('package foo\n\n');

		file = await txtar.readFile(Uri.file('/bar/bar.go'));
		expect(Buffer.from(file).toString('utf-8')).toStrictEqual('package bar\n\n');

		file = await txtar.readFile(Uri.file('/bar/baz/baz.go'));
		expect(Buffer.from(file).toString('utf-8')).toStrictEqual('package baz\n\n');
	});
});
