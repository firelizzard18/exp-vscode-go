import { VSCodeWorkspace } from '@/utils/common';
import { Uri } from 'vscode';
import { DynamicTestCase, StaticTestCase, TestCase } from './case';
import { TestFile } from './file';
import { Module } from './module';
import { Package } from './package';
import { Workspace } from './workspace';

export { ModelController } from './controller';
export { ItemSet } from './set';

export { DynamicTestCase, Module, Package, StaticTestCase, TestCase, TestFile, Workspace };

/**
 * Represents an update to a test item.
 *  - `added` indicates that the item was added.
 *  - `removed` indicates that the item was removed.
 *  - `moved` indicates that the item's range changed without changing its contents.
 *  - `modified` indicates that the item's contents and possibly its range changed.
 */
export type ItemEvent<T = GoTestItem> =
	| { item: T; type: 'moved' | 'modified' }
	| { item: T; type: 'added'; to?: GoTestItem }
	| { item: T; type: 'removed'; from?: GoTestItem };

export type GoTestItem = Module | Workspace | Package | TestFile | TestCase;

export function isTestItem(v: any): v is GoTestItem {
	return (
		v instanceof Module ||
		v instanceof Workspace ||
		v instanceof Package ||
		v instanceof TestFile ||
		v instanceof TestCase
	);
}

interface DumpedItem<T extends GoTestItem> {
	kind: T['kind'];
}

export interface DumpedWorkspace extends DumpedItem<Workspace> {
	ws: string;
	modules?: DumpedModule[];
	packages?: DumpedPackage[];
}

export interface DumpedModule extends DumpedItem<Module> {
	GoMod: string;
	Path: string;
	packages?: DumpedPackage[];
}

export interface DumpedPackage extends DumpedItem<Package> {
	Path: string;
	ModulePath?: string;
	files?: DumpedTestFile[];
}

export interface DumpedTestFile extends DumpedItem<TestFile> {
	URI: string;
	tests?: DumpedTestCase[];
}

export interface DumpedTestCase extends DumpedItem<TestCase> {
	Name: string;
	Loc: {
		uri: string;
		range: {
			start: Position;
			end: Position;
		};
	};
}

interface Position {
	line: number;
	character: number;
}

export function dumpDataModel(v: GoTestItem | Iterable<GoTestItem>) {
	return JSON.stringify(v, (key, value) => {
		if (
			!Array.isArray(value) &&
			typeof value === 'object' &&
			Symbol.iterator in value &&
			typeof value[Symbol.iterator] === 'function'
		) {
			return [...value];
		}

		switch (true) {
			case value instanceof Workspace:
				return {
					kind: value.kind,
					ws: `${value.ws.uri}`,
					modules: value.modules.values(),
					package: value.packages.values(),
				};

			case value instanceof Module:
				return {
					kind: value.kind,
					GoMod: `${value.uri}`,
					Path: value.path,
					packages: value.packages.values(),
				};

			case value instanceof Package:
				return {
					kind: value.kind,
					Path: value.path,
					ModulePath: value.root instanceof Module ? value.root.path : undefined,
					files: value.files.values(),
				};

			case value instanceof TestFile:
				return {
					kind: value.kind,
					URI: `${value.uri}`,
					tests: [...value.tests.values()].filter((x) => x instanceof StaticTestCase),
				};

			case value instanceof StaticTestCase:
				return {
					kind: value.kind,
					Name: value.name,
					Loc: {
						uri: `${value.uri}`,
						range: {
							start: {
								line: value.range.start.line,
								character: value.range.start.character,
							},
							end: {
								line: value.range.end.line,
								character: value.range.end.character,
							},
						},
					},
				} satisfies DumpedTestCase;
		}
		return value;
	});
}

export function loadDataModel<
	T extends DumpedWorkspace | DumpedModule | DumpedPackage | DumpedTestFile | DumpedTestCase,
>(
	ctx: { workspace: Pick<VSCodeWorkspace, 'getWorkspaceFolder'> },
	dump: T,
	parent?: GoTestItem,
): GoTestItem & { kind: T['kind'] } {
	switch (dump.kind) {
		case 'workspace': {
			const wsf = ctx.workspace.getWorkspaceFolder(Uri.parse(dump.ws));
			if (!wsf) throw new Error(`Cannot find workspace: ${dump.ws}`);
			const ws = new Workspace(wsf);
			ws.modules.add(...(dump.modules?.map((x) => loadDataModel(ctx, x, ws)) ?? []));
			ws.packages.add(...(dump.packages?.map((x) => loadDataModel(ctx, x, ws)) ?? []));
			return ws;
		}

		case 'module': {
			if (!(parent instanceof Workspace)) throw new Error('Module have Workspace as parent');
			const mod = new Module(parent, dump);
			mod.packages.add(...(dump.packages?.map((x) => loadDataModel(ctx, x, mod)) ?? []));
			return mod;
		}

		case 'package': {
			if (!(parent instanceof Workspace || parent instanceof Module)) {
				throw new Error('Package have Workspace or Module as parent');
			}
			const pkg = new Package(parent, dump);
			pkg.files.add(...(dump.files?.map((x) => loadDataModel(ctx, x, pkg)) ?? []));
			return pkg;
		}

		case 'file': {
			if (!(parent instanceof Package)) throw new Error('TestFile have Package as parent');
			const file = new TestFile(parent, dump);
			file.tests.add(...(dump.tests?.map((x) => loadDataModel(ctx, x, file)) ?? []));
			return file;
		}

		case 'benchmark':
		case 'example':
		case 'test':
		case 'fuzz': {
			if (!(parent instanceof TestFile)) throw new Error('TestCase have TestFile as parent');
			return new StaticTestCase(parent, dump);
		}
	}
}
