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
	update(src: Commands.TestCase, ranges?: Range[]): Iterable<ItemEvent<TestCase>> {
		const moved = !deepEqual(src, this.#src);
		const contains = ranges?.some((x) => this.contains(x));

		if (moved) {
			const { start, end } = src.Loc.range;
			this.#src = src;
			this.range = new Range(start.line, start.character, end.line, end.character);
		}

		// Return the appropriate event. Modified is a larger change than moved.
		return [{ item: this, type: contains ? 'modified' : 'moved' }];
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

export function idFor(item: GoTestItem): Uri {
	switch (item.kind) {
		case 'workspace':
		case 'module':
		case 'package':
		case 'file':
			return item.uri.with({ query: `kind=${item.kind}` });

		case 'profile-container':
			return idFor(item.parent).with({ fragment: 'profiles' });

		case 'profile-set': {
			const base = idFor(item.parent);
			return base.with({ query: `${base.query}&at=${item.time.getTime()}` });
		}

		case 'profile': {
			const base = idFor(item.parent);
			return base.with({ query: `${base.query}&profile=${item.type.id}` });
		}

		default:
			return item.uri.with({ query: `kind=${item.kind}&name=${item.name}` });
	}
}

export function parseID(id: string | Uri) {
	if (typeof id === 'string') {
		id = Uri.parse(id);
	}
	const query = new URLSearchParams(id.query);
	if (query.has('kind')) throw new Error('Invalid ID');
	return {
		path: id.path,
		kind: query.get('kind')!,
		name: query.get('name') ?? undefined,
		at: query.has('at') ? new Date(query.get('at')!) : undefined,
		profile: query.get('profile') ?? id.fragment === 'profiles',
	};
}
