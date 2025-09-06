import { expect, jest } from '@jest/globals';
import { Workspace } from '@/test/utils/txtar';
import { TestHost, withCommands, withSetupArgs, withWorkspace } from '@/test/utils/host';

describe('Test manager', () => {
	const ws = Workspace.setup(
		`-- go.mod --
		module foo`,
	);

	it('shows a warning if commands are unavailable', async () => {
		// If gopls.packages returns "command not found", the test manager must
		// show a warning and **must not** create the test controller.

		const packages = jest.fn(() => Promise.reject(new Error("command 'gopls.packages' not found")));
		const showWarningMessage = jest.fn<() => Promise<void>>();
		const createTestController = jest.fn(() => {
			throw new Error('nope');
		});

		await TestHost.setup(
			ws.path,
			withWorkspace('foo', `${ws.uri}`),
			withCommands({ packages }),
			withSetupArgs({ showWarningMessage, createTestController }),
		);

		expect(packages).toBeCalled();
		expect(showWarningMessage).toBeCalled();
		expect(createTestController).not.toBeCalled();
	});
});
