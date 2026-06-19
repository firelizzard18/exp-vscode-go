import { MapWithDefault } from '@/utils/map';
import { TestRun, TestRunRequest, Uri } from 'vscode';
import { GoTestItem, ModelController, Package, TestCase } from './model';
import { ProfileType } from './profiles';
import { PackageTestRun } from './run/pkgTestRun';
import { ContinuousRunTracker, ViewController } from './view/controller';
import { ModelViewPresenter } from './view/presenter';

export class ResolvedTestRunRequest {
	readonly #model;
	readonly #presenter;
	readonly #resolver;
	readonly request;
	readonly #packages;
	readonly #include;
	readonly #exclude;
	readonly #pkgInclude;
	readonly #pkgExclude;

	constructor(
		model: ModelController,
		presenter: ModelViewPresenter,
		resolver: ViewController,
		request: TestRunRequest,
		packages: Set<Package>,
		include: Set<GoTestItem>,
		exclude: Set<GoTestItem>,
	) {
		this.#model = model;
		this.#presenter = presenter;
		this.#resolver = resolver;
		this.request = request;
		this.#packages = packages;
		this.#include = include;
		this.#exclude = exclude;
		this.#pkgInclude = mapTestsByPackage(include);
		this.#pkgExclude = mapTestsByPackage(exclude);
	}

	get size() {
		return this.#packages.size;
	}

	*packages(run: TestRun) {
		// When the run is disposed, remove all dynamic test cases
		// associated with it.
		run.onDidDispose?.(() => {
			for (const pkg of this.#packages) {
				this.#model.removeDynamicTests(pkg, (test) => test.run === run);
			}
		});

		// Enqueue all of the packages.
		for (const pkg of this.#packages) {
			run.enqueued(this.#resolver.resolveViewItem(pkg));
		}

		const map = <T extends GoTestItem>(items: T[]) =>
			new Map(items.map((x) => [x, this.#resolver.resolveViewItem(x)]));
		for (const pkg of this.#packages) {
			const mode = this.#include.has(pkg) ? 'all' : 'specific';
			const include = mode === 'all' ? map([...pkg.allTests()]) : map(this.#pkgInclude.get(pkg) ?? []);
			const exclude = map(this.#pkgExclude.get(pkg) ?? []);

			// This is called immediately before executing a test run. So, we'll
			// clear the dynamic test cases now.
			if (mode === 'all') {
				// We're running all tests, so remove all dynamic tests.
				this.#model.removeDynamicTests(pkg, () => true);
			} else {
				// We're running specific tests, so remove dynamic tests if
				// their parent is being run.
				this.#model.removeDynamicTests(pkg, (test) => {
					const parent = this.#presenter.getParent(test);
					if (parent) {
						if (exclude.has(parent as any)) return false;
						if (include.has(parent as any)) return true;
					}
					return false;
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

	attachProfile(run: PackageTestRun, dir: Uri, type: ProfileType, time: Date) {
		// Where should we attach the profiles? If there is a single
		// item included, attach to it, otherwise attach to the package.
		let scope: GoTestItem = run.tests.size === 1 ? [...run.tests][0][0] : run.goItem;
		const profile = this.#presenter.addProfile(scope, dir, type, time);

		// The presenter may decide to attach the profile to something other
		// than the scope we passed it, so we need to update the scope. For
		// example, if the target item is a dynamic test case, the presenter
		// will walk up the chain until it reaches a static test case, since
		// dynamic test cases get deleted each time the parent test is run.
		scope = profile.item;

		// Update the view model. Because the presentation items for profiles
		// don't actually exist in the data model, to make them appear we need
		// to recursively update the scope and it's children.
		//
		// TODO: When scope is a package, this unnecessarily re-queries gopls
		// via model.populate. ProfileTracker should emit events so components
		// can subscribe and sync the view themselves, removing this push-style
		// call.
		this.#resolver.updateViewModel(scope, { recurse: true });

		// Remove when the run is disposed.
		run.run.onDidDispose?.(async () => {
			this.#presenter.removeProfile(profile);
			this.#resolver.updateViewModel(scope, { recurse: true });
		});
		return profile;
	}

	/**
	 * Returns an object that tracks updates to test items and can construct
	 * a new {@link ResolvedTestRunRequest} with the intersection of the
	 * receiver's included tests and the updated tests.
	 */
	forContinuous(onExecute: (rq: ResolvedTestRunRequest) => void): ContinuousRunTracker {
		const rq = this;
		let packages = new Set<Package>();
		let include = new Set<TestCase>();
		return {
			didUpdate(tests) {
				let didAdd = false;
				for (const test of tests) {
					if (belongsTo(test, rq.#exclude)) {
						continue;
					}
					if (belongsTo(test, rq.#include)) {
						include.add(test);
						packages.add(test.file.package);
						didAdd = true;
					}
				}
				return didAdd;
			},

			run() {
				if (include.size == 0) {
					return;
				}
				const rq2 = new ResolvedTestRunRequest(
					rq.#model,
					rq.#presenter,
					rq.#resolver,
					rq.request,
					packages,
					include,
					rq.#exclude,
				);
				packages = new Set();
				include = new Set();
				onExecute(rq2);
			},
		};
	}
}

function belongsTo(item: TestCase, set: Set<GoTestItem>) {
	return set.has(item) || set.has(item.file) || set.has(item.file.package) || set.has(item.file.package.parent);
}

function mapTestsByPackage(items: Iterable<GoTestItem>) {
	const map = new MapWithDefault<Package, TestCase[]>(() => []);
	for (const item of items) {
		if (item.kind === 'file') {
			map.get(item.package).push(...item.tests);
		}
		if (item instanceof TestCase) {
			map.get(item.file.package).push(item);
		}
	}
	return map;
}
