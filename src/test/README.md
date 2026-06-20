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

**`ItemPresenter`** translates the data model into a presentable tree. It decides how items are labelled, what parent-child relationships look like (e.g. whether packages are nested, whether files are shown, whether subtests are nested), and which items are visible. It integrates captured profiles from `ProfileTracker` as presentation-level tree nodes — profiles are not part of the data model itself. `ItemPresenter` does not interact with the `TestItem` API directly; it only answers structural questions.

**`ProfileTracker`** records profiles captured during test runs and emits events when they are added or removed. It is kept separate from the data model because profiles are a presentation concern (they appear in the test tree) rather than a model concern (they say nothing about what tests exist).

### View controller

**`ViewController`** is the bridge between the data model and VSCode's test UI. It subscribes to `DataModel` events and uses `ItemPresenter` to maintain the `TestItem` tree. It also translates inbound VSCode `TestRunRequest`s (which speak in `TestItem`s) back into data model terms, producing a `ResolvedTestRunRequest` for the runner. Its two responsibilities — view sync and run request resolution — are coupled because both require mapping between `TestItem` IDs and model items.

### Test execution

**`ResolvedTestRunRequest`** represents a fully resolved test run: the set of packages and tests to execute. It is a standalone class (not nested inside the view controller) with explicit dependencies, so it can be constructed and tested independently. During a run, it is also responsible for creating `DynamicTestCase`s in the data model and obtaining the corresponding `TestItem`s when subtests are discovered in output — via injected callbacks to `DataModel` and `ViewController` respectively.

**`testRunner.ts`** (`TestRunner`) executes a resolved run. It iterates packages, builds `go test` flags (run/skip filters, benchmark flags, etc.), and spawns the process.

**`pkgTestRun.ts`** (`PackageTestRun`) processes `go test -json` output for a single package. It parses events, maps them to `TestItem`s, emits pass/fail/skip/error results to the VSCode test run, and parses failure messages (panics, want/got diffs, etc.).

**`testEvent.ts`** defines the types for `go test -json` output and utilities for normalizing them.

## Migration principles

The migration is ongoing and incremental. A few constraints that apply to every commit:

- **Never temporarily worse.** Each commit should leave the code more readable than it found it. Don't make things worse in order to make a later change easier.
- **Event-driven, not push-driven.** Components should subscribe to events from their dependencies. Avoid patterns where one component calls into another's internals to notify it of a change.
- **Explicit dependencies.** Boundaries between components are enforced by injected dependencies and public APIs, not by accessing private internals through a reference.
- **Minimize async in the critical path.** Large test suites make async/await overhead measurable. Keep the hot path (model updates, view sync) synchronous where possible.

## TODO

- **TestManager (`manager.ts`)**: Analyze and clean up. It's doing too much but the scope of the problem hasn't been fully assessed.
- **`src/test/run/`**: Analyze and clean up. The current state is functional but hasn't been reviewed for design issues.

## Known issues

The issues below are understood well enough to have a direction, even if the work isn't done yet.

### Profile view sync

`ResolvedTestRunRequest.attachProfile` currently pushes profile state directly into `ModelViewPresenter` and then manually calls `ViewController.updateViewModel` to sync the view. This violates the event-driven principle: `ResolvedTestRunRequest` has no business knowing that attaching a profile requires a view sync, and `ViewController` has no business being called imperatively from outside to react to something that's really a `ProfileTracker` event.

The correct fix is to make `ProfileTracker` emit events when profiles are added or removed. `ViewController` subscribes to those events and updates the view model itself — the same way it handles `ModelController` events. `ResolvedTestRunRequest` then only needs to call `ProfileTracker.add/remove`; it doesn't touch the view at all.

### Discovery visibility (`markRequested`)

`ViewController.updateFile` calls `presenter.markRequested` as a side effect after delegating to `ModelController.updateFile`. The visibility state (whether a workspace/package has been "requested" by the user opening a file) lives in `ModelViewPresenter`, but the trigger that sets it lives in `ViewController`. These are two different concerns that happen to be co-located.

The correct shape is unclear. One option is for `ModelController` to emit a distinct event type for file updates (vs. population), and for `ModelViewPresenter` to observe that and mark items as requested itself. The current code is tolerable but should be revisited when the profile sync issue is addressed, since both follow the same push-vs-event pattern.

### Run/view coupling

The run layer (`src/test/run/`, `resolvedRunRequest.ts`) currently imports from the view layer (`src/test/view/`). The dependency should flow the other way: view knows about run, run doesn't know about view.

Specific coupling points, in order of priority:

**`shouldRunBenchmarks` is exported from `view/controller.ts`** but is a test execution decision (do we pass `-bench` to `go test`?). It has nothing to do with the view. Should move to `run/`.

**`ContinuousRunTracker` is exported from `view/controller.ts`** but is only there because `resolveRunRequest` used to build it directly. Now that `ResolvedTestRunRequest` is its own class, this type should move to `resolvedRunRequest.ts`.

**`ResolvedTestRunRequest` and `RunController` both hold `ViewController`** solely to call `resolveViewItem(go)` — converting a model item to a `TestItem` on demand. After the `ProfileTracker` event work removes `ModelViewPresenter` from `ResolvedTestRunRequest`, the only remaining view dependency in both classes is this one function. The fix is to inject `resolveViewItem` as a callback `(go: GoTestItem) => TestItem` rather than holding `ViewController`. At that point `src/test/run` and `resolvedRunRequest.ts` have zero imports from `src/test/view`.

### `ResolvedTestRunRequest.packages()` uses `presenter.getParent`

Before yielding each `PackageTestRun`, `packages()` clears dynamic test cases whose parent is being re-run. To decide which tests qualify, it calls `this.#presenter.getParent(test)` and checks whether that parent is in the include/exclude sets. This pulls a presentation concern (how tests are logically parented, which is influenced by nesting config) into a run-layer decision.

The data model already tracks subtest-parent relationships: `Package.findParent(name)` is used by `ModelViewPresenter.#didUpdate` for exactly this purpose. The predicate in `removeDynamicTests` should use model structure instead of asking the presenter.

### `TestManager` fan-out into `ContinuousRunTracker`

`TestManager.#didUpdate` receives model events and calls `tracker.didUpdate(...)` on every active `ContinuousRunTracker`. This makes `TestManager` a middleman in a data path it has no real stake in. Each tracker could subscribe to `model.onDidUpdate` directly inside `forContinuous`, disposing the subscription when the run is canceled. `TestManager` would then only need to call `tracker.run()` on save — which is a legitimate coordination concern (save event → trigger execution) rather than a model fan-out.

### `resolveRunRequest` is a god method

It lazy-loads the model if needed, translates VSCode `TestItem`s back to Go items, resolves workspace/module includes into package sets, and deduplicates the include/exclude list. These are distinct concerns. The lazy-loading especially doesn't belong here — by the time a run is requested, the model should already be populated. The method should be split, but the right split depends on what `ViewController`'s responsibility boundary ends up being after the other refactors settle.

### `ViewController` structural issues

**`updateViewModel` has a dual input type.** It accepts `TestItem | GoTestItem` and has to figure out which it got. The `TestItem` path exists only for VSCode's `resolveHandler`; the `GoTestItem` path is used internally. These should be separate entry points.

**`#buildViewItem` uses a `function create(this: ViewController, ...)` inner function** called with `.call(this, ...)` because it needs private field access. Should just be a private method.

**`#getPresentable` handles both Go item lookup and profile synthesis** in the same method. These are very different code paths that should be separated — the profile case in particular should shrink significantly once `ProfileTracker` emits events.

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
        → ResolvedTestRunRequest: find or create test
            → DataModel: create DynamicTestCase → ItemEvent
            → ViewController: sync TestItem → return TestItem
        → run.started / passed / failed / skipped / errored
```
