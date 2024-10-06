import path from 'node:path';
import { Location, Range, StatementCoverage, Uri } from 'vscode';
import { Context } from './testing';
import { Module, RootItem } from './item';

export async function parseCoverage(context: Context, scope: RootItem, coverageFile: Uri) {
	const lines = Buffer.from(await context.workspace.fs.readFile(coverageFile))
		.toString('utf-8')
		.split('\n');

	// The first line will be like "mode: set" which we will ignore.
	const coverage = new Map<string, StatementCoverage[]>();
	for (const line of lines.slice(1)) {
		// go test's output format is:
		//    Filename:StartLine.StartColumn,EndLine.EndColumn Hits CoverCount
		// where the filename is either the import path + '/' + base file name, or
		// the actual file path (either absolute or starting with .)
		// See https://golang.org/issues/40251.

		const parse = parseLine(scope, line);
		if (!parse) continue;

		const statements = coverage.get(`${parse.location.uri}`) || [];
		coverage.set(`${parse.location.uri}`, statements);
		statements.push(new StatementCoverage(parse.count, parse.location.range));
	}

	return coverage;
}

// Derived from https://golang.org/cl/179377
function parseLine(scope: RootItem, s: string) {
	const seek = (sep: string, offset: number = 0) => {
		const i = s.lastIndexOf(sep);
		if (i < 0) return;
		const n = parseInt(s.substring(i + 1), 10);
		if (isNaN(n)) return;
		s = s.substring(0, i).trim();
		return n + offset;
	};

	const count = seek(' ');
	const statements = seek(' ');
	const endCol = seek('.', -1);
	const endLine = seek(',', -1);
	const startCol = seek('.', -1);
	const startLine = seek(':', -1);
	if (
		count === undefined ||
		statements === undefined ||
		endCol === undefined ||
		endLine === undefined ||
		startCol === undefined ||
		startLine === undefined
	) {
		return;
	}

	let filename = s;
	if (filename.startsWith('.' + path.sep)) {
		// If it's a relative file path, convert it to an absolute path. From
		// now on, we can assume that it's a real file name if it is an absolute
		// path.
		filename = path.resolve(filename);
	}

	// If the 'filename' is the package path + file, convert that to a real
	// path, e.g. example.com/foo/bar.go -> /home/user/src/foo/bar.go.
	if (scope instanceof Module && filename.startsWith(`${scope.path}/`)) {
		filename = path.join(scope.dir.fsPath, filename.substring(scope.path.length + 1));
	}

	const range = new Range(startLine, startCol, endLine, endCol);
	const location = new Location(Uri.file(filename), range);
	return { location, count, statements };
}
