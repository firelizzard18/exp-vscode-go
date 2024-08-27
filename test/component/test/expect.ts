/* eslint-disable n/no-unpublished-import */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable @typescript-eslint/no-namespace */
import { TestItemCollection } from 'vscode';
import { GoTestItem } from '../../../src/test/GoTestItem';
import { MockTestController, TestHost } from './host';
import type { MatcherFunction, ExpectationResult } from 'expect';
import { expect } from '@jest/globals';

export type ExpectedTestItem =
	| {
			kind: 'module' | 'workspace' | 'package' | 'file';
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

const toResolve: MatcherFunction<[ExpectedTestItem[]]> = function (src, want): ExpectationResult {
	const convert = (items: TestItemCollection) =>
		[...items]
			.map((x) => x[1])
			.sort((a, b) => a.id.localeCompare(b.id))
			.map((item): ExpectedTestItem => {
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
							children: convert(item.children)
						};
				}
				return {
					kind,
					uri: item.uri!.toString(),
					children: convert(item.children)
				};
			});

	const addChildren = (items: ExpectedTestItem[]) =>
		items.forEach((item) => {
			if (!item.children) {
				item.children = [];
			} else {
				addChildren(item.children);
			}
		});

	addChildren(want);

	const got =
		src instanceof MockTestController
			? convert(src.items)
			: src instanceof TestHost
				? convert(src.controller.items)
				: false;
	if (!got) {
		throw new Error('Expected test controller');
	}

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

declare module 'expect' {
	interface Matchers<R> {
		toResolve(expected: ExpectedTestItem[]): ExpectationResult;
	}
}
