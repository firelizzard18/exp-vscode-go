# Go Profile Viewer

This module implements a flame graph viewer for Go pprof profiles, natively
integrated into vscode.

## Loading profiles

Profiles are protobuf-encoded, possibly gzipped. Instead of reimplementing the
decoding in JavaScript, we use `vscgo` to convert it to JSON. However, **this
limits the usable file size**. If we use node to execute a child process and
read JSON from that process's stdin into a buffer, this places a limit on the
size of profile that may be read. A limit that is not hard to hit. So instead,
we as `vscgo` to serve the profile (as JSON) over HTTP so we can make an HTTP
request from within the viewer, completely side stepping Node's limitations.
This does lead to increased latency, but it is more robust since it uses the
browser context's built in fetch system.

## UI state

Unless explicitly told otherwise, vscode will eject the webview and all its
state out of memory whenever it is not being shown. Such as when the user
switches to another tab. It is possible to prevent this, but vscode highly
recommends not doing so, for performance reasons. The way around this is to use
vscode's webview API to persist state data and to reconstruct the UI state from
that.

Thus, viewer state such as the selected sample, focused item, ignore list, etc
are persisted and the state of the viewer is reconstructed when the webview is
brought back to the fore. To the latency of an HTTP request every time the user
switches tabs, the profile is also persisted along with the viewer state. It
should be noted that 'persistent' is relative - data stored in this way is
**not** persisted when the editor is closed, only when it is hidden (e.g. when
the user switches to a different tab).