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
