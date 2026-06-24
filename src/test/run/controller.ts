/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import { makeCaptureDir } from '@/utils/capture';
import { Context } from '@/utils/common';
import { Flags, Spawner } from '@/utils/spawn';
import { TestController } from '@/utils/testing';
import path from 'node:path';
import { CancellationToken, EventEmitter, FileCoverage, TestRun, TestRunProfileKind, Uri } from 'vscode';
import { parseCoverage } from '../coverage';
import type { GoTestRequest } from '../manager';
import { GoTestItem, ModelController, Package, TestCase } from '../model';
import { CapturedProfile } from '../profiles';
import { ViewController } from '../view/controller';
import { WorkspaceConfig } from '../workspaceConfig';
import { RunConfig } from './config';
import { TestRunLog } from './log';
import { PackageTestRun } from './pkgTestRun';
import { RunEvent } from './runEvent';

export class RunController {
	readonly #context;
	readonly #wsConfig;
	readonly #ctrl;
	readonly #config;
	readonly #token;
	readonly #resolver;
	readonly #model;
	readonly #runEvents;

	constructor(
		context: Context,
		wsConfig: WorkspaceConfig,
		ctrl: TestController,
		config: RunConfig,
		token: CancellationToken,
		resolver: ViewController,
		model: ModelController,
		runEvents: EventEmitter<RunEvent>,
	) {
		this.#context = context;
		this.#wsConfig = wsConfig;
		this.#ctrl = ctrl;
		this.#config = config;
		this.#token = token;
		this.#resolver = resolver;
		this.#model = model;
		this.#runEvents = runEvents;
	}

	async run(rq: GoTestRequest) {
		const run = this.#ctrl.createTestRun(rq.request);
		const sub = this.#token.onCancellationRequested(() => {
			run.appendOutput('\r\n*** Cancelled ***\r\n');
			run.end();
		});

		// Execute the tests.
		try {
			const invalid = rq.packages.size > 1 && this.#config.kind === TestRunProfileKind.Debug;
			let first = true;
			for (const pkg of this.#packages(rq, run)) {
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

	*#packages(rq: GoTestRequest, run: TestRun) {
		// When the run is disposed, remove all dynamic test cases
		// associated with it.
		run.onDidDispose?.(() => {
			for (const pkg of rq.packages) {
				this.#runEvents.fire({ type: 'disposed', run, pkg });
			}
		});

		// Enqueue all of the packages.
		for (const pkg of rq.packages) {
			run.enqueued(this.#resolver.resolveViewItem(pkg));
		}

		const map = <T extends GoTestItem>(items: T[]) =>
			new Map(items.map((x) => [x, this.#resolver.resolveViewItem(x)]));
		for (const pkg of rq.packages) {
			const mode = rq.include.has(pkg) ? 'all' : 'specific';
			const include = mode === 'all' ? map([...pkg.allTests()]) : map(rq.pkgInclude.get(pkg) ?? []);
			const exclude = map(rq.pkgExclude.get(pkg) ?? []);

			if (mode === 'all') {
				this.#runEvents.fire({ type: 'start', run, pkg });
			} else {
				this.#runEvents.fire({
					type: 'start',
					run,
					pkg,
					include: new Set([...include.keys()]),
					exclude: new Set([...exclude.keys()]),
				});
			}

			yield new PackageTestRun({
				run,
				mode,
				goItem: pkg,
				testItem: this.#resolver.resolveViewItem(pkg),
				tests: include,
				exclude,
			});
		}
	}

	async #runPkg(rq: GoTestRequest, pkg: PackageTestRun) {
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

			let expr = path.join(path.relative(pkg.goItem.uri.fsPath, pkg.goItem.root.dir.fsPath));
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

			// Where should we attach the profiles? If there is a single
			// item included, attach to it, otherwise attach to the package.
			const scope: GoTestItem = pkg.tests.size === 1 ? [...pkg.tests][0][0] : pkg.goItem;

			for (const type of this.#config.settings.profile) {
				if (!type.enabled) {
					continue;
				}

				// Create the object and fire a notification.
				const profile = new CapturedProfile(type, time, dir);
				this.#runEvents.fire({ type: 'captured', pkg: pkg.goItem, run: pkg.run, scope, profile });

				// Use rel to make the cmdline nicer.
				const rel = path.relative(dir.fsPath, profile.file.fsPath);
				flags[`${type.id}profile`] = rel.startsWith('.') ? profile.file.fsPath : rel;
			}
		}

		const cfg = this.#wsConfig.for(pkg.goItem);
		const seen = new Set<string>();
		const log = new TestRunLog(pkg.run, pkg.testItem, (query) => {
			// Have we see this test before? If it's a new dynamic subtest, the
			// model will create a new item for it in response to the event,
			// which will trigger an update event, which will trigger a
			// recursive update of the parent.
			if (typeof query === 'string' && query.includes('/') && !seen.has(query)) {
				seen.add(query);
				this.#runEvents.fire({
					type: 'subtest',
					run: pkg.run,
					pkg: pkg.goItem,
					name: query,
				});
			}

			// Locate the test, and if it exists then resolve and return the
			// view item.
			const test = this.#model.findTest(pkg.goItem, query);
			return test && this.#resolver.resolveViewItem(test);
		});

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
			const coverage = await parseCoverage(this.#context, pkg.goItem.root, coveragePath);
			for (const [file, statements] of coverage) {
				const summary = FileCoverage.fromDetails(Uri.parse(file), statements);
				this.#config.coverage.set(summary, statements);
				pkg.run.addCoverage(summary);
			}
		}
	}

	/** Dispatches to the appropriate spawner utility. */
	#spawn(...args: Parameters<Spawner>) {
		switch (this.#config.kind) {
			case TestRunProfileKind.Debug:
				return this.#context.debug(...args);
			default:
				return this.#context.spawn(...args);
		}
	}
}

export function shouldRunBenchmarks(config: WorkspaceConfig, pkg: Package) {
	// When the user clicks the run button on a package, they expect all of the
	// tests within that package to run - they probably don't want to run the
	// benchmarks. So if a benchmark is not explicitly selected, don't run
	// benchmarks. But the user may disagree, so behavior can be changed with
	// `testExplorer.runPackageBenchmarks`. However, if the user clicks the run
	// button on a file or package that contains benchmarks and nothing else,
	// they likely expect those benchmarks to run.
	if (config.for(pkg).runPackageBenchmarks.get()) {
		return true;
	}
	if (pkg.files.size === 0) {
		// If the files haven't been resolved yet, assume there are
		// non-benchmarks.
		return false;
	}
	for (const test of pkg.allTests()) {
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
