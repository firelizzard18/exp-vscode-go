# Changelog

## v0.0.3

### New Features

- Custom file viewer for pprof profiles written from the ground up for VSCode.
- Code coverage via VSCode's test explorer.
- Debug tests with [rr](https://rr-project.org/) (only supported on Linux).
- Render documentation (similar to pkg.go.dev).

### Changes

- Detect whether `gopls` supports test discovery.
- Remove dynamically discovered test cases when the associated test run is discarded.
- Use enumerations for settings.
- Add 'run package tests' and 'run file tests' code lenses when enabled.

### Bugs

- Running a test could create duplicate entries (golang/vscode-go#3598).
- Fix test status updates for benchmarks.