# Changelog

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