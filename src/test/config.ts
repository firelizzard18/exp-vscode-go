import { Context, doSafe, TestController, Workspace } from './testing';
import {
	CancellationToken,
	ConfigurationScope,
	FileCoverage,
	FileCoverageDetail,
	QuickPickOptions,
	TestRunProfileKind,
	TestRunRequest,
	TestTag,
	Uri,
	type window,
} from 'vscode';
import { Minimatch } from 'minimatch';
import deepEqual from 'deep-equal';
import { resolvePath, substituteEnv } from '../utils/util';
import { Flags } from './utils';
import { makeProfileTypeSet } from './profile';
import { GoLaunchRequest } from '../vscode-go';

/**
 * Wrapper for accessing test explorer configuration.
 */
export class TestConfig {
	readonly #workspace: Workspace;
	readonly #scope?: ConfigurationScope;
	#excludeValue?: string[];
	#excludeCompiled?: Minimatch[];

	constructor(workspace: Workspace, scope?: ConfigurationScope) {
		this.#workspace = workspace;
		this.#scope = scope;
	}

	/**
	 * Create a new {@link TestConfig} for a the given scope.
	 */
	for(scope?: ConfigurationScope) {
		return new TestConfig(this.#workspace, scope);
	}

	/**
	 * Get a configuration value.
	 */
	get<T>(name: string) {
		return this.#workspace.getConfiguration('goExp', this.#scope).get<T>(`testExplorer.${name}`);
	}

	readonly enable = () => this.get<boolean>('enable');
	readonly discovery = () => this.get<'on' | 'off'>('discovery');
	readonly showFiles = () => this.get<boolean>('showFiles');
	readonly nestPackages = () => this.get<boolean>('nestPackages');
	readonly nestSubtests = () => this.get<boolean>('nestSubtests');
	readonly codeLens = () => this.get<'on' | 'off' | 'run' | 'debug'>('codeLens');
	readonly runPackageBenchmarks = () => this.get<boolean>('runPackageBenchmarks');
	readonly dynamicSubtestLimit = () => this.get<number>('dynamicSubtestLimit');

	readonly testTags = () => {
		const cfg = this.#workspace.getConfiguration('go', this.#scope);
		return cfg.get<string[]>('testTags') || cfg.get<string[]>('buildTags') || [];
	};

	/**
	 * @returns An array of compiled minimatch patterns from `goExp.testExplorer.exclude` and `files.exclude`.
	 */
	readonly exclude = () => {
		// Merge files.exclude and goExp.testExplorer.exclude
		const a = this.get<Record<string, boolean>>('exclude') || {};
		const b = this.#workspace.getConfiguration('files', this.#scope).get<Record<string, boolean>>('exclude') || {};
		const v = Object.assign({}, b, a);

		// List enabled patterns
		const patterns = Object.entries(v)
			.filter(([, v]) => v)
			.map(([k]) => k);

		// Only recompile if the patterns have changed
		if (deepEqual(patterns, this.#excludeValue)) {
			return this.#excludeCompiled;
		}

		this.#excludeValue = patterns;
		this.#excludeCompiled = patterns.map((x) => new Minimatch(x));
		return this.#excludeCompiled;
	};

	/**
	 * @returns `go.testFlags` or `go.buildFlags`, converted to {@link Flags}.
	 */
	readonly testFlags = () => {
		// Determine the workspace folder from the scope
		const wsf =
			this.#scope instanceof Uri
				? this.#workspace.getWorkspaceFolder(this.#scope)
				: this.#scope?.uri
					? this.#workspace.getWorkspaceFolder(this.#scope.uri)
					: undefined;

		// Get go.testFlags or go.buildFlags
		const cfg = this.#workspace.getConfiguration('go', this.#scope);
		const flagArgs = cfg.get<string[]>('testFlags') || cfg.get<string[]>('buildFlags') || [];

		// Convert to an object
		const flags: Flags = {};
		for (let arg of flagArgs) {
			arg = arg.replace(/^--?/, '');
			const i = arg.indexOf('=');
			if (i === -1) {
				flags[arg] = true;
			} else {
				flags[arg.slice(0, i)] = resolvePath(arg.slice(i + 1), wsf?.uri?.fsPath);
			}
		}

		// Get go.testTags or go.buildTags
		const tags = cfg.get<string>('testTags') ?? cfg.get<string>('buildTags') ?? '';
		if (tags) flags.tags = tags;

		return flags;
	};

	/**
	 * @returns `go.testEnvVars` and `go.toolsEnvVars` (merged) with `${...}` expressions resolved.
	 */
	readonly testEnvVars = () => {
		// Determine the workspace folder from the scope
		const wsf =
			this.#scope instanceof Uri
				? this.#workspace.getWorkspaceFolder(this.#scope)
				: this.#scope?.uri
					? this.#workspace.getWorkspaceFolder(this.#scope.uri)
					: undefined;

		// Get go.toolsEnvVars and go.testEnvVars
		const cfg = this.#workspace.getConfiguration('go', this.#scope);
		const env = Object.assign(
			{},
			process.env,
			cfg.get<Record<string, string>>('toolsEnvVars'),
			cfg.get<Record<string, string>>('testEnvVars'),
		) as Record<string, string>;

		// Resolve ${...} expressions
		for (const key in env) {
			env[key] = resolvePath(substituteEnv(env[key]), wsf?.uri?.fsPath);
		}

		return env;
	};
}

type ConfigureArgs = Pick<typeof window, 'showQuickPick'>;

type CoverageScope = 'module' | 'package';

interface StoredSettings {
	profile: string[];
	coverageScope: CoverageScope;
}

export class RunConfig {
	static readonly #memento = 'runnerSettings';

	readonly settings = {
		profile: makeProfileTypeSet(),
		coverageScope: 'module',
	} as {
		readonly profile: ReturnType<typeof makeProfileTypeSet>;
		coverageScope: CoverageScope;
	};

	readonly #context: Context;
	readonly #label: string;
	readonly kind: TestRunProfileKind;
	readonly #isDefault?: boolean;
	readonly #tag?: TestTag;
	readonly #supportsContinuousRun?: boolean;
	readonly coverage = new WeakMap<FileCoverage, FileCoverageDetail[]>();
	readonly options: Partial<GoLaunchRequest> = {};

	constructor(
		context: Context,
		label: string,
		kind: TestRunProfileKind,
		isDefault?: boolean,
		tag?: TestTag,
		supportsContinuousRun?: boolean,
	) {
		this.#context = context;
		this.#label = label;
		this.kind = kind;
		this.#isDefault = isDefault;
		this.#tag = tag;
		this.#supportsContinuousRun = supportsContinuousRun;

		const stored = context.state.get<StoredSettings>(`${RunConfig.#memento}[${label}]`);
		if (stored) {
			this.settings.profile.forEach((x) => (x.enabled = (stored.profile ?? []).includes(x.id)));
			this.settings.coverageScope = stored.coverageScope;
		}
	}

	async #update() {
		await this.#context.state.update(`${RunConfig.#memento}[${this.#label}]`, {
			profile: this.settings.profile.filter((x) => x.enabled).map((x) => x.id),
			coverageScope: this.settings.coverageScope,
		} satisfies StoredSettings);
	}

	async configure(args: ConfigureArgs) {
		const options: QuickPickOptions = { title: 'Go tests' };
		if (this.kind === TestRunProfileKind.Coverage) {
			await configureMenu(args, options, {
				Coverage: () => this.#configureCoverage(args),
			});
		} else {
			await configureMenu(args, options, {
				Profiling: () => this.#configureProfiling(args),
			});
		}
	}

	async #configureProfiling(args: ConfigureArgs) {
		this.settings.profile.forEach((x) => (x.picked = x.enabled));
		const r = await args.showQuickPick(this.settings.profile, {
			title: 'Profile',
			canPickMany: true,
		});
		if (!r) return;

		this.settings.profile.forEach((x) => (x.enabled = r.includes(x)));
		await this.#update();
	}

	async #configureCoverage(args: ConfigureArgs) {
		await configureMenu(
			args,
			{ title: 'Coverage' },
			{
				Scope: () =>
					configureMenu(
						args,
						{ title: 'Coverage scope' },
						{
							Module: () => ((this.settings.coverageScope = 'module'), this.#update()),
							Package: () => ((this.settings.coverageScope = 'package'), this.#update()),
						},
					),
			},
		);
	}

	createRunProfile(
		args: ConfigureArgs,
		ctrl: TestController,
		runHandler: (request: TestRunRequest, token: CancellationToken) => Thenable<void> | void,
	) {
		const profile = ctrl.createRunProfile(
			this.#label,
			this.kind,
			runHandler,
			this.#isDefault,
			this.#tag,
			this.#supportsContinuousRun,
		);

		profile.loadDetailedCoverage = (_, summary) => Promise.resolve(this.coverage.get(summary) || []);

		if (this.kind !== TestRunProfileKind.Debug) {
			profile.configureHandler = () => doSafe(this.#context, 'configure profile', () => this.configure(args));
		}

		return profile;
	}
}

async function configureMenu(
	args: ConfigureArgs,
	options: QuickPickOptions,
	choices: Record<string, () => void | Promise<void>>,
) {
	for (;;) {
		const r = await args.showQuickPick(Object.keys(choices), options);
		if (!r || !(r in choices)) return;
		await choices[r]();
	}
}
