# Cookie editor verification — 13 November 2026

Mxplorer 0.2.0 adds the sidebar cookie editor and encrypted restoration templates. The UI supports current-site cookie CRUD, JSON/Netscape/header import, JSON/Netscape file and clipboard export, masked values, both requested restoration modes, pause/enable, forgetting saved entries, and explicit live-cookie clearing. Cookie values are kept out of UI localStorage and logs.

Verified in this workspace:

- `npm test`: 19 tests pass, including eight cookie-format and validation tests.
- `npm run test:e2e`: 17 tests pass, including seven cookie-sidebar tests using a mocked native command seam and synthetic values. Tests cover attributes, reveal/hide, exact/missing policy selection, pause/enable, save/import/delete, domain rejection, persistent sidebar scope, actual file input and downloaded export content.
- `npm run build`: TypeScript and production Vite build pass.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: 14 tests pass, including seven native cookie rule/encryption tests.
- `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`: passes.
- `npm run test:native-cookies`: passes against actual Microsoft WebView2 in a hidden window, a fresh temporary website profile, and a unique application identifier. No existing Mxplorer window or profile is used.
- `npm run bundle -- --target x86_64-pc-windows-msvc`: Windows executable and NSIS installer build successfully. Outputs copied to `releases/Mxplorer.exe` and `releases/Mxplorer_0.2.0_x64-setup.exe`.

The native smoke test covers real cookie attributes (host-only/domain/path, HttpOnly, Secure, SameSite, session and expiration), profile sharing, selective deletion, and actual `ClearBrowsingDataAll`. It also runs the production two-second reconciler without any sidebar, checking automatic missing-cookie restoration, preserving refreshed values in missing mode, exact-value enforcement, pause behavior, loading the encrypted vault into a fresh in-memory Store, restoration after production clear-data handling, and clearing live data despite a damaged vault. A fresh Store load simulates the startup storage path; this is not a separate full-process restart test.

On this Windows host WebView2 prints a teardown diagnostic about `Chrome_WidgetWin_0` (error 1412) after all smoke assertions pass. The harness exits with code 0. Its original manifest-less unit-test harness could not initialize GUI dependencies; the working smoke check is a feature-gated binary with the normal application manifest. Ordinary unit tests stay independent of GUI initialization.

Two independent review findings were addressed: vault errors no longer block normal navigation, and corrupt-vault loading no longer blocks clearing live browser data. The damaged vault is preserved and its error is visible. Saved-cookie deletion/policy changes and background maintenance share one async lock. Whole import batches are validated before native mutation. Windows DPAPI protects saved templates outside GuestProfile, so profile clearing cannot erase them.

Limits: the sidebar browser tests mock native transport, while the separate smoke test exercises native storage and background behavior. There was no additional manual desktop interaction. Installed-app file chooser/clipboard behavior and full installer execution were not manually checked. Cookie export download behavior is covered in the browser UI test. A server-revoked session cannot be recovered by restoring cookies. WebView2 reports unspecified SameSite as Lax, and partition keys are not editable.

`docs/screenshots/cookie-editor.png` uses synthetic test cookies. It was subsequently updated for the inline editor in v0.2.1; see [workflow verification](cookie-workflows-verification.md).
