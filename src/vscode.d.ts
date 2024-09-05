/**
 * Features that are available in newer versions of VSCode.
 */
declare module 'vscode' {
	export interface TestController {
		/**
		 * Marks an item's results as being outdated. This is commonly called when
		 * code or configuration changes and previous results should no longer
		 * be considered relevant. The same logic used to mark results as outdated
		 * may be used to drive {@link TestRunRequest.continuous continuous test runs}.
		 *
		 * If an item is passed to this method, test results for the item and all of
		 * its children will be marked as outdated. If no item is passed, then all
		 * test owned by the TestController will be marked as outdated.
		 *
		 * Any test runs started before the moment this method is called, including
		 * runs which may still be ongoing, will be marked as outdated and deprioritized
		 * in the editor's UI.
		 *
		 * @param item Item to mark as outdated. If undefined, all the controller's items are marked outdated.
		 */
		invalidateTestResults?(items?: TestItem | readonly TestItem[]): void;

		createRunProfile(
			label: string,
			kind: TestRunProfileKind,
			runHandler: (request: TestRunRequest, token: CancellationToken) => Thenable<void> | void,
			isDefault?: boolean,
			tag?: TestTag,
			supportsContinuousRun?: boolean
		): TestRunProfile;
	}

	export interface TestRunProfile {
		/**
		 * Whether this profile supports continuous running of requests. If so,
		 * then {@link TestRunRequest.continuous} may be set to `true`. Defaults
		 * to false.
		 */
		supportsContinuousRun?: boolean;

		/**
		 * Additional notes for {@link runHandler}:
		 *
		 * If {@link supportsContinuousRun} is set, then {@link TestRunRequest.continuous}
		 * may be `true`. In this case, the profile should observe changes to
		 * source code and create new test runs by calling {@link TestController.createTestRun},
		 * until the cancellation is requested on the `token`.
		 */
	}

	export interface TestRunRequest {
		/**
		 * Whether the profile should run continuously as source code changes. Only
		 * relevant for profiles that set {@link TestRunProfile.supportsContinuousRun}.
		 */
		readonly continuous?: boolean;
	}
}
