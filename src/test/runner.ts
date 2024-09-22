/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { CancellationToken, Memento, TestRun, TestRunProfile, TestRunProfileKind, Uri } from 'vscode';
import type vscode from 'vscode';
import { Package, TestCase, TestFile } from './item';
import { Context, Workspace } from './testing';
import { PackageTestRun, TestRunRequest } from './run';
import { Flags, flags2args, Spawner, SpawnOptions } from './utils';
import { CapturedProfile, makeProfileTypeSet, ProfileType } from './profile';
import { TestResolver } from './resolver';
import { TestConfig } from './config';

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
					canPickMany: true,
				});
				if (!r) return;
				this.profile.forEach((x) => (x.enabled = r.includes(x)));
				await this.#update();
			}
		}
	}

	async #update() {
		await this.state.update(`runnerSettings[${this.id}]`, {
			profile: this.profile.filter((x) => x.enabled).map((x) => x.id),
		} satisfies StoredSettings);
	}
}

export class TestRunner {
	readonly #context: Context;
	readonly #resolver: TestResolver;
	readonly #config: Required<RunConfig>;
	readonly #createRun: (_: TestRunRequest) => vscode.TestRun;
	readonly #request: TestRunRequest;
	readonly #token: CancellationToken;

	readonly #continuous = new Set<TestCase | TestFile>();

	constructor(
		context: Context,
		provider: TestResolver,
		config: Required<RunConfig>,
		createRun: (_: TestRunRequest) => vscode.TestRun,
		request: TestRunRequest,
		token: CancellationToken,
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
			await this.#run(await this.#request.with(items), true);
		}
	}

	async #run(request: TestRunRequest, continuous = false) {
		const run = this.#createRun(request);

		// Execute the tests
		try {
			const invalid = request.size > 1 && this.#config.profile.kind === TestRunProfileKind.Debug;
			let first = true;
			for await (const pkg of request.packages(run)) {
				if (invalid) {
					pkg.forEach((item) =>
						run.errored(item, {
							message: 'Debugging multiple test packages is not supported',
						}),
					);
					continue;
				}

				if (first) {
					first = false;
				} else {
					run.appendOutput('\r\n\r\n');
				}

				await this.#runPkg(pkg, run, continuous);
			}
		} finally {
			run.end();
		}
	}

	// `goTest` from vscode-go
	async #runPkg(pkg: PackageTestRun, run: vscode.TestRun, continuous: boolean) {
		pkg.forEach((item, goItem) => {
			run.enqueued(item);
			goItem?.removeDynamicTestCases();
		});

		const cfg = new TestConfig(this.#context.workspace, pkg.goItem.uri);
		const flags = Object.assign({}, cfg.testFlags());

		flags.fullpath = true; // Include the full path for output events

		if (pkg.includeAll) {
			// Include all test cases
			flags.run = '.';
			if (shouldRunBenchmarks(this.#context.workspace, pkg.goItem)) {
				flags.bench = '.';
			}
		} else {
			// Include specific test cases
			flags.run = makeRegex(pkg.include.keys(), (x) => x.kind !== 'benchmark') || '-';
			flags.bench = makeRegex(pkg.include.keys(), (x) => x.kind === 'benchmark') || '-';
		}
		if (pkg.exclude.size) {
			// Exclude specific test cases
			flags.skip = makeRegex(pkg.exclude.keys());
		}

		// Profiling is disabled for continuous runs
		if (!continuous && this.#config.settings.profile.some((x) => x.enabled)) {
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

				const file = await this.#registerCapturedProfile(run, profileParent, profileDir, profile, time);
				flags[`${profile.id}profile`] = file.uri.fsPath;
				run.onDidDispose?.(() => this.#context.workspace.fs.delete(file.uri));
			}
		}

		// When printing flags, use ${workspaceFolder} for the workspace folder
		const ws = this.#context.workspace.getWorkspaceFolder(pkg.goItem.uri);
		const niceFlags = Object.assign({}, flags);
		if (ws) {
			for (const [flag, value] of Object.entries(niceFlags)) {
				if (typeof value === 'string') {
					niceFlags[flag] = value.replace(ws.uri.fsPath, '${workspaceFolder}');
				}
			}
		}

		pkg.append(
			`$ cd ${pkg.goItem.uri.fsPath}\n$ go test ${flags2args(niceFlags).join(' ')}\n\n`,
			undefined,
			pkg.testItem,
		);
		const r = await this.#spawn(this.#context, pkg.goItem.uri, flags, {
			run: run,
			cwd: pkg.goItem.uri.fsPath,
			env: cfg.testEnvVars(),
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
			},
		}).catch((err) => {
			run.errored(pkg.testItem, {
				message: `${err}`,
			});
		});
		if (r && r.code !== 0 && r.code !== 1) {
			run.errored(pkg.testItem, {
				message: `\`go test\` exited with ${[
					...(r.code ? [`code ${r.code}`] : []),
					...(r.signal ? [`signal ${r.signal}`] : []),
				].join(', ')}`,
			});
		}
	}

	async #registerCapturedProfile(run: TestRun, item: Package | TestCase, dir: Uri, type: ProfileType, time: Date) {
		const profile = await item.profiles.addProfile(dir, type, time);
		await this.#resolver.reloadGoItem(item);

		run.onDidDispose?.(async () => {
			item.profiles.removeProfile(profile);
			await this.#resolver.reloadGoItem(item);
		});
		return profile;
	}

	#spawn(...args: Parameters<Spawner>) {
		switch (this.#config.profile.kind) {
			case TestRunProfileKind.Debug:
				return this.#context.debug(...args);
			default:
				return this.#context.spawn(...args);
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
	return [...tests]
		.filter(where)
		.map((x) =>
			x.name
				.split('/')
				.map((part) => `^${escapeRegExp(part)}$`)
				.join('/'),
		)
		.join('|');
}

// escapeRegExp escapes regex metacharacters.
// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide/Regular_Expressions#escaping
function escapeRegExp(v: string) {
	return v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
