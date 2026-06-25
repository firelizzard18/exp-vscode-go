/* eslint-disable @typescript-eslint/no-explicit-any */
import { expect } from '@jest/globals';
import type { MatcherFunction, SyncExpectationResult } from 'expect';
import type { TestItemCollection } from 'vscode';

import { parseID } from '../../src/test/view/presenter';
import { TestHost } from './host';

export type ExpectedTestItem =
	| {
			kind: 'module' | 'workspace' | 'package' | 'file' | 'profile-container' | 'profile-set' | 'profile';
			uri?: string;
			children?: ExpectedTestItem[];
	  }
	| {
			kind: 'test' | 'benchmark' | 'fuzz' | 'example';
			uri: string;
			name: string;
			children?: ExpectedTestItem[];
	  };

const toResolve: MatcherFunction<[ExpectedTestItem[]]> = async function (
	src,
	want,
): Promise<SyncExpectationResult> {
	if (!(src instanceof TestHost)) {
		return { pass: false, message: () => 'Expected a TestHost instance' };
	}

	// Resolve roots.
	await src.controller.resolveHandler!(undefined);

	const convert = async (items: TestItemCollection): Promise<ExpectedTestItem[]> => {
		const result: ExpectedTestItem[] = [];

		for (const [id, item] of items) {
			// Recursively resolve children so lazily-loaded items expand.
			await src.controller.resolveHandler!(item);
			const children = await convert(item.children);

			const parsed = parseID(id);

			if (
				parsed.kind === 'test' ||
				parsed.kind === 'benchmark' ||
				parsed.kind === 'fuzz' ||
				parsed.kind === 'example'
			) {
				result.push({
					kind: parsed.kind,
					name: parsed.name!,
					uri: `${item.uri}`,
					children,
				});
			} else {
				result.push({
					kind: parsed.kind as any,
					uri: item.uri ? `${item.uri}` : undefined,
					children,
				});
			}
		}

		// Sort for determinism: by uri, then kind, then name.
		result.sort((a, b) => {
			const au = ('uri' in a ? a.uri : '') ?? '';
			const bu = ('uri' in b ? b.uri : '') ?? '';
			let c = au.localeCompare(bu);
			if (c !== 0) return c;
			c = a.kind.localeCompare(b.kind);
			if (c !== 0) return c;
			const an = 'name' in a ? a.name : '';
			const bn = 'name' in b ? b.name : '';
			return an.localeCompare(bn);
		});

		return result;
	};

	const got = await convert(src.controller.items);
	populateChildren(want);

	const gots = this.utils.printReceived(got);
	const wants = this.utils.printExpected(want);

	if (this.equals(got, want)) {
		return { pass: true, message: () => `Want: ${wants}\nGot: ${gots}` };
	}

	const diff = this.utils.diff(want, got, { omitAnnotationLines: true });
	return {
		pass: false,
		message: () => `Want: ${wants}\nGot: ${gots}\n\n${diff}`,
	};
};

expect.extend({ toResolve });

function populateChildren(items: ExpectedTestItem[]) {
	for (const item of items) {
		if (!item.children) {
			item.children = [];
		} else {
			populateChildren(item.children);
		}
	}
}

declare module 'expect' {
	interface Matchers<R> {
		toResolve(expected: ExpectedTestItem[]): Promise<R>;
	}
}
