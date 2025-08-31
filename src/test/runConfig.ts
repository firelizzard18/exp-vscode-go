import { Context, doSafe, TestController } from '../utils/testing';
import {
	CancellationToken,
	FileCoverage,
	FileCoverageDetail,
	QuickPickItem,
	QuickPickOptions,
	TestRunProfileKind,
	TestRunRequest,
	TestTag,
	type window,
} from 'vscode';
import { makeProfileTypeSet } from './profile';
import { GoLaunchRequest } from '../vscode-go';

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
		const options: QuickPickOptions = { title: 'Configure Go tests' };
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
		const makeScopeOption = ({ scope, ...item }: QuickPickItem & { scope: CoverageScope }) => ({
			...item,
			description: this.settings.coverageScope === scope ? '✓' : undefined,
			func: () => ((this.settings.coverageScope = scope), this.#update()),
		});

		await configureMenu(
			args,
			{ title: 'Configure test coverage' },
			{
				Scope: () =>
					configureMenuOnce(args, { title: 'Configure test coverage scope' }, [
						makeScopeOption({
							label: 'Module',
							scope: 'module',
							detail: 'Show coverage for the entire module',
						}),
						makeScopeOption({
							label: 'Package',
							scope: 'package',
							detail: 'Only show coverage for the package the test belongs to',
						}),
					]),
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

type ConfigMenuFunc = () => void | boolean | Promise<void | boolean>;

async function configureMenu(...args: Parameters<typeof configureMenuOnce>) {
	for (;;) {
		const r = await configureMenuOnce(...args);
		if (!r) return;
	}
}

async function configureMenuOnce(
	args: ConfigureArgs,
	options: QuickPickOptions,
	choices: Record<string, ConfigMenuFunc> | (QuickPickItem & { func: ConfigMenuFunc })[],
) {
	const r = await args.showQuickPick(
		choices instanceof Array
			? choices
			: Object.entries(choices).map(([label, func]) => ({
					label,
					func,
				})),
		options,
	);
	await r?.func();
	return !!r;
}
