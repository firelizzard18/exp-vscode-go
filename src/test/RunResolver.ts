/* eslint-disable @typescript-eslint/no-explicit-any */

import { TestItem } from 'vscode';
import { GoTestItem, Package, RootItem, TestCase, TestFile } from './GoTestItem';
import { TestItemResolver } from './TestItemResolver';
import { Context } from './testSupport';
import { TestRunRequest } from 'vscode';
import { GoTestRunRequest, shouldRunBenchmarks } from './GoTestRunner';

/**
 * Resolves test items for test runs.
 */
export class RunResolver {
	readonly #resolver: TestItemResolver<GoTestItem>;

	constructor(resolver: TestItemResolver<GoTestItem>) {
		this.#resolver = resolver;
	}

	async resolveRunRequest({ workspace }: Context, request: TestRunRequest): Promise<GoTestRunRequest> {
		const include = (request.include || [...this.#resolver.roots]).map((x) => this.#resolveGoItem(x));
		const exclude = request.exclude?.map((x) => this.#resolveGoItem(x)) || [];

		// Get roots that aren't excluded
		const roots = new Set(include.filter((x) => x instanceof RootItem));
		exclude.forEach((x) => roots.delete(x as any));

		// Get packages that aren't excluded
		const packages = new Set(include.filter((x) => x instanceof Package));
		await Promise.all(
			[...roots].map(async (x) => {
				for (const pkg of (await x.allPackages()) || []) {
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
			const pkg = item.file.package;
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
			const pkg = item.file.package;
			packages.add(pkg);

			if (!testsForPackage.has(pkg)) {
				testsForPackage.set(pkg, []);
			}
			testsForPackage.get(pkg)!.push(item);
		}

		// Tests that should be excluded for each package
		const excludeForPackage = new Map<Package, TestCase[]>();
		for (const item of testCases(exclude)) {
			const pkg = item.file.package;
			if (!packages.has(pkg)) continue;

			if (!excludeForPackage.has(pkg)) {
				excludeForPackage.set(pkg, []);
			}
			excludeForPackage.get(pkg)!.push(item);
		}

		return {
			...request,
			original: request,
			packages,
			include: testsForPackage,
			exclude: excludeForPackage
		};
	}

	getPackageItem(pkg: Package) {
		return this.#resolver.getOrCreateAll(pkg);
	}

	async resolveTestItems<T extends GoTestItem>(goItems: T[]) {
		return new Map(
			await Promise.all(
				goItems.map(async (x): Promise<[T, TestItem]> => [x, await this.#resolver.getOrCreateAll(x)])
			)
		);
	}

	async testItemsByName(pkg: Package) {
		const itemByName = new Map<string, TestItem>();
		await Promise.all(
			pkg.allTests().map(async (test) => {
				const item = await this.#resolver.get(test);
				if (item) itemByName.set(test.name, item);
			})
		);
		return itemByName;
	}

	#resolveGoItem(item: TestItem) {
		const pi = this.#resolver.getProviderItem(item.id);
		if (!pi) throw new Error(`Cannot find test item ${item.id}`);
		return pi;
	}
}

function* testCases(items: GoTestItem[]) {
	for (const item of items) {
		if (item instanceof TestCase) {
			yield item;
		}
		if (item instanceof TestFile) {
			yield* item.allTests();
		}
	}
}
