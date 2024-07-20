/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	CancellationToken,
	TestController,
	TestItem,
	TestRunProfile,
	TestRunProfileKind,
	TestRunRequest
} from 'vscode';
import * as vscode from 'vscode';
import { GoTestItem, Package, RootItem, TestCase, TestFile } from './GoTestItem';
import { TestItemResolver } from './TestItemResolver';
import { Workspace } from './testSupport';

export interface GoTestRunRequest extends Omit<TestRunRequest, 'include' | 'exclude'> {
	readonly packages: Set<Package>;
	readonly include: Map<Package, TestCase[]>;
	readonly exclude: Map<Package, TestCase[]>;
}

export class GoTestRunner {
	readonly #workspace: Workspace;
	readonly #ctrl: TestController;
	readonly #resolver: TestItemResolver<GoTestItem>;
	readonly #profile: TestRunProfile;

	constructor(
		workspace: Workspace,
		ctrl: TestController,
		doSafe: <T>(msg: string, fn: () => T | Promise<T>) => T | undefined | Promise<T | undefined>,
		resolver: TestItemResolver<GoTestItem>,
		label: string,
		kind: TestRunProfileKind,
		isDefault = false
	) {
		this.#workspace = workspace;
		this.#ctrl = ctrl;
		this.#resolver = resolver;
		this.#profile = ctrl.createRunProfile(
			label,
			kind,
			(request, token) =>
				doSafe('execute test', async () => {
					const r = await resolveRunRequest(workspace, resolver, request);
					await this.#run(r, token);
				}),
			isDefault
		);
	}

	async #run(request: GoTestRunRequest, token: CancellationToken) {
		// Save all files to ensure `go test` tests the latest changes
		await this.#workspace.saveAll(false);

		const showOutput = [...request.packages].some((x) =>
			this.#workspace.getConfiguration('goExp', x.uri).get<boolean>('testExplorer.showOutput')
		);
		if (showOutput) {
			// This directly references vscode.commands and thus is harder to
			// verify in a test but I think it's ok to test this manually
			await vscode.commands.executeCommand('testing.showMostRecentOutput');
		}

		// Pretend to run the tests
		for (const pkg of request.packages) {
			const pkgItem = await this.#resolver.getOrCreateAll(pkg);
			const include = await resolveTestItems(this.#resolver, request.include.get(pkg) || pkg.getTests());
			const exclude = await resolveTestItems(this.#resolver, request.exclude.get(pkg) || []);

			const run = this.#ctrl.createTestRun({
				...request,
				include: [...include.values()],
				exclude: [...exclude.values()]
			});

			run.enqueued(pkgItem);
			for (const [goItem, item] of include) {
				if (!exclude.has(goItem)) {
					run.enqueued(item);
				}
			}

			for (const [goItem, item] of include) {
				if (!exclude.has(goItem)) {
					run.skipped(item);
				}
			}
			run.end();
		}
	}
}

async function resolveRunRequest(
	workspace: Workspace,
	resolver: TestItemResolver<GoTestItem>,
	request: TestRunRequest
) {
	const include = (request.include || [...resolver.roots]).map((x) => resolveGoTestItem(resolver, x));
	const exclude = request.exclude?.map((x) => resolveGoTestItem(resolver, x)) || [];

	// Get roots that aren't excluded
	const roots = new Set(include.filter((x) => x instanceof RootItem));
	exclude.forEach((x) => roots.delete(x as any));

	// Get packages that aren't excluded
	const packages = new Set(include.filter((x) => x instanceof Package));
	await Promise.all(
		[...roots].map(async (x) => {
			for (const pkg of (await x.getPackages()) || []) {
				packages.add(pkg);
			}
		})
	);
	exclude.forEach((x) => packages.delete(x as any));

	// Get explicitly requested test items that aren't excluded
	const tests = new Set(testCases(include));
	for (const test of testCases(exclude)) {
		tests.delete(test);
	}

	// Remove redundant requests for specific tests
	for (const item of tests) {
		const pkg = item.parent.parent;
		if (!packages.has(pkg)) {
			continue;
		}

		// If a package is selected, all tests within it will be run so ignore
		// explicit requests for a test if its package is selected. Do the same
		// for benchmarks, if shouldRunBenchmarks.
		if (item.kind !== 'benchmark' || shouldRunBenchmarks(workspace, pkg)) {
			tests.delete(item);
		}
	}

	// Record requests for specific tests
	const testsForPackage = new Map<Package, TestCase[]>();
	for (const item of tests) {
		const pkg = item.parent.parent;
		packages.add(pkg);

		if (!testsForPackage.has(pkg)) {
			testsForPackage.set(pkg, []);
		}
		testsForPackage.get(pkg)!.push(item);
	}

	// Tests that should be excluded for each package
	const excludeForPackage = new Map<Package, TestCase[]>();
	for (const item of testCases(exclude)) {
		const pkg = item.parent.parent;
		if (!packages.has(pkg)) continue;

		if (!excludeForPackage.has(pkg)) {
			excludeForPackage.set(pkg, []);
		}
		excludeForPackage.get(pkg)!.push(item);
	}

	return {
		...request,
		packages,
		include: testsForPackage,
		exclude: excludeForPackage
	};
}

function shouldRunBenchmarks(workspace: Workspace, pkg: Package) {
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

async function resolveTestItems(resolver: TestItemResolver<GoTestItem>, goItems: GoTestItem[]) {
	return new Map(
		await Promise.all(
			goItems.map(async (x): Promise<[GoTestItem, TestItem]> => [x, await resolver.getOrCreateAll(x)])
		)
	);
}

function resolveGoTestItem(resolver: TestItemResolver<GoTestItem>, item: TestItem) {
	const pi = resolver.getProviderItem(item.id);
	if (!pi) throw new Error(`Cannot find test item ${item.id}`);
	return pi;
}

function* testCases(items: GoTestItem[]) {
	for (const item of items) {
		if (item instanceof TestCase) {
			yield item;
		}
		if (item instanceof TestFile) {
			yield* item.getTests();
		}
	}
}
