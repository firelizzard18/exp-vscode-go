import { Workspace } from './workspace';
import { Module } from './module';
import { Package } from './package';
import { TestFile } from './file';
import { TestCase, StaticTestCase, DynamicTestCase } from './case';

export { Workspace, Module, Package, TestFile, TestCase, StaticTestCase, DynamicTestCase };
export { ItemSet } from './set';

/**
 * Represents an update to a test item.
 *  - `added` indicates that the item was added.
 *  - `removed` indicates that the item was removed.
 *  - `moved` indicates that the item's range changed without changing its contents.
 *  - `modified` indicates that the item's contents and possibly its range changed.
 */
export type ItemEvent<T> = { item: T; type: 'added' | 'removed' | 'moved' | 'modified' };

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
