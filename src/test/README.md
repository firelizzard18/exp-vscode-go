# Test Explorer

> **Note:** This document describes the *planned* architecture. The current code does not yet reflect this structure; it will be migrated incrementally over multiple commits.

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
