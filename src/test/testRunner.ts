/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { CancellationToken, FileCoverage, TestRunProfileKind, Uri } from 'vscode';
import { Context, TestController } from '../utils/testing';
import { Flags, makeCaptureDir, Spawner } from './utils';
import path from 'node:path';
import { parseCoverage } from './coverage';
import { RunConfig } from './runConfig';
import { PackageTestRun } from './pkgTestRun';
import { WorkspaceConfig } from './workspaceConfig';
import { TestCase } from './model';
import { TestRunLog } from './runLog';
import { ResolvedTestRunRequest, shouldRunBenchmarks } from './view/controller';

export class TestRunner {
	readonly #context;
	readonly #wsConfig;
	readonly #ctrl;
	readonly #config;
	readonly #token;

	constructor(
		context: Context,
		wsConfig: WorkspaceConfig,
		ctrl: TestController,
		config: RunConfig,
		token: CancellationToken,
	) {
		this.#context = context;
		this.#wsConfig = wsConfig;
		this.#ctrl = ctrl;
		this.#config = config;
		this.#token = token;
	}

	async run(rq: ResolvedTestRunRequest) {
		const run = this.#ctrl.createTestRun(rq.request);
		const sub = this.#token.onCancellationRequested(() => {
			run.appendOutput('\r\n*** Cancelled ***\r\n');
			run.end();
		});

		// Execute the tests.
		try {
			const invalid = rq.size > 1 && this.#config.kind === TestRunProfileKind.Debug;
			let first = true;
			for (const pkg of rq.packages(run)) {
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

				await this.#runPkg(rq, pkg);
			}
		} finally {
			run.end();
			sub.dispose();
		}
	}

	async #runPkg(rq: ResolvedTestRunRequest, pkg: PackageTestRun) {
		const time = new Date();

		// Enqueue tests.
		pkg.forEach((item) => {
			pkg.run.enqueued(item);
			item.error = undefined;
		});

		const flags: Flags = {};

		flags.fullpath = true; // Include the full path for output events
		flags.benchmem = true;

		if (pkg.mode === 'all') {
			// Include all test cases.
			flags.run = '.';
			if (shouldRunBenchmarks(this.#wsConfig, pkg.goItem)) {
				flags.bench = '.';
			}
		} else {
			// Include specific test cases.
			flags.run = makeRegex(pkg.tests.keys(), (x) => x.kind !== 'benchmark') || '-';
			flags.bench = makeRegex(pkg.tests.keys(), (x) => x.kind === 'benchmark') || '-';
		}
		if (pkg.exclude.size) {
			// Exclude specific test cases
			flags.skip = makeRegex(pkg.exclude.keys());
		}

		// Capture coverage
		let coveragePath: Uri | undefined;
		if (this.#config.kind === TestRunProfileKind.Coverage) {
			// Consider forking https://github.com/rillig/gobco for branch
			// coverage. The original version (https://github.com/junhwi/gobco)
			// could be used with `go test -toolexec`, so maybe we could make
			// the new version do that to.
			const dir = await makeCaptureDir(this.#context, pkg.run, pkg.goItem.uri, time);
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
			!rq.request.continuous &&
			// Is profiling enabled?
			this.#config.settings.profile.some((x) => x.enabled)
		) {
			const dir = await makeCaptureDir(this.#context, pkg.run, pkg.goItem.uri, time);
			flags.outputdir = dir.fsPath;
			flags.o = Uri.joinPath(dir, 'test.exe').fsPath;

			for (const profile of this.#config.settings.profile) {
				if (!profile.enabled) {
					continue;
				}

				// Use rel to make the cmdline nicer.
				const { file } = rq.attachProfile(pkg, dir, profile, time);
				const rel = path.relative(dir.fsPath, file.fsPath);
				flags[`${profile.id}profile`] = rel.startsWith('.') ? file.fsPath : rel;
			}
		}

		const cfg = this.#wsConfig.for(pkg.goItem);
		const log = new TestRunLog(pkg.run, pkg.testItem, (event) => rq.testForEvent(pkg.goItem, pkg.run, event));
		const r = await this.#spawn(this.#context, pkg.run, pkg.testItem.uri!, log, flags, cfg.testFlags.get(), [], {
			mode: 'test',
			cwd: pkg.goItem.uri.fsPath,
			env: cfg.testEnvVars.get(),
			cancel: this.#token,
			debug: this.#config.options,
			stdout: (s: string | null) => {
				if (!s) return;
				this.#context.output.debug(`stdout> ${s}`);
				log.onStdout(s);
			},
			stderr: (s: string | null) => {
				if (!s) return;
				this.#context.output.debug(`stderr> ${s}`);
				log.onStderr(s);
			},
		}).catch((error) => ({ error }));

		if (!r) {
			// The run was aborted for some reason.
			return;
		}

		if ('error' in r) {
			pkg.run.errored(pkg.testItem, {
				message: `${r.error}`,
			});
			return;
		}

		if (log.buildFailed) {
			// The run has already been marked as failed
			return;
		}

		if ('code' in r && r.code !== 0 && r.code !== 1) {
			pkg.run.errored(pkg.testItem, {
				message: `\`go test\` exited with ${[
					...(r.code ? [`code ${r.code}`] : []),
					...(r.signal ? [`signal ${r.signal}`] : []),
				].join(', ')}`,
			});
			return;
		}

		if (coveragePath && pkg.run.addCoverage && 'code' in r && r.code === 0) {
			const coverage = await parseCoverage(this.#context, pkg.goItem.parent, coveragePath);
			for (const [file, statements] of coverage) {
				const summary = FileCoverage.fromDetails(Uri.parse(file), statements);
				this.#config.coverage.set(summary, statements);
				pkg.run.addCoverage(summary);
			}
		}
	}

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
