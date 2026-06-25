/**
 * Helpers for constructing fake gopls responses and model state in tests.
 *
 * The builders here produce the Commands.* data shapes that ModelController
 * receives from gopls, letting tests set up specific model scenarios without
 * needing a real gopls binary.
 */
import { type Commands } from '../../src/utils/common';

// ─── FakeCommands ─────────────────────────────────────────────────────────────

/**
 * A Commands implementation that returns pre-configured results. Set
 * `modulesResult` and `packagesResults` before the code under test runs.
 */
export class FakeCommands implements Commands {
	modulesResult: Commands.ModulesResult = {};
	packagesResults: Commands.PackagesResults = {};

	modules(_args: Commands.ModulesArgs): Promise<Commands.ModulesResult> {
		return Promise.resolve(this.modulesResult);
	}

	packages(_args: Commands.PackagesArgs): Promise<Commands.PackagesResults> {
		return Promise.resolve(this.packagesResults);
	}
}

// ─── Data builders ────────────────────────────────────────────────────────────

/** Builds a Commands.Module entry. */
export function cmdModule(path: string, goModUri: string): Commands.Module {
	return { Path: path, GoMod: goModUri };
}

/** Builds a Commands.Package entry. */
export function cmdPackage(
	path: string,
	modulePath: string | undefined,
	files: Commands.TestFile[],
): Commands.Package {
	return { Path: path, ModulePath: modulePath, TestFiles: files };
}

/** Builds a Commands.TestFile entry. */
export function cmdFile(uri: string, tests: Commands.TestCase[]): Commands.TestFile {
	return { URI: uri, Tests: tests };
}

/** Builds a Commands.TestCase entry. */
export function cmdCase(name: string, fileUri: string, line = 0): Commands.TestCase {
	return {
		Name: name,
		Loc: {
			uri: fileUri,
			range: {
				start: { line, character: 0 },
				end: { line: line + 5, character: 1 },
			},
		},
	};
}

// ─── Scenario builders ────────────────────────────────────────────────────────

export interface PackageSpec {
	/** Import path (e.g. "foo/bar"). */
	path: string;
	/** Test file specs. */
	files: FileSpec[];
}

export interface FileSpec {
	/** URI of the test file. */
	uri: string;
	/** Test names to include. */
	tests: string[];
}

/**
 * Builds a Commands.PackagesResults for a module-based workspace.
 *
 * @param modPath  Module import path (e.g. "foo")
 * @param goModUri Absolute URI of go.mod (e.g. "file:///workspace/go.mod")
 * @param packages Package specs to include
 */
export function modulePackagesResult(
	modPath: string,
	goModUri: string,
	packages: PackageSpec[],
): Commands.PackagesResults {
	return {
		Packages: packages.map(({ path, files }) =>
			cmdPackage(
				path,
				modPath,
				files.map(({ uri, tests }) => cmdFile(uri, tests.map((name) => cmdCase(name, uri)))),
			),
		),
		Module: { [modPath]: cmdModule(modPath, goModUri) },
	};
}

/**
 * Builds a Commands.ModulesResult for a workspace with a single module.
 */
export function moduleResult(modPath: string, goModUri: string): Commands.ModulesResult {
	return { Modules: [cmdModule(modPath, goModUri)] };
}

/**
 * Builds a Commands.PackagesResults for a module-free workspace (no go.mod).
 * In this case gopls reports the package path as the absolute directory path.
 *
 * @param wsDir    Absolute path of the workspace directory (e.g. "/workspace")
 * @param packages Package specs to include
 */
export function moduleFreePackagesResult(wsDir: string, packages: PackageSpec[]): Commands.PackagesResults {
	return {
		Packages: packages.map(({ path, files }) =>
			cmdPackage(
				path,
				undefined,
				files.map(({ uri, tests }) => cmdFile(uri, tests.map((name) => cmdCase(name, uri)))),
			),
		),
	};
}
