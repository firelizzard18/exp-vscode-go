/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { CancellationToken, Memento, TestRunProfile, TestRunProfileKind, Uri } from 'vscode';
import type vscode from 'vscode';
import { Package, TestCase, TestFile } from './item';
import { Context, Workspace } from './testing';
import { PackageTestRun, TestRunRequest } from './run';
import { SpawnOptions } from './utils';
import { CapturedProfile, makeProfileTypeSet } from './profile';
import { TestItemProviderAdapter } from './itemAdapter';

const settingsMemento = 'runnerSettings';

interface StoredSettings {
	profile?: string[];
}

export interface RunConfig {
	profile?: TestRunProfile;
	readonly settings: RunnerSettings;
}

export class RunnerSettings {
	readonly profile = makeProfileTypeSet();

	constructor(id: string, state: Memento) {
		this.id = id;
		this.state = state;

		const { profile = [] } = state.get<StoredSettings>(`${settingsMemento}[${id}]`) || {};
		this.profile.forEach((x) => (x.enabled = profile.includes(x.id)));
	}

	readonly id: string;
	readonly state: Memento;

	async configure(args: Pick<typeof vscode.window, 'showQuickPick'>) {
		switch (await args.showQuickPick(['Profiling'], { title: 'Go tests' })) {
			case 'Profiling': {
				this.profile.forEach((x) => (x.picked = x.enabled));
				const r = await args.showQuickPick(this.profile, {
					title: 'Profile',
					canPickMany: true
				});
				if (!r) return;
				this.profile.forEach((x) => (x.enabled = r.includes(x)));
				await this.#update();
			}
		}
	}

	async #update() {
		await this.state.update(`runnerSettings[${this.id}]`, {
			profile: this.profile.filter((x) => x.enabled).map((x) => x.id)
		} satisfies StoredSettings);
	}
}

export class TestRunner {
	readonly #context: Context;
	readonly #resolver: TestItemProviderAdapter;
	readonly #config: Required<RunConfig>;
	readonly #createRun: (_: TestRunRequest) => vscode.TestRun;
	readonly #request: TestRunRequest;
	readonly #token: CancellationToken;

	readonly #continuous = new Set<TestCase | TestFile>();

	constructor(
		context: Context,
		provider: TestItemProviderAdapter,
		config: Required<RunConfig>,
		createRun: (_: TestRunRequest) => vscode.TestRun,
		request: TestRunRequest,
		token: CancellationToken
	) {
		this.#context = context;
		this.#resolver = provider;
		this.#config = config;
		this.#createRun = createRun;
		this.#request = request;
		this.#token = token;
	}

	async run() {
		// Save all files to ensure `go test` tests the latest changes
		await this.#context.workspace.saveAll(false);

		await this.#run(this.#request);
	}

	async queueForContinuousRun(items: Iterable<TestCase | TestFile>) {
		for (const item of items) {
			this.#continuous.add(item);
		}
	}

	async runContinuous(uri: Uri) {
		const items = new Set<TestCase | TestFile>();
		for (const item of this.#continuous) {
			const file = item instanceof TestFile ? item : item.file;
			if (`${file.uri}` === `${uri}`) {
				items.add(item);
				this.#continuous.delete(item);
			}
		}

		if (items.size) {
			await this.#run(await this.#request.with(items));
		}
	}

	async #run(request: TestRunRequest) {
		const run = this.#createRun(request);

		// Execute the tests
		try {
			const invalid = request.size > 1 && this.#config.profile.kind === TestRunProfileKind.Debug;
			let first = true;
			for await (const pkg of request.packages(run)) {
				if (invalid) {
					pkg.forEach((item) =>
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

				await this.#runPkg(pkg, run);
			}
		} finally {
			run.end();
		}
	}

	// `goTest` from vscode-go
	async #runPkg(pkg: PackageTestRun, run: vscode.TestRun) {
		pkg.forEach((item, goItem) => {
			run.enqueued(item);
			goItem?.removeDynamicTestCases();
		});

		const { binPath: goRuntimePath } = this.#context.go.settings.getExecutionCommand('go', pkg.goItem.uri) || {};
		if (!goRuntimePath) {
			pkg.forEach((item) =>
				run.errored(item, {
					message: 'Failed to run "go test" as the "go" binary cannot be found in either GOROOT or PATH'
				})
			);
			return;
		}

		// TODO: add test flags, test tags, environment variables, etc.

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

		// Create the profile directory
		const profileDir = CapturedProfile.storageDir(this.#context, run);
		await this.#context.workspace.fs.createDirectory(profileDir);

		// If the request is for a single test, add the profiles to that test,
		// otherwise add them to the package
		const profileParent = pkg.include.size === 1 ? [...pkg.include][0][0] : pkg.goItem;

		// Setup the profiles
		const time = new Date();
		for (const profile of this.#config.settings.profile) {
			if (!profile.enabled) {
				continue;
			}

			const file = await this.#resolver.registerCapturedProfile(run, profileParent, profileDir, profile, time);
			flags.push(`${profile.flag}=${file.uri.fsPath}`);
			run.onDidDispose?.(() => this.#context.workspace.fs.delete(file.uri));
		}

		pkg.append(
			`$ cd ${pkg.goItem.uri.fsPath}\n$ ${goRuntimePath} test ${flags.join(' ')}\n\n`,
			undefined,
			pkg.testItem
		);
		const r = await this.#spawn(goRuntimePath, flags, {
			run: run,
			cwd: pkg.goItem.uri.fsPath,
			cancel: this.#token,
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

	#spawn(command: string, flags: readonly string[], options: SpawnOptions) {
		switch (this.#config.profile.kind) {
			case TestRunProfileKind.Debug:
				return this.#context.debug(this.#context, command, flags, options);
			default:
				return this.#context.spawn(this.#context, command, flags, options);
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
