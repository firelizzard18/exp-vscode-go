/* eslint-disable n/no-unpublished-import */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-namespace */
import { TestItemCollection } from 'vscode';
import { GoTestItem } from '../../../src/test/item';
import { MockTestController, TestHost } from './host';
import type { MatcherFunction, ExpectationResult, SyncExpectationResult } from 'expect';
import { expect } from '@jest/globals';

export type ExpectedTestItem =
	| {
			kind: 'module' | 'workspace' | 'package' | 'file' | 'profile';
			uri: string;
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

	const ctrl = src instanceof MockTestController ? src : src instanceof TestHost ? src.controller : undefined;
	if (!ctrl) throw new Error('Expected test controller');
	await ctrl.resolveHandler!();

	const convert = async (items: TestItemCollection) =>
		Promise.all(
			[...items]
				.map((x) => x[1])
				.sort((a, b) => a.id.localeCompare(b.id))
				.map(async (item): Promise<ExpectedTestItem> => {
					await ctrl.resolveHandler!(item);
					const { kind, name } = GoTestItem.parseId(item.id);
					switch (kind) {
						case 'test':
						case 'benchmark':
						case 'fuzz':
						case 'example':
							return {
								kind,
								name: name!,
								uri: item.uri!.toString(),
								children: await convert(item.children)
							};
					}
					return {
						kind,
						uri: item.uri!.toString(),
						children: await convert(item.children)
					};
				})
		);

	const got = await convert(ctrl.items);
	const gots = this.utils.printReceived(got);
	const wants = this.utils.printExpected(want);
	if (this.equals(got, want)) {
		return {
			message: () => `Want: ${wants}\nGot: ${gots}`,
			pass: true
		};
	}

	const diff = this.utils.diff(want, got, { omitAnnotationLines: true });
	return {
		message: () => `Want: ${wants}\nGot: ${gots}\n\n${diff}`,
		pass: false
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
