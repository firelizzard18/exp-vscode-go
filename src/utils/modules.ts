import { Uri } from 'vscode';
import { Context } from './testing';
import { execGoStr, exists, JsonValue, parseJSONStream } from './util';
import { join } from 'node:path';

export async function getModulePaths(context: Context, scope: Uri) {
	const modules: Record<string, string> = {};
	const addModule = (v: JsonValue) => {
		const dep = v as {
			Path: string;
			Dir: string;
		};
		if (!dep.Dir) return; // Why does this happen?
		modules[dep.Path] = dep.Dir;
	};

	// If ${module}/vendor/modules.txt doesn't exist, use `go mod list -m all`
	// to get the path for all the module dependencies.
	const vendored = Uri.joinPath(scope, 'vendor', 'modules.txt');
	if (!(await exists(vendored.fsPath).then((x) => x?.isFile() ?? false))) {
		parseJSONStream(await execGoStr(context, ['list', '-m', '-json', 'all'], { cwd: scope.fsPath }), addModule);
		return modules;
	}

	// Otherwise, use `go mod list -m` to get the current module then read
	// vendor/modules.txt for the rest.
	parseJSONStream(await execGoStr(context, ['list', '-m', '-json'], { cwd: scope.fsPath }), addModule);

	const lines = Buffer.from(await context.workspace.fs.readFile(vendored))
		.toString('utf-8')
		.split('\n');

	for (const line of lines) {
		const [, mod] = line.match(/^#\s+([^\s]+)/) ?? [];
		if (!mod) continue;
		modules[mod] = join(scope.fsPath, 'vendor', mod);
	}

	return modules;
}
