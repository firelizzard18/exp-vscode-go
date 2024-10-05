/* eslint-disable n/no-unpublished-import */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-namespace */
import { TestItemCollection } from 'vscode';
import { GoTestItem } from '../../../src/test/item';
import { MockTestController, TestHost } from './host';
import type { MatcherFunction, SyncExpectationResult } from 'expect';
import { expect } from '@jest/globals';

export type ExpectedTestItem =
	| {
			kind: 'module' | 'workspace' | 'package' | 'file' | 'profile' | 'profile-container' | 'profile-set';
			uri?: string;
			children: ExpectedTestItem[];
	  }
	| {
			kind: 'test' | 'benchmark' | 'fuzz' | 'example';
			uri: string;
			name: string;
			children?: ExpectedTestItem[];
	  };

// export interface ExpectedTestItem {
// 	kind: GoTestItem.Kind;
// 	uri: string;
// 	children?: ExpectedTestItem[];
// }

const toResolve: MatcherFunction<[ExpectedTestItem[]]> = async function (src, want): Promise<SyncExpectationResult> {
	populateChildren(want);

	if (!(src instanceof TestHost)) {
		throw new Error('Expected test controller');
	}
	await src.controller.resolveHandler!();

	const convert = async (items: TestItemCollection) => {
		await Promise.all([...items].map(([, item]) => src.controller.resolveHandler!(item)));
		return Promise.all(
			[...items]
				.map(([id, item]) => {
					const goItem = src.manager.resolveGoTestItem(id);
					if (!goItem) throw new Error(`Failed to resolve ${id}`);
					return { item: goItem, children: item.children };
				})
				.sort(({ item: a }, { item: b }) => {
					let c = `${a.uri}`.localeCompare(`${b.uri}`);
					if (c !== 0) return c;
					c = a.kind.localeCompare(b.kind);
					if (c !== 0) return c;
					c = `${a.name}`.localeCompare(`${b.name}`);
					return c;
				})
				.map(async ({ item, children }): Promise<ExpectedTestItem> => {
					switch (item.kind) {
						case 'test':
						case 'benchmark':
						case 'fuzz':
						case 'example':
							return {
								kind: item.kind,
								name: item.name!,
								uri: `${item.uri}`,
								children: await convert(children),
							};
						default:
							return {
								kind: item.kind,
								uri: `${item.uri}`,
								children: await convert(children),
							};
					}
				}),
		);
	};

	const got = await convert(src.controller.items);
	const gots = this.utils.printReceived(got);
	const wants = this.utils.printExpected(want);
	if (this.equals(got, want)) {
		return {
			message: () => `Want: ${wants}\nGot: ${gots}`,
			pass: true,
		};
	}

	const diff = this.utils.diff(want, got, { omitAnnotationLines: true });
	return {
		message: () => `Want: ${wants}\nGot: ${gots}\n\n${diff}`,
		pass: false,
	};
};

expect.extend({ toResolve });

function populateChildren(items: ExpectedTestItem[]) {
	items.forEach((item) => {
		if (item.children) {
			populateChildren(item.children);
		} else {
			item.children = [];
		}
	});
}

declare module 'expect' {
	interface Matchers<R> {
		toResolve(expected: ExpectedTestItem[]): ExpectationResult;
	}
}
