# Go Companion

An unofficial companion to the [official Go extension][vscode-go] that provides
experimental features.

[vscode-go]: https://marketplace.visualstudio.com/items?itemName=golang.go

## Test Explorer

Go Companion includes an experimental alternative to vscode-go's test explorer
that uses the Go language server (gopls) for test discovery, allowing for more
advanced test discovery such as static detection of (some) subtests.
Additionally, Go Companion provides the following features:

-   Ignore tests within specified files.
-   Disable automatic discovery of tests.
-   Control how tests are displayed.
-   Debugging a test updates its status in the test explorer.
-   Support for continuous runs.
-   Code lenses (hidden by default) that are integrated with the test explorer.

See [settings](./docs/settings.md) for more details.

## Profile Viewer

Go Companion includes a pprof profile viewer that is more cleanly integrated
with the editor than vscode-go's iframe-based viewer.

## Documentation Viewer (**TODO**)

I plan to add an in-editor documentation viewer such that you can view
documentation for your code similar to what you would see on pkg.go.dev.
