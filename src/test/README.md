# Test Explorer

> **Note:** This document describes the *target* architecture. The code is being migrated toward it incrementally.

The test explorer surfaces Go tests in VSCode's Test Explorer view. It is built around an explicit separation between the **data model** (the Go test hierarchy as it actually exists) and the **presentation layer** (how that hierarchy is shown in VSCode). This separation is intentional: earlier implementations used VSCode's `TestItem` tree as the data model, which conflated data and presentation concerns and made updates significantly more complex.

## Components

### Entry point

**`register.ts`** wires up the VSCode extension lifecycle: it subscribes to workspace events (file changes, saves, editor opens, configuration changes) and forwards them to `TestManager`. It is also responsible for determining whether the test explorer is enabled.

### Orchestration

**`manager.ts`** (`TestManager`) is the top-level coordinator. It owns the lifecycle of all other components, sets up run profiles, and routes VSCode events to the appropriate components.

**`workspaceConfig.ts`** (`WorkspaceConfig`) is a lazy, cached wrapper around VSCode's configuration API. It is shared across components to provide a consistent view of settings.

### Data model (`src/data/model/`)

The data model lives in its own package and has no dependency on VSCode's test UI types. It only uses VSCode types that represent LSP/editor concepts (`Uri`, workspace folders, document ranges).

**`item.ts`** defines the Go test hierarchy: `Workspace → Module → Package → TestFile → TestCase`. These classes are the source of truth for what tests exist and where. `TestCase` has two subclasses: `StaticTestCase` (discovered from source via gopls) and `DynamicTestCase` (discovered at runtime from `go test` output).

**`itemSet.ts`** (`ItemSet`) is a generic keyed collection used throughout the data model. It supports add/remove/update operations and produces `ItemEvent` records describing what changed.

### Data model manager

**`DataModel`** owns and maintains the data model tree. It is the only component that queries gopls (for modules, packages, and tests) and the only component that directly mutates the model. It exposes a protocol of requests (populate tests for a scope, update a file) and emits `ItemEvent`s when the model changes. It has no knowledge of VSCode `TestItem`s, run profiles, or presentation structure.

### Presentation layer

**`ItemPresenter`** translates the data model into a presentable tree. It decides how items are labelled, what parent-child relationships look like (e.g. whether packages are nested, whether files are shown, whether subtests are nested), and which items are visible. It also manages captured profiles as presentation-level tree nodes: profiles are not part of the data model, but they appear in the test tree under the test or package they were captured for. `ItemPresenter` does not interact with the `TestItem` API directly; it only answers structural questions.

### View controller

**`ViewController`** is the bridge between the data model and VSCode's test UI. It subscribes to `DataModel` events and uses `ItemPresenter` to maintain the `TestItem` tree. It also translates inbound VSCode `TestRunRequest`s (which speak in `TestItem`s) back into data model terms, producing a `ResolvedTestRunRequest` for the runner. Its two responsibilities — view sync and run request resolution — are coupled because both require mapping between `TestItem` IDs and model items.

### Test execution

**`runEvent.ts`** (`RunEvent`) defines a discriminated union of run lifecycle events fired by `RunController` and `ResolvedTestRunRequest`: `start` (a package is about to run, carrying the include/exclude sets so stale dynamic tests can be cleared), `subtest` (a new dynamic subtest was discovered in `go test` output), `captured` (a profile was captured for a scope), and `disposed` (a run's results were discarded by the user). `ModelController`, `ModelViewPresenter`, and `ViewController` subscribe to these events to react to run lifecycle changes in their respective domains.

**`testRunner.ts`** (`TestRunner`) executes a resolved run. It iterates packages, builds `go test` flags (run/skip filters, benchmark flags, etc.), and spawns the process.

**`pkgTestRun.ts`** (`PackageTestRun`) processes `go test -json` output for a single package. It parses events, maps them to `TestItem`s, emits pass/fail/skip/error results to the VSCode test run, and parses failure messages (panics, want/got diffs, etc.).

**`testEvent.ts`** defines the types for `go test -json` output and utilities for normalizing them.

## Migration principles

The migration is ongoing and incremental. A few constraints that apply to every commit:

- **Never temporarily worse.** Each commit should leave the code more readable than it found it. Don't make things worse in order to make a later change easier.
- **Event-driven, not push-driven.** Components should subscribe to events from their dependencies. Avoid patterns where one component calls into another's internals to notify it of a change.
- **Explicit dependencies.** Boundaries between components are enforced by injected dependencies and public APIs, not by accessing private internals through a reference.
- **Minimize async in the critical path.** Large test suites make async/await overhead measurable. Keep the hot path (model updates, view sync) synchronous where possible.

## Async performance in Node

In Go, async I/O and synchronous code look the same at the call site. A function that internally uses goroutines and channels to coordinate concurrent work is still just a function call to its caller. The Go runtime handles scheduling transparently; the programmer opts into concurrency explicitly and the rest of the code stays synchronous.

In Node, async I/O is **viral**. A function that does any async work must be marked `async`, which forces every caller that wants to wait for the result to also be `async`, which forces their callers, and so on up the stack. The `async` keyword is not just an annotation — it changes how the function executes: every `async` function call allocates a `Promise` object, and every `await` suspends the function and enqueues its continuation on the microtask queue. This happens even when the awaited value is already resolved — there is no fast path at the language level that collapses an `await` into a direct function call.

A few `async` calls are fine. The problem arises when `async` contaminates the critical path — the code that runs once per test item. If processing each item spawns even a small number of microtasks, and there are 10,000 items, that's tens of thousands of heap allocations and microtask queue entries. Each `await` also yields to the event loop, which in Node is shared across all extensions; CPU time spent processing microtasks is CPU time stolen from every other extension in the host.

The predecessor to this codebase hit this limit hard. Processing the gopls response for a repository with ~12,000 tests ([`google/go-github`](https://github.com/google/go-github)) pegged the extension host CPU at 100% indefinitely, blocking all other extensions entirely. The root cause was `async` entwined throughout the entire processing pipeline — multiple microtask suspensions per test item, multiplied across the full test suite. Removing `async` from one iterator in the hot path produced a three-orders-of-magnitude improvement in that loop alone, which made it clear that the entire resolver needed to be rewritten from the ground up to push `async` out of the critical path. See [golang/vscode-go#3785](https://github.com/golang/vscode-go/issues/3785) for more history.

The rule here: **the critical path must be synchronous.** `async`/`await` is appropriate at the boundary — querying gopls, populating the data model — where a small number of microtasks are spawned and awaited once. The processing that follows, including all view model sync, must run to completion without yielding. Any `await` appearing in `#syncViewItem`, `#syncChildren`, or their callees should be treated as a bug.

## TODO

- **TestManager (`manager.ts`)**: Analyze and clean up. It's doing too much but the scope of the problem hasn't been fully assessed.
- **`src/test/run/`**: Analyze and clean up. The current state is functional but hasn't been reviewed for design issues.

## Known issues

The issues below are understood well enough to have a direction, even if the work isn't done yet.

### Discovery visibility (`markRequested`)

`ViewController.updateFile` calls `presenter.markRequested` as a side effect after delegating to `ModelController.updateFile`. The visibility state (whether a workspace/package has been "requested" by the user opening a file) lives in `ModelViewPresenter`, but the trigger that sets it lives in `ViewController`. These are two different concerns that happen to be co-located.

The correct shape is unclear. One option is for `ModelController` to emit a distinct event type for file updates (vs. population), and for `ModelViewPresenter` to observe that and mark items as requested itself. The current code is tolerable but the direction isn't settled.

### Run/view coupling

The run layer (`src/test/run/`, `resolvedRunRequest.ts`) imports from the view layer (`src/test/view/`). Two of these imports are misplaced and should move; the rest are irreducible.

**`shouldRunBenchmarks` is exported from `view/controller.ts`** but is a test execution decision (do we pass `-bench` to `go test`?). It has nothing to do with the view. Should move to `run/`.

**`ContinuousRunTracker` is exported from `view/controller.ts`** but is only there because `resolveRunRequest` used to build it directly. Now that `ResolvedTestRunRequest` is its own class, this type should move to `resolvedRunRequest.ts`.

**The remaining `ViewController` references in `RunController` and `ResolvedTestRunRequest` are irreducible.** VSCode's result-reporting API takes `TestItem` instances, so the run layer must be able to convert model items to `TestItem`s on demand. That conversion lives in the view layer and there is no seam to cut it out. Injecting a `(go: GoTestItem) => TestItem` callback instead of holding `ViewController` directly is the same coupling with a thinner type — not a meaningful improvement.

### `TestManager` fan-out into `ContinuousRunTracker`

`TestManager.#didUpdate` receives model events and calls `tracker.didUpdate(...)` on every active `ContinuousRunTracker`. This makes `TestManager` a middleman in a data path it has no real stake in. Each tracker could subscribe to `model.onDidUpdate` directly inside `forContinuous`, disposing the subscription when the run is canceled. `TestManager` would then only need to call `tracker.run()` on save — which is a legitimate coordination concern (save event → trigger execution) rather than a model fan-out.

### `resolveRunRequest` is a god method

It lazy-loads the model if needed, translates VSCode `TestItem`s back to Go items, resolves workspace/module includes into package sets, and deduplicates the include/exclude list. These are distinct concerns. The lazy-loading especially doesn't belong here — by the time a run is requested, the model should already be populated. The method should be split, but the right split depends on what `ViewController`'s responsibility boundary ends up being after the other refactors settle.

### `ViewController` structural issues

**`updateViewModel` has a dual input type.** It accepts `TestItem | GoTestItem` and has to figure out which it got. The `TestItem` path exists only for VSCode's `resolveHandler`; the `GoTestItem` path is used internally. These should be separate entry points.

**`#buildViewItem` uses a `function create(this: ViewController, ...)` inner function** called with `.call(this, ...)` because it needs private field access. Should just be a private method.

## Data flow

### Discovery

```
VSCode event (file open/save/change)
  → TestManager
  → DataModel (update file / populate scope)
    → gopls query
    → data model mutated → ItemEvents emitted
  → ViewController receives ItemEvents
    → ItemPresenter consulted for structure
    → TestItem tree updated
  → TestManager (invalidate stale results, notify continuous runs)
```

### Test run

```
VSCode TestRunRequest (or programmatic model items[])
  → TestManager
  → ViewController.resolveRunRequest → ResolvedTestRunRequest
  → TestRunner.run
    → for each Package: PackageTestRun
      → go test -json / dlv
      → PackageTestRun.onStdout/onStderr
        → RunController: look up test by name
            → RunEvent 'subtest' → ModelController: create DynamicTestCase → ItemEvent
            → ViewController: sync TestItem
          → ViewController.resolveViewItem → TestItem
        → run.started / passed / failed / skipped / errored
```
