/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { CancellationToken, FileCoverage, TestRun, TestRunProfileKind, Uri, workspace } from 'vscode';
import type vscode from 'vscode';
import { Context, TestController, VSCodeWorkspace } from '../utils/testing';
import { Flags, Spawner } from './utils';
import { ProfileType } from './profile';
import path from 'node:path';
import { getTempDirPath } from '../utils/util';
import { createHash } from 'node:crypto';
import { parseCoverage } from './coverage';
import { TaskQueue } from '../utils/taskQueue';
import { RunConfig } from './runConfig';
import { GoTestItemResolver, shouldRunBenchmarks } from './itemResolver';
import { PackageTestRun, ResolvedRunRequest } from './pkgTestRun';
import { WorkspaceConfig } from './workspaceConfig';
import { Package, StaticTestCase, TestCase, Workspace } from './model';

export class TestRunner {
	readonly #context;
	readonly #wsConfig;
	readonly #ctrl;
	readonly #config;
	readonly #request;
	readonly #token;

	constructor(
		context: Context,
		wsConfig: WorkspaceConfig,
		ctrl: TestController,
		config: RunConfig,
		request: ResolvedRunRequest,
		token: CancellationToken,
	) {
		this.#context = context;
		this.#wsConfig = wsConfig;
		this.#ctrl = ctrl;
		this.#config = config;
		this.#request = request;
		this.#token = token;
	}

	async run() {
		await this.#run(this.#request);
	}

	/*async runContinuous(items: TestCase[]) {
		if (items.length) {
			await this.#run(await this.#request.with(items), true);
		}
	}*/

	async #run(request: ResolvedRunRequest, continuous = false) {
		const run = this.#ctrl.createTestRun(request.request);
		const sub = this.#token.onCancellationRequested(() => {
			run.appendOutput('\r\n*** Cancelled ***\r\n');
			run.end();
		});

		// Execute the tests
		try {
			const invalid = request.size > 1 && this.#config.kind === TestRunProfileKind.Debug;
			let first = true;
			for (const pkg of request.packages(run)) {
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
			sub.dispose();
		}
	}

	async #runPkg(pkg: PackageTestRun, run: vscode.TestRun, continuous: boolean) {
		const time = new Date();

		/*/ Determine the profile parent before removing dynamic test cases. If
		// the request is for a single test, add the profiles to that test,
		// otherwise add them to the package. If the profile parent is a
		// sub-test, add the profile to its top-most parent test.
		let profileParent = pkg.include.size === 1 ? [...pkg.include][0][0] : pkg.goItem;
		while (profileParent instanceof TestCase) {
			const parent = pkg.goItem.testRelations.getParent(profileParent);
			if (!parent) break;
			profileParent = parent;
		}*/

		// Enqueue tests.
		pkg.forEach((item) => {
			run.enqueued(item);
		});

		const flags: Flags = {};

		flags.fullpath = true; // Include the full path for output events

		if (pkg.mode === 'all') {
			// Include all test cases
			flags.run = '.';
			if (shouldRunBenchmarks(this.#wsConfig, pkg.goItem)) {
				flags.bench = '.';
			}
		} else {
			// Include specific test cases
			flags.run = makeRegex(pkg.tests.keys(), (x) => x.kind !== 'benchmark') || '-';
			flags.bench = makeRegex(pkg.tests.keys(), (x) => x.kind === 'benchmark') || '-';
		}
		if (pkg.exclude.size) {
			// Exclude specific test cases
			flags.skip = makeRegex(pkg.exclude.keys());
		}

		/*/ Capture coverage
		let coveragePath: Uri | undefined;
		if (this.#config.kind === TestRunProfileKind.Coverage) {
			// Consider forking https://github.com/rillig/gobco for branch
			// coverage. The original version (https://github.com/junhwi/gobco)
			// could be used with `go test -toolexec`, so maybe we could make
			// the new version do that to.
			const dir = await makeCaptureDir(this.#context, run, profileParent.uri, time);
			coveragePath = Uri.joinPath(dir, 'coverage.log');
			flags.coverprofile = coveragePath.fsPath;
			flags.covermode = 'count';

			let expr = path.join(path.relative(pkg.goItem.uri.fsPath, pkg.goItem.parent.dir.fsPath));
			if (!expr.startsWith('.')) {
				expr = path.join('.', expr);
			}
			if (this.#config.settings.coverageScope === 'module') {
				if (expr === '.') {
					flags.coverpkg = './...';
				} else {
					flags.coverpkg = path.join(expr, '...');
				}
			}
		}

		// Capture profiles
		if (
			// Profiling is disabled for continuous runs
			!continuous &&
			// Is profiling enabled?
			this.#config.settings.profile.some((x) => x.enabled) &&
			// Profiles can only be attached to a package or a static test case
			(profileParent instanceof Package || profileParent instanceof StaticTestCase)
		) {
			const dir = await makeCaptureDir(this.#context, run, profileParent.uri, time);
			for (const profile of this.#config.settings.profile) {
				if (!profile.enabled) {
					continue;
				}

				const file = await this.#registerCapturedProfile(run, profileParent, dir, profile, time);
				flags[`${profile.id}profile`] = file.uri.fsPath;
			}
		}*/

		// When printing flags, use ${workspaceFolder} for the workspace folder
		const ws = pkg.goItem.parent instanceof Workspace ? pkg.goItem.parent : pkg.goItem.parent.workspace;
		const niceFlags = Object.assign({}, flags);
		if (ws) {
			for (const [flag, value] of Object.entries(niceFlags)) {
				if (typeof value === 'string') {
					niceFlags[flag] = value.replace(ws.uri.fsPath, '${workspaceFolder}');
				}
			}
		}

		// Use a task queue to ensure stdout calls are sequenced
		const q = new TaskQueue();

		const cfg = this.#wsConfig.for(pkg.goItem);
		const r = await this.#spawn(this.#context, pkg, flags, cfg.testFlags.get(), [], {
			mode: 'test',
			cwd: pkg.goItem.uri.fsPath,
			env: cfg.testEnvVars.get(),
			cancel: this.#token,
			debug: this.#config.options,
			stdout: (s: string | null) => {
				if (!s) return;
				this.#context.output.debug(`stdout> ${s}`);
				q.do(() => pkg.onStdout(s));
			},
			stderr: (s: string | null) => {
				if (!s) return;
				this.#context.output.debug(`stderr> ${s}`);
				pkg.onStderr(s);
			},
		}).catch((error) => ({ error }));

		if (!r) {
			// The run was aborted for some reason.
			return;
		}

		if ('error' in r) {
			run.errored(pkg.testItem, {
				message: `${r.error}`,
			});
			return;
		}

		if (pkg.buildFailed) {
			// The run has already been marked as failed
			return;
		}

		if ('code' in r && r.code !== 0 && r.code !== 1) {
			run.errored(pkg.testItem, {
				message: `\`go test\` exited with ${[
					...(r.code ? [`code ${r.code}`] : []),
					...(r.signal ? [`signal ${r.signal}`] : []),
				].join(', ')}`,
			});
			return;
		}

		/*if (coveragePath && run.addCoverage && 'code' in r && r.code === 0) {
			const coverage = await parseCoverage(this.#context, pkg.goItem.parent, coveragePath);
			for (const [file, statements] of coverage) {
				const summary = FileCoverage.fromDetails(Uri.parse(file), statements);
				this.#config.coverage.set(summary, statements);
				run.addCoverage(summary);
			}
		}*/
	}

	/*async #registerCapturedProfile(
		run: TestRun,
		item: Package | StaticTestCase,
		dir: Uri,
		type: ProfileType,
		time: Date,
	) {
		const profile = await item.profiles.addProfile(dir, type, time);
		await this.#resolver.reloadGoItem(item);

		run.onDidDispose?.(async () => {
			item.profiles.removeProfile(profile);
			await this.#resolver.reloadGoItem(item);
		});
		return profile;
	}*/

	#spawn(...args: Parameters<Spawner>) {
		switch (this.#config.kind) {
			case TestRunProfileKind.Debug:
				return this.#context.debug(...args);
			default:
				return this.#context.spawn(...args);
		}
	}
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

const captureDirs = new WeakMap<TestRun, Map<Uri, Uri>>();

/**
 * Creates a storage directory for captures taken during a test run.
 *
 * Ideally, if the test run is persisted and supports onDidDispose, it would
 * return the extensions's storage URI. However there are issues with that (see
 * the comment in the function).
 *
 * @param context - The context object.
 * @param run - The test run object.
 * @returns The storage directory URI.
 */
async function makeCaptureDir(context: Context, run: TestRun, scope: Uri, time: Date): Promise<Uri> {
	// Avoid multiple FS calls
	let cache = captureDirs.get(run);
	if (!cache) {
		cache = new Map();
		captureDirs.set(run, cache);
	}
	if (cache.has(scope)) {
		return cache.get(scope)!;
	}

	const tmp = captureTempDir();

	// This is a simple way to make an ID from the package URI
	const hash = createHash('sha256').update(`${scope}`).digest('hex');
	const dir = Uri.joinPath(tmp, `${hash.substring(0, 16)}-${time.getTime()}`);

	// Store before awaiting to avoid concurrency issues
	cache.set(scope, dir);

	const { fs } = context.workspace;
	await fs.createDirectory(dir);
	run.onDidDispose?.(() => fs.delete(dir, { recursive: true }));

	return dir;
}

function captureTempDir(): Uri {
	// Profiles can be deleted when the run is disposed, but there's no way to
	// re-associated profiles with a past run when VSCode is closed and
	// reopened. So we always use the OS temp directory for now.
	// https://github.com/microsoft/vscode/issues/227924

	// if (run.isPersisted && run.onDidDispose && context.storageUri) {
	// 	return context.storageUri;
	// }

	return Uri.file(getTempDirPath());
}
