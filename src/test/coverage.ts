import path from 'node:path';
import cp from 'node:child_process';
import { promisify } from 'node:util';
import { Location, Range, StatementCoverage, Uri } from 'vscode';
import { Context } from './testing';
import { Module, RootItem } from './item';

/**
 * Parses a coverage file from `go test` into a map of
 * {@link StatementCoverage}.
 * @param scope - The module or workspace for resolving relative paths.
 * @param coverageFile - The coverage file
 * @returns Statement coverage information.
 */
export async function parseCoverage(context: Context, scope: RootItem, coverageFile: Uri) {
	// Resolve GOROOT and GOMODCACHE
	const { binPath } = context.go.settings.getExecutionCommand('go') || {};
	if (!binPath) {
		throw new Error('Failed to run "go env" as the "go" binary cannot be found in either GOROOT or PATH');
	}

	const env = {
		GOROOT: await getEnv(binPath, 'GOROOT'),
		GOMODCACHE: await getEnv(binPath, 'GOMODCACHE'),
	};

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

		const parse = parseLine(env, scope, line);
		if (!parse) continue;

		const statements = coverage.get(`${parse.location.uri}`) || [];
		coverage.set(`${parse.location.uri}`, statements);
		statements.push(new StatementCoverage(parse.count, parse.location.range));
	}

	return coverage;
}

async function getEnv(binPath: string, name: string) {
	const { stdout } = await promisify(cp.execFile)(binPath, ['env', name]);
	return stdout.trim();
}

// Derived from https://golang.org/cl/179377

interface Env {
	GOROOT: string;
	GOMODCACHE: string;
}

/**
 * Parses a line in a coverage file.
 * @param scope - The module or workspace for resolving relative paths.
 * @param s - The line.
 * @returns The parsed line.
 */
function parseLine(env: Env, scope: RootItem, s: string) {
	/**
	 * Finds the last occurrence of {@link sep} in {@link s}, splits {@link s}
	 * on that index, and returns the RHS parsed as a number.
	 * @param sep - The field separator.
	 * @param offset - An offset to apply to the value.
	 * @returns The parsed value.
	 */
	const seek = (sep: string, offset: number = 0) => {
		const i = s.lastIndexOf(sep);
		if (i < 0) return;
		const n = parseInt(s.substring(i + 1), 10);
		if (isNaN(n)) return;
		s = s.substring(0, i).trim();
		return n + offset;
	};

	// Parse all the fields
	const count = seek(' ');
	const statements = seek(' ');
	const endCol = seek('.', -1);
	const endLine = seek(',', -1);
	const startCol = seek('.', -1);
	const startLine = seek(':', -1);

	// If any field is missing, abort
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

	const filename = resolveCoveragePath(env, scope, s);
	const range = new Range(startLine, startCol, endLine, endCol);
	const location = new Location(Uri.file(filename), range);
	return { location, count, statements };
}

function resolveCoveragePath(env: Env, scope: RootItem, filename: string) {
	// If it's an absolute path, assume it's correct
	if (path.isAbsolute(filename)) {
		return filename;
	}

	// If it's a relative path, convert it to an absolute path and return
	if (filename.startsWith(`.${path.sep}`)) {
		return path.resolve(filename, scope.dir.fsPath);
	}

	// If the scope is a module and the file belongs to it, convert the filepath
	// to a real path, e.g. example.com/foo/bar.go -> /home/user/src/foo/bar.go.
	if (scope instanceof Module && filename.startsWith(`${scope.path}/`)) {
		return path.join(scope.dir.fsPath, filename.substring(scope.path.length + 1));
	}

	// If the first segment of the path contains a dot, assume it's a module
	const [first] = filename.split(/\\|\//);
	if (first.includes('.')) {
		// TODO: Resolve the version
		return path.join(env.GOMODCACHE, filename);
	}

	// If the first segment does not contain a dot, assume it's a stdlib package
	return path.join(env.GOROOT, 'src', filename);
}
