/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { CancellationToken, TestItem, TestRun, TestRunProfile, TestRunProfileKind } from 'vscode';
import vscode from 'vscode';
import { Package, TestCase } from './item';
import { Context, doSafe, reportError, TestController, Workspace } from './testing';
import { PackageTestRun, TestRunRequest } from './run';
import { CancellationTokenSource } from 'vscode';
import { TestMessage } from 'vscode';

export type NewRun = (_: vscode.TestRunRequest) => Promise<TestRunRequest>;

export class TestRunner {
	readonly #context: Context;
	readonly #ctrl: TestController;
	readonly #profile: TestRunProfile;
	readonly #newRun: NewRun;

	constructor(
		context: Context,
		ctrl: TestController,
		newRun: NewRun,
		label: string,
		kind: TestRunProfileKind,
		isDefault = false
	) {
		this.#context = context;
		this.#ctrl = ctrl;
		this.#newRun = newRun;
		this.#profile = ctrl.createRunProfile(
			label,
			kind,
			(request, token) =>
				doSafe(context, 'execute test', async () => {
					await this.#run(await newRun(request), token);
				}),
			isDefault
		);
	}

	async run(item: vscode.TestItem) {
		const cancel = new CancellationTokenSource();
		await this.#run(await this.#newRun(new vscode.TestRunRequest([item], [], this.#profile)), cancel.token);
		cancel.cancel();
	}

	async #run(request: TestRunRequest, token: CancellationToken) {
		// Save all files to ensure `go test` tests the latest changes
		await this.#context.workspace.saveAll(false);

		// Execute the tests
		const run = this.#ctrl.createTestRun(request.source);
		try {
			const invalid = request.size > 1 && this.#profile.kind === TestRunProfileKind.Debug;
			let first = true;
			for await (const pkg of request.packages(run)) {
				if (invalid) {
					pkg.report((item) =>
						run.errored(item, {
							message: 'Debugging multiple test packages is not supported'
						})
					);
					continue;
				}

				if (first) {
					first = false;
				} else {
					run.appendOutput('\r\n\r\n');
				}

				await this.#runPackage(run, pkg, token);
			}
		} finally {
			run.end();
		}
	}

	async #runPackage(run: TestRun, pkg: PackageTestRun, token: CancellationToken, error?: TestMessage) {
		pkg.report((item, goItem) => {
			run.enqueued(item);
			goItem?.removeDynamicTestCases();
		});

		const { binPath: goRuntimePath } = this.#context.go.settings.getExecutionCommand('go', pkg.goItem.uri) || {};
		if (!goRuntimePath) {
			pkg.report((item) =>
				run.errored(item, {
					message: 'Failed to run "go test" as the "go" binary cannot be found in either GOROOT or PATH'
				})
			);
			return;
		}
		const flags: string[] = [
			'-fullpath' // Include the full path for output events
		];
		if (pkg.includeAll) {
			// Include all test cases
			flags.push('-run=.');
			if (shouldRunBenchmarks(this.#context.workspace, pkg.goItem)) {
				flags.push('-bench=.');
			}
		} else {
			// Include specific test cases
			flags.push(`-run=${makeRegex(pkg.include.keys(), (x) => x.kind !== 'benchmark')}`);
			flags.push(`-bench=${makeRegex(pkg.include.keys(), (x) => x.kind === 'benchmark')}`);
		}
		if (pkg.exclude.size) {
			// Exclude specific test cases
			flags.push(`-skip=${makeRegex(pkg.exclude.keys())}`);
		}

		pkg.append(
			`$ cd ${pkg.goItem.uri.fsPath}\n$ ${goRuntimePath} test ${flags.join(' ')}\n\n`,
			undefined,
			pkg.testItem
		);
		const spawn = this.#profile.kind === TestRunProfileKind.Debug ? this.#context.debug : this.#context.spawn;
		const r = await spawn(this.#context, goRuntimePath, flags, {
			run,
			cwd: pkg.goItem.uri.fsPath,
			cancel: token,
			stdout: (s: string | null) => {
				if (!s) return;
				this.#context.output.debug(`stdout> ${s}`);
				pkg.onStdout(s);
			},
			stderr: (s: string | null) => {
				if (!s) return;
				this.#context.output.debug(`stderr> ${s}`);
				pkg.onStderr(s);
			}
		});
		if (r && r.code !== 0 && r.code !== 1) {
			run.errored(pkg.testItem, {
				message: `\`go test\` exited with ${[
					...(r.code ? [`code ${r.code}`] : []),
					...(r.signal ? [`signal ${r.signal}`] : [])
				].join(', ')}`
			});
		}
	}
}

export function shouldRunBenchmarks(workspace: Workspace, pkg: Package) {
	// When the user clicks the run button on a package, they expect all of the
	// tests within that package to run - they probably don't want to run the
	// benchmarks. So if a benchmark is not explicitly selected, don't run
	// benchmarks. But the user may disagree, so behavior can be changed with
	// `testExplorer.runPackageBenchmarks`. However, if the user clicks the run
	// button on a file or package that contains benchmarks and nothing else,
	// they likely expect those benchmarks to run.
	if (workspace.getConfiguration('goExp', pkg.uri).get<boolean>('testExplorer.runPackageBenchmarks')) {
		return true;
	}
	for (const test of pkg.getTests()) {
		if (test.kind !== 'benchmark') {
			return false;
		}
	}
	return true;
}

function makeRegex(tests: Iterable<TestCase>, where: (_: TestCase) => boolean = () => true) {
	// TODO: Handle Go ≤ 1.17 (https://go.dev/issue/39904)
	return [...tests]
		.filter(where)
		.map((x) =>
			x.name
				.split('/')
				.map((part) => `^${escapeRegExp(part)}$`)
				.join('/')
		)
		.join('|');
}

// escapeRegExp escapes regex metacharacters.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
function escapeRegExp(v: string) {
	return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
