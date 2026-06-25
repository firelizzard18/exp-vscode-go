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

## Known bugs

- **`register.ts:111`** — `config.exclude.isAffected(e)` is duplicated on two consecutive lines; one should be `config.update.isAffected(e)`. As-is, changing `testExplorer.update` has no effect until the extension reloads.

- **`view/controller.ts:#onItemEvent`** — When a config change causes view restructuring (toggling `showFiles`, `nestPackages`, or `nestSubtests`), `#onItemEvent` only calls `#syncViewItem`, which adds items at their new positions but never removes them from old ones. `#syncChildren` (the only path that deletes stale children) is only reachable from `#onRunEvent`. Toggling those settings leaves ghost nodes in the tree until the extension reloads.

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

## Test scenarios

Areas that changed significantly during refactoring and should be verified:

- **Module-free repos**: a workspace with no `go.mod` (packages in `ws.packages` directly, not under any module). Verify that resolving, running, and refreshing works. The `#getGoItem` fix for workspace-direct packages was made during this refactor.
- **Discovery off + file open**: with `testExplorer.discovery` set to `off`, opening a Go test file should make that file's package appear in the tree. Nothing else should appear.
- **Run on workspace or module**: clicking "Run" on a workspace or module item in the tree should expand to all their packages and run them, not produce an empty run.
- **Mixed include set**: a run request that includes both a workspace-level item and a specific test case should correctly expand the workspace and also include the explicit test.
- **Continuous runs**: editing a test file and saving should trigger a re-run of only the affected tests. Verify end-to-end after the `ContinuousRunTracker` refactor.
- **Config change view rebuild**: toggling `showFiles`, `nestPackages`, or `nestSubtests` should restructure the tree immediately, with no ghost nodes left over from the previous layout.

## Testing plan

### File layout

Unit tests live alongside the source file they test (`run/log.test.ts` next to `run/log.ts`, etc.). Integration tests live in `test/integration/`. The jest config currently only picks up `test/component/**/*.test.ts` and needs to be extended to include `src/test/**/*.test.ts` and `test/integration/**/*.test.ts`.

### Test harness

The old `test/utils/host.ts` and `test/utils/txtar.ts` are the right pattern and should be refactored rather than replaced. The harness is split into roughly three files:

- **`test/utils/txtar.ts`** — keep as-is. `Workspace` and `TxTar` are still useful.
- **`test/utils/host.ts`** — rewrite for the new `Context` / `EditorEvent` / `TestManager` API. Keeps the `TestHost` concept, `withWorkspace` / `withConfiguration` / `withCommands` config helpers, and the mock VS Code types (`MockTestController`, `MockTestItem`, `MapTestItemCollection`). Adds a `MockTestRun` that records `started`/`passed`/`failed`/`skipped`/`errored`/`appendOutput` calls for assertion.
- **`test/utils/model.ts`** — helpers for constructing `Workspace → Module → Package → TestFile → TestCase` trees directly (bypassing gopls), and a `FakeCommands` that returns canned `PackagesResults`/`ModulesResult`. Used by unit and integration tests that do not need real gopls.

### Unit tests

Unit tests use `FakeCommands` and direct model construction; no real gopls, no real filesystem except where noted.

#### `run/log.test.ts`

Tests feed log lines from synthesized log data. The log data will be synthesized inline for now but is designed to be replaced by real `go test -json` output files (e.g., `run/testdata/pass.log`, `run/testdata/panic.log`). Each test constructs a `TestRunLog` with a `MockTestRun` and a resolver stub, feeds lines from the log data, and asserts on what was recorded.

- Event routing: `pass`, `fail`, `skip`, `start`, `build-fail` each call the correct `MockTestRun` method with the right item
- Non-JSON lines passed to `appendOutput` without crashing
- Location tracking: location on first output line is remembered; 8-space-prefixed continuation lines inherit it and strip the prefix
- `parsePanic`: goroutine stack trace message extracted; location is first frame within workspace root; falls back to first frame if none match
- `parseWantGot`: fires for all verb pairs (`want`/`got`, `expected`/`actual`, `desired`/`received`, etc.); does NOT fire when only one side is present; does NOT fire when both sides are the same kind (two "got" verbs)
- Build failure: pre-fail output gathered per item; `errored` called with non-comment lines only; `buildFailed` flag set

#### `model/controller.test.ts`

- `workspaceFor(wsf)`: creates `Workspace` on first call, returns same object on second call
- `workspaceFor(uri)`: returns `undefined` for URI outside any workspace folder; respects exclusion globs
- `#onRunEvent('start')` / `covers()` — the logic for which dynamic tests to remove is non-obvious:
  - All dynamic tests removed when `include` is undefined (whole-package run)
  - Test NOT removed when it is the exact `include` item (not reached via an ancestor)
  - Test NOT removed when neither it nor any ancestor is in `include`
  - Test NOT removed when it or an ancestor is in `exclude`
  - Child tests of a removed test are also removed (prefix match)
- `#onRunEvent('subtest')`: creates `DynamicTestCase` under the correct parent and fires `added`; finds existing case by name and does not duplicate it
- `#onRunEvent('disposed')`: removes only the dynamic cases tracked for that run, not others
- `#consolidatePackages`: `foo` and `foo_test` packages merged into one entry; excluded paths filtered out

#### `view/presenter.test.ts`

Build a model tree directly, drive `#onDidUpdate` with synthesized `ItemEvent[]`.

- **`#pkgRel` rebuild on events**: adding `foo` and `foo/bar` creates the correct parent relation; removing `foo/bar` tears it down without affecting `foo`
- **`#testRel` rebuild on events**: adding `TestFoo/Bar` creates correct subtest relation under `TestFoo`
- **`getParent` / `getChildren`** for every config combination that changes structure:
  - `nestPackages=true/false` — nested packages appear as children vs siblings
  - `showFiles=true/false` — file nodes present vs collapsed
  - `nestSubtests=true/false` — subtests nested vs flat
- **`asPresented`**: root package resolves to its parent module/workspace; file with `showFiles=false` resolves to its package
- **`labelFor`**: nested package label strips ancestor path prefix; subtest label strips parent test name prefix
- **Profile hierarchy**: `captured` run event adds `ProfileContainer` → `ProfileSet` (grouped by time) → `ProfileItem` under the correct item; `disposed` run event removes them; multiple profiles at same time appear in one `ProfileSet`
- **`resolveProfilesParent`**: dynamic test case walks up to its static parent; profile/set/container items also walk up

#### `run/controller.test.ts` (isolated functions only)

- `makeRegex`: escapes regex metacharacters in test names; generates `^part1$/^part2$` for subtests; correctly filters benchmarks vs non-benchmarks; returns empty string (not `-`) when no items match the filter
- `shouldRunBenchmarks`: returns `true` only when every test in the package is a benchmark (or setting is on); returns `false` when package has no loaded files

### Integration tests

These wire `ModelController` + `ModelViewPresenter` + `ViewController` together with `FakeCommands`. No real gopls. Verify the full event chain from `populate()` / run events to the `TestItem` tree.

#### `test/integration/discovery.test.ts`

1. **Module with packages**: `populate(workspace)` → correct `TestItem` tree structure
2. **Module-free repo**: packages sit directly under workspace (no module). Items appear under the workspace node. `resolveGoItem` round-trip works. *(Explicitly called out in the README as changed during refactor.)*
3. **`showFiles` toggle**: flip config, trigger an update, verify file nodes appear without ghost nodes from the old layout
4. **`nestPackages` toggle**: flip config, verify nested vs flat layout; **known bug** — ghost nodes currently left over; this test documents the bug and should initially fail
5. **`nestSubtests` toggle**: same as above

#### `test/integration/run.test.ts`

6. **Subtest discovery**: fire `RunEvent.subtest` → `DynamicTestCase` created → `ViewController` gets `ItemEvent.added` → view item appears under correct parent
7. **Pre-run cleanup** (`start` event): dynamic cases under the target package cleared before run; cases for excluded tests not cleared; child tests of a cleared parent are also cleared
8. **Run disposal** (`disposed` event): dynamic cases associated with the run are removed; others are not

#### `test/integration/manager.test.ts`

9. **Workspace-level run**: `#resolveRunRequest` with a workspace item → all packages included
10. **Module-level run**: module item → module's packages included
11. **Mixed include**: workspace item + explicit test → workspace expands AND test is preserved
12. **Redundancy pruning**: package + test inside it → test dropped (package covers it); benchmark exception applies correctly when `runPackageBenchmarks` is off
13. **Discovery off + file opened**: only that file's package appears; running it loads tests before executing
14. **`update` mode `on-save`**: `file-edited` EditorEvent does NOT trigger `updateFile`; `file-saved` does, but only when version changes
15. **`update` mode `on-edit`**: `file-edited` EditorEvent triggers `updateFile` with ranges

### What is not tested

- `register.ts` — pure VS Code lifecycle wiring
- `run/continuous.ts` — narrow surface, covered indirectly by manager integration test #13
- `config.ts` / `workspaceConfig.ts` — transparent wrapper
- Individual model node classes (`Workspace`, `Module`, `Package`, `TestFile`, `TestCase`) — logic is trivial
- `model/set.ts` (`ItemSet`) — generic collection
