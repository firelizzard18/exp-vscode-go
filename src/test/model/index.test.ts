import { describe, expect, it } from '@jest/globals';
import { dumpDataModel, DumpedWorkspace, loadDataModel } from '.';
import lokiDump from '../../../test/testdata/loki.json';
import { VSCodeWorkspace } from '../../utils/common';

const ctx = {
	workspace: {
		getWorkspaceFolder(uri) {
			return {
				index: 0,
				name: `${uri}`,
				uri,
			};
		},
	} satisfies Pick<VSCodeWorkspace, 'getWorkspaceFolder'>,
};

describe('Data model dump', () => {
	it('can complete a round trip', () => {
		const item = lokiDump.map((x) => loadDataModel(ctx, x as unknown as DumpedWorkspace));
		const json = dumpDataModel(item);
		const r = JSON.parse(json);
		expect(r).toStrictEqual(lokiDump);
	});
});
