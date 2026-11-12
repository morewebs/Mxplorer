# Verification — 12 November 2026

Mxplorer 0.1.1 built as a Windows x64 executable and NSIS installer, including the WebView2 bootstrapper configuration. Artifacts are copied into the ignored `releases/` folder. Generated Cargo build files were moved to `D:/Mxplorer-build/target` after C: ran out of space; source remains in this repository.

- `npm test`: 11 tests pass (address resolution, protocol restrictions, malformed storage, history, tab lifecycle, late navigation updates, keyboard conventions).
- `npm run test:e2e`: 10 tests pass (shortcuts, tabs, settings persistence, bookmarks, history, clearing data, dropdown geometry, address selection, keyboard activation, internal zoom, and home layout).
- `npm run build`: TypeScript and production Vite build pass.
- Native host: `cargo test --lib` passes all seven tests; warning-free Clippy also verified by the native implementation agent; covers URL/ID/geometry boundaries, download names and unique identities, keyboard mapping and navigation error completion.
- Windows release executable and NSIS installer builds pass.
- Two independent review passes identified and corrected late guest events undoing Home, download IDs colliding across launches, hostnames with ports becoming searches, stale tab panel selection, popup focus/cancellation issues, picker Enter events targeting the wrong tab, and phantom internal-page zoom.

The desktop executable was launched. Computer interaction was stopped with physical Escape before native inspection could complete, twice. Live website navigation, popup rendering over a real guest, native find/print, native keyboard focus, actual download completion and installer execution have **not** been verified. Browser-preview tests do not prove those behaviors. A local native fixture is available with `node tests/native-fixture.mjs`, then `http://127.0.0.1:17329` in the desktop app.

The new-tab screenshot in `docs/screenshots/new-tab.png` comes from the interface preview, not the native app. Website icon requests are aborted in UI tests for deterministic, offline-safe rendering.
