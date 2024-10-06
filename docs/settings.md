# Settings

### `goExp.testExplorer.enable`

Setting this to `false` disables Go Companion's test explorer. Defaults to `true`.

### `goExp.testExplorer.exclude`

Uses the same format as and 'inherits' from `files.exclude`. Excluded paths will
be omitted from the test explorer. If the same path/glob is specified in both,
`goExp.testExplorer.exclude` takes precedence over `files.exclude`.

### `goExp.testExplorer.discovery`

Setting this to `off` disables discovery. Defaults to `on`. If discovery is
disabled, no tests are shown until a file is open, and only tests within the
same package will be shown. Tests within that package will continue to be shown
(even if all files are closed) until the editor/extension is restarted.

### `goExp.testExplorer.codeLens`

- `off` (default) disables code lenses for tests.
- `run` enables "run test" code lenses.
- `debug` enables "debug test" code lenses.
- `on` enables both.

### `goExp.testExplorer.runPackageBenchmarks`

By default (with this set to `false`), benchmarks are excluded from test runs
unless benchmarks are explicitly selected or the run contains nothing but
benchmarks. Setting this to `true` disables that behavior - benchmarks are
treated the same as any other test.

## Test organization

The following options control how tests are displayed in the test item tree.

- `goExp.testExplorer.showFiles`
  - When false (default), tests are nested within packages:
    - foo (package)
      - TestFoo
  - When true, test are nested within files:
    - foo (package)
      - test_foo.go
        - TestFoo

- `goExp.testExplorer.nestPackages`
  - When false (default), packages are siblings:
    - example.com (module)
      - foo (package)
      - foo/bar (package)
  - When true, packages are nested:
    - example.com (module)
      - foo (package)
        - bar (package)
  - Directories that are not packages are ignored regardless of this setting. If
    `foo` is not a package, foo/bar will not be nested:
    - example.com (module)
      - foo/bar (package)

- `goExp.testExplorer.nestSubtests`
  - When true (default), subtests are nested:
    - TestFoo
      - Bar
      - Baz
  - When false, all tests are siblings
    - TestFoo
    - TestFoo/Bar
    - TestFoo/Bar/Baz

- `goExp.testExplorer.dynamicSubtestLimit`
  - Limits the number of (dynamic) subtests that are included. Set to 0 to
    disable this limit. Otherwise, if the number of subtests of a test reaches
    this limit, additional subtests will be ignored. This is for performance
    reasons.