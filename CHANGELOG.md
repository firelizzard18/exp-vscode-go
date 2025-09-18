# Changelog

## v0.0.14

- Introduces prerelease versions.

## v0.0.13

- Improves the test discovery logic when switching between files to avoid
  unnecessary work.

## v0.0.12

- Defaults to updating tests when a document is saved instead of as a document
  is edited to resolve performance issues with large projects. The previous
  behavior can be restored or completely disabled (no automatic updates) with
  the new configuration setting, `exp-vscode-go.testExplorer.update`.

## v0.0.11

- Fixes a bug that broke debugging.

## v0.0.10

- Fixes coverage for modules using vendoring –
  [#3654](https://github.com/golang/vscode-go/issues/3654).

## v0.0.9

- Fixes a bug in how `-coverpkg` was calculated for coverage test runs.
- Coverage log entries for files that are not within any workspace are skipped.

## v0.0.8

- Disable the test explorer by default when using a non-prerelease version of
  vscode-go.
- (Opt-in) Allow `go:generate go run ...` directives to be run and debugged as
  pseudo-tests. **This only works for `go run ...` commands.**

## v0.0.7

- A better workaround for [microsoft/vscode#242124][vsc-242124].

## v0.0.6

- Temporary workaround for [microsoft/vscode#242124][vsc-242124].

[vsc-242124]: https://github.com/microsoft/vscode/issues/242124

## v0.0.5

- Added a command for configuring coverage scope (package vs module). This will
  be removed in the future if microsoft/vscode#237106 is resolved.

## v0.0.4

- Reworked handling of `go.testFlags` to address [vscode-go#1636][vscgo-1636].

[vscgo-1636]: https://github.com/golang/vscode-go/issues/1636

## v0.0.3

### New Features

- Custom file viewer for pprof profiles written from the ground up for VSCode.
- Code coverage via VSCode's test explorer.
- Debug tests with [rr](https://rr-project.org/) (only supported on Linux).
- Render documentation (similar to pkg.go.dev).

### Changes

- Detect whether `gopls` supports test discovery.
- Remove dynamically discovered test cases when the associated test run is
  discarded.
- Use enumerations for settings.
- Add 'run package tests' and 'run file tests' code lenses when enabled.

### Bugs

- Running a test could create duplicate entries (golang/vscode-go#3598).
- Fix test status updates for benchmarks.