import { Range, TestRun, Uri, WorkspaceFolder } from 'vscode';
import { Commands } from '../utils/testing';
import { ItemEvent, ItemSet } from './itemSet';
import deepEqual from 'deep-equal';
import { CapturedProfile, ProfileContainer, ProfileSet } from './profile';

export type GoTestItem =
	| Module
	| Workspace
	| Package
	| TestFile
	| TestCase
	| ProfileContainer
	| ProfileSet
	| CapturedProfile;

export class Workspace {
	readonly kind = 'workspace';
	readonly ws;
	readonly modules = new ItemSet<Module, Commands.Module>((x) => x.Path);
	readonly packages = new ItemSet<Package, Commands.Package>((x) => x.Path);

	constructor(ws: WorkspaceFolder) {
		this.ws = ws;
	}

	get uri() {
		return this.ws.uri;
	}

	get dir(): Uri {
		return this.ws.uri;
	}

	get key() {
		return `${this.uri}`;
	}

	updateModules(modules: Commands.Module[]) {
		this.modules.update(
			modules,
			(x) => new Module(this, x),
			() => [], // Nothing to update
		);
	}

	updatePackages(packages: Commands.Package[]) {
		this.packages.update(
			packages,
			(x) => new Package(this, x),
			(x, pkg) => pkg.update(x, {}),
		);
	}
}

export class Module {
	readonly kind = 'module';
	readonly uri;
	readonly path;
	readonly workspace;
	readonly packages = new ItemSet<Package, Commands.Package>((x) => x.Path);

	constructor(workspace: Workspace, mod: Commands.Module) {
		this.workspace = workspace;
		this.uri = Uri.parse(mod.GoMod);
		this.path = mod.Path;
	}

	get dir(): Uri {
		return Uri.joinPath(this.uri, '..');
	}

	get key() {
		return this.path;
	}

	updatePackages(packages: Commands.Package[]) {
		this.packages.update(
			packages,
			(x) => new Package(this, x),
			(x, pkg) => pkg.update(x, {}),
		);
	}
}

export class Package {
	readonly kind = 'package';
	readonly parent;
	readonly uri;
	readonly path;
	readonly files = new ItemSet<TestFile, Commands.TestFile>((x) => x.URI);

	constructor(parent: Module | Workspace, pkg: Commands.Package) {
		this.parent = parent;
		this.path = pkg.Path;
		this.uri = Uri.joinPath(Uri.parse(pkg.TestFiles![0].URI), '..');
	}

	get key() {
		return this.path;
	}

	/**
	 * Returns whether the package is the root package of the parent.
	 */
	get isRootPkg() {
		return `${this.uri}` === `${this.parent.dir}`;
	}

	/**
	 * Updates the package with data from gopls.
	 * @param src The data from gopls.
	 * @param ranges Modified file ranges.
	 * @returns Update events. See {@link ItemEvent}.
	 */
	update(src: Commands.Package, ranges: Record<string, Range[]>) {
		const changes = this.files.update(
			src.TestFiles!.filter((x) => x.Tests.length),
			(src) => new TestFile(this, src),
			(src, file) => file.update(src, ranges[`${file.uri}`] || []),
		);
		if (!changes.length) {
			return [];
		}
		return changes;
	}

	*allTests() {
		for (const file of this.files) {
			yield* file.tests;
		}
	}
}

export class TestFile {
	readonly kind = 'file';
	readonly package;
	readonly uri;
	readonly tests = new ItemSet<TestCase, Commands.TestCase>((x) => x.Name);

	constructor(pkg: Package, file: Commands.TestFile) {
		this.package = pkg;
		this.uri = Uri.parse(file.URI);
	}

	get key() {
		return `${this.uri}`;
	}

	/**
	 * Updates the file with data from gopls.
	 * @param src The data from gopls.
	 * @param ranges Modified file ranges.
	 * @returns Update events. See {@link ItemEvent}.
	 */
	update(src: Commands.TestFile, ranges: Range[]) {
		return this.tests.update(
			src.Tests,
			(src) => new StaticTestCase(this, src),
			(src, test) => (test instanceof StaticTestCase ? test.update(src, ranges) : []),
			(test) => test instanceof DynamicTestCase,
		);
	}
}

export abstract class TestCase {
	readonly kind;
	readonly file;
	readonly uri;
	readonly name;

	constructor(file: TestFile, uri: Uri, kind: 'test' | 'benchmark' | 'fuzz' | 'example', name: string) {
		this.file = file;
		this.uri = uri;
		this.kind = kind;
		this.name = name;
	}

	get key() {
		return this.name;
	}
}

export class StaticTestCase extends TestCase {
	range?: Range;
	#src;

	constructor(file: TestFile, test: Commands.TestCase) {
		const kind = test.Name.match(/^(Test|Fuzz|Benchmark|Example)/)![1].toLowerCase();
		super(file, Uri.parse(test.Loc.uri), kind as TestCase['kind'], test.Name);
		this.#src = test;
		this.range = new Range(
			test.Loc.range.start.line,
			test.Loc.range.start.character,
			test.Loc.range.end.line,
			test.Loc.range.end.character,
		);
	}

	/**
	 * Updates the test case with data from gopls.
	 * @param src The data from gopls.
	 * @param ranges Modified file ranges.
	 * @returns Update events. See {@link ItemEvent}.
	 */
	update(src: Commands.TestCase, ranges: Range[]): Iterable<ItemEvent<TestCase>> {
		// Did the metadata (range) change?
		const metadata = !deepEqual(src, this.#src);

		// Did the contents change?
		const contents = ranges.some((x) => this.contains(x));

		if (!metadata && !contents) {
			return [];
		}

		// Update the range
		if (metadata) {
			const { start, end } = src.Loc.range;
			this.#src = src;
			this.range = new Range(start.line, start.character, end.line, end.character);
		}

		// Return the appropriate event
		return [{ item: this, type: contents ? 'modified' : 'moved' }];
	}

	/**
	 * Determines whether the test case contains a given range. The range must
	 * be strictly contained within the test's range. If the intersection
	 * includes regions outside of the test, or intersects the end or the
	 * beginning but has a size of zero, this will return false.
	 */
	contains(range: Range): boolean {
		// The range of the test must be defined
		if (!this.range) return false;

		// The test must contain the given range
		if (!this.range.contains(range)) return false;

		// The intersection must be strictly within the test range. If the
		// intersection is an empty range at the very start or end of the test's
		// range, reject it.
		const r = this.range.intersection(range)!;
		if (!r.isEmpty) return true;
		return !r.start.isEqual(this.range.start) && !r.end.isEqual(this.range.end);
	}
}

export class DynamicTestCase extends TestCase {
	/**
	 * The {@link TestRun} that created this dynamic test case.
	 */
	run;

	constructor(parent: TestCase, name: string, run: TestRun) {
		super(parent.file, parent.uri, parent.kind, name);
		this.run = run;
	}
}

/**
 * Searches a set of tests for a test case that is the parent of the given test
 * name.
 */
export function findParentTestCase(allTests: TestCase[], name: string) {
	for (;;) {
		const i = name.lastIndexOf('/');
		if (i < 0) return;
		name = name.substring(0, i);
		for (const test of allTests) {
			if (test.name === name) {
				return test;
			}
		}
	}
}
