# Test Explorer

The test explorer surfaces Go tests in VSCode's Test Explorer view. It is built around an explicit separation between the **data model** (the Go test hierarchy as it actually exists) and the **presentation layer** (how that hierarchy is shown in VSCode). This separation is intentional: earlier implementations used VSCode's `TestItem` tree as the data model, which conflated data and presentation concerns and made updates significantly more complex.

## Components

### Entry point

**`register.ts`** wires up the VSCode extension lifecycle: it subscribes to workspace events (file changes, saves, editor opens, configuration changes) and forwards them to `TestManager`. It is also responsible for determining whether the test explorer is enabled.

### Orchestration

**`manager.ts`** (`TestManager`) is the top-level coordinator. It owns the lifecycle of all other components, sets up run profiles, routes VSCode events to the appropriate components, and resolves VSCode `TestRunRequest`s into `GoTestRequest`s for the runner.

**`workspaceConfig.ts`** (`WorkspaceConfig`) is a lazy, cached wrapper around VSCode's configuration API. It is shared across components to provide a consistent view of settings.

### Data model (`src/test/model/`)

The data model lives in its own package and has no dependency on VSCode's test UI types. It only uses VSCode types that represent LSP/editor concepts (`Uri`, workspace folders, document ranges).

**`workspace.ts`, `module.ts`, `package.ts`, `file.ts`, `case.ts`** define the Go test hierarchy: `Workspace → Module → Package → TestFile → TestCase`. These classes are the source of truth for what tests exist and where. `TestCase` has two subclasses: `StaticTestCase` (discovered from source via gopls) and `DynamicTestCase` (discovered at runtime from `go test` output).

**`set.ts`** (`ItemSet`) is a generic keyed collection used throughout the data model. It supports add/remove/update operations and produces `ItemEvent` records describing what changed.

### Data model manager

**`model/controller.ts`** (`ModelController`) owns and maintains the data model tree. It is the only component that queries gopls (for modules, packages, and tests) and the only component that directly mutates the model. It exposes a protocol of requests (populate tests for a scope, update a file) and emits `ItemEvent`s when the model changes. It has no knowledge of VSCode `TestItem`s, run profiles, or presentation structure.

### Presentation layer

**`view/presenter.ts`** (`ModelViewPresenter`) translates the data model into a presentable tree. It decides how items are labelled, what parent-child relationships look like (e.g. whether packages are nested, whether files are shown, whether subtests are nested), and which items are visible. It also manages captured profiles as presentation-level tree nodes: profiles are not part of the data model, but they appear in the test tree under the test or package they were captured for. `ModelViewPresenter` does not interact with the `TestItem` API directly; it only answers structural questions.

### View controller

**`ViewController`** is the bridge between the data model and VSCode's test UI. It subscribes to `DataModel` events and uses `ItemPresenter` to maintain the `TestItem` tree. It also provides `resolveGoItem` and `resolveViewItem` for translating between `TestItem`s and data model items. These are used by `TestManager` when resolving run requests and by `RunController` when reporting results.

### Test execution

**`run/controller.ts`** (`RunController`) executes a resolved run. It receives a `GoTestRequest` from `TestManager`, iterates packages, builds `go test` flags (run/skip filters, benchmark flags, etc.), and spawns the process. `RunEvent` is also defined here: a discriminated union of run lifecycle events fired during execution — `start` (a package is about to run, carrying the include/exclude sets so stale dynamic tests can be cleared), `subtest` (a new dynamic subtest was discovered in `go test` output), `captured` (a profile was captured for a scope), and `disposed` (a run's results were discarded by the user). `ModelController`, `ModelViewPresenter`, and `ViewController` subscribe to these events to react to run lifecycle changes in their respective domains.

**`run/continuous.ts`** (`ContinuousRunTracker`) tracks which tests have been modified since the last save and triggers a re-run when the file is saved. Each tracker subscribes directly to model events and editor events, controlling its own lifetime.

**`run/log.ts`** (`TestRunLog`) processes `go test -json` output for a single package. It parses events, maps them to `TestItem`s, emits pass/fail/skip/error results to the VSCode test run, and parses failure messages (panics, want/got diffs, etc.).

**`run/goTestEvent.ts`** defines the types for `go test -json` output and utilities for normalizing them.

## Design principles

A few constraints that apply to every commit:

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
  → TestManager (invalidate stale test results)
```

### Test run

```
VSCode TestRunRequest (or programmatic GoTestItem[])
  → TestManager.#resolveRunRequest → GoTestRequest
  → RunController.run
    → RunController.#packages → per-package GoTestRun
      → go test -json / dlv
      → TestRunLog.onStdout/onStderr
          → RunController fires RunEvent 'subtest' → ModelController creates DynamicTestCase → ItemEvent
              → ViewController syncs TestItem
            → ViewController.resolveViewItem → TestItem
          → run.started / passed / failed / skipped / errored
```
