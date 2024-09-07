/**
 * Features that are available in newer versions of VSCode.
 */
declare module 'vscode' {
	export interface DebugSessionOptions {
		testRun?: TestRun;
	}

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
		 * Additional notes for {@link runHandler}:
		 *
		 * If {@link supportsContinuousRun} is set, then {@link TestRunRequest.continuous}
		 * may be `true`. In this case, the profile should observe changes to
		 * source code and create new test runs by calling {@link TestController.createTestRun},
		 * until the cancellation is requested on the `token`.
		 */

		/**
		 * Whether this profile supports continuous running of requests. If so,
		 * then {@link TestRunRequest.continuous} may be set to `true`. Defaults
		 * to false.
		 */
		supportsContinuousRun?: boolean;

		/**
		 * An extension-provided function that provides detailed statement and
		 * function-level coverage for a file. The editor will call this when more
		 * detail is needed for a file, such as when it's opened in an editor or
		 * expanded in the **Test Coverage** view.
		 *
		 * The {@link FileCoverage} object passed to this function is the same instance
		 * emitted on {@link TestRun.addCoverage} calls associated with this profile.
		 */
		loadDetailedCoverage?: (
			testRun: TestRun,
			fileCoverage: FileCoverage,
			token: CancellationToken
		) => Thenable<FileCoverageDetail[]>;
	}

	export interface TestRunRequest {
		/**
		 * Whether the profile should run continuously as source code changes. Only
		 * relevant for profiles that set {@link TestRunProfile.supportsContinuousRun}.
		 */
		readonly continuous?: boolean;
	}

	export interface TestRun {
		/**
		 * Adds coverage for a file in the run.
		 */
		addCoverage?(fileCoverage: FileCoverage): void;

		/**
		 * An event fired when the editor is no longer interested in data
		 * associated with the test run.
		 */
		onDidDispose?: Event<void>;
	}

	/**
	 * A class that contains information about a covered resource. A count can
	 * be give for lines, branches, and declarations in a file.
	 */
	export class TestCoverageCount {
		/**
		 * Number of items covered in the file.
		 */
		covered: number;
		/**
		 * Total number of covered items in the file.
		 */
		total: number;

		/**
		 * @param covered Value for {@link TestCoverageCount.covered}
		 * @param total Value for {@link TestCoverageCount.total}
		 */
		constructor(covered: number, total: number);
	}

	/**
	 * Contains coverage metadata for a file.
	 */
	export class FileCoverage {
		/**
		 * File URI.
		 */
		readonly uri: Uri;

		/**
		 * Statement coverage information. If the reporter does not provide statement
		 * coverage information, this can instead be used to represent line coverage.
		 */
		statementCoverage: TestCoverageCount;

		/**
		 * Branch coverage information.
		 */
		branchCoverage?: TestCoverageCount;

		/**
		 * Declaration coverage information. Depending on the reporter and
		 * language, this may be types such as functions, methods, or namespaces.
		 */
		declarationCoverage?: TestCoverageCount;

		/**
		 * Creates a {@link FileCoverage} instance with counts filled in from
		 * the coverage details.
		 * @param uri Covered file URI
		 * @param detailed Detailed coverage information
		 */
		static fromDetails(uri: Uri, details: readonly FileCoverageDetail[]): FileCoverage;

		/**
		 * @param uri Covered file URI
		 * @param statementCoverage Statement coverage information. If the reporter
		 * does not provide statement coverage information, this can instead be
		 * used to represent line coverage.
		 * @param branchCoverage Branch coverage information
		 * @param declarationCoverage Declaration coverage information
		 */
		constructor(
			uri: Uri,
			statementCoverage: TestCoverageCount,
			branchCoverage?: TestCoverageCount,
			declarationCoverage?: TestCoverageCount
		);
	}

	/**
	 * Contains coverage information for a single statement or line.
	 */
	export class StatementCoverage {
		/**
		 * The number of times this statement was executed, or a boolean indicating
		 * whether it was executed if the exact count is unknown. If zero or false,
		 * the statement will be marked as un-covered.
		 */
		executed: number | boolean;

		/**
		 * Statement location.
		 */
		location: Position | Range;

		/**
		 * Coverage from branches of this line or statement. If it's not a
		 * conditional, this will be empty.
		 */
		branches: BranchCoverage[];

		/**
		 * @param location The statement position.
		 * @param executed The number of times this statement was executed, or a
		 * boolean indicating  whether it was executed if the exact count is
		 * unknown. If zero or false, the statement will be marked as un-covered.
		 * @param branches Coverage from branches of this line.  If it's not a
		 * conditional, this should be omitted.
		 */
		constructor(executed: number | boolean, location: Position | Range, branches?: BranchCoverage[]);
	}

	/**
	 * Contains coverage information for a branch of a {@link StatementCoverage}.
	 */
	export class BranchCoverage {
		/**
		 * The number of times this branch was executed, or a boolean indicating
		 * whether it was executed if the exact count is unknown. If zero or false,
		 * the branch will be marked as un-covered.
		 */
		executed: number | boolean;

		/**
		 * Branch location.
		 */
		location?: Position | Range;

		/**
		 * Label for the branch, used in the context of "the ${label} branch was
		 * not taken," for example.
		 */
		label?: string;

		/**
		 * @param executed The number of times this branch was executed, or a
		 * boolean indicating  whether it was executed if the exact count is
		 * unknown. If zero or false, the branch will be marked as un-covered.
		 * @param location The branch position.
		 */
		constructor(executed: number | boolean, location?: Position | Range, label?: string);
	}

	/**
	 * Contains coverage information for a declaration. Depending on the reporter
	 * and language, this may be types such as functions, methods, or namespaces.
	 */
	export class DeclarationCoverage {
		/**
		 * Name of the declaration.
		 */
		name: string;

		/**
		 * The number of times this declaration was executed, or a boolean
		 * indicating whether it was executed if the exact count is unknown. If
		 * zero or false, the declaration will be marked as un-covered.
		 */
		executed: number | boolean;

		/**
		 * Declaration location.
		 */
		location: Position | Range;

		/**
		 * @param executed The number of times this declaration was executed, or a
		 * boolean indicating  whether it was executed if the exact count is
		 * unknown. If zero or false, the declaration will be marked as un-covered.
		 * @param location The declaration position.
		 */
		constructor(name: string, executed: number | boolean, location: Position | Range);
	}

	/**
	 * Coverage details returned from {@link TestRunProfile.loadDetailedCoverage}.
	 */
	export type FileCoverageDetail = StatementCoverage | DeclarationCoverage;
}
