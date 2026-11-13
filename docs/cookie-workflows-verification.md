# Cookie editor workflows — v0.2.1

Verified on Windows on 13 November 2026.

- `npm test`: 20 tests passed. Header String export preserves encoded/empty values and repeated names; longer paths sort first.
- `npx playwright test --workers=2`: 28 tests passed. Native transport is replaced with a synthetic cookie store for these UI tests. Coverage includes inline editing, hidden attribute/expiry preservation, ordinary polling and expiry during editing, site changes, preference persistence without cookie values, minimum-window toolbar/import visibility, all three immediate clipboard formats, denied clipboard fallback, pasted/file imports, chosen restore modes, and downloaded exports. Clipboard tests use Chromium's actual clipboard API except the explicit rejection fixture.
- `npm run build`: TypeScript and Vite production build passed.
- `cargo test --manifest-path src-tauri/Cargo.toml --locked --lib`: 14 passed, including native scope, security, restore policy and DPAPI checks.
- `npm run test:native-cookies`: actual WebView2 smoke passed, including cookie attributes, shared profiles, selective deletion, clearing, encryption, background missing/exact policies, pause, and encrypted vault reload. It uses a unique temporary test profile. WebView2 emitted its known teardown diagnostic `Chrome_WidgetWin_0` error 1412 after success; exit code was 0.
- `node scripts/check-release-version.mjs v0.2.1`: package versions agree.
- `npm run bundle -- --target x86_64-pc-windows-msvc`: optimized executable and NSIS installer built successfully, exit 0.

Independent review found draft loss if a cookie expired during inline editing and insufficient disclosure of Header String attribute loss. Both were addressed. A regression test reproduced draft loss before the fix and passed afterward. Another test reproduced expiry precision loss before the fix and now verifies the unchanged timestamp survives a simple value edit.

Screenshots in `docs/screenshots/` use synthetic cookies: `cookie-editor.png`, `cookie-import.png`, `cookie-export.png`, and `cookie-editor-minimum-window.png`. Reviewed the import/export layouts and full browser at 880x620. Primary import is a single textarea and button; file selection and policy controls are optional. The action bar remains outside the scrolling list.

Local delivery: copied the packaged executable and installer into `releases/`, replaced the old executable at `D:\Mxplorer-build\smoke\Mxplorer.exe`, verified identical SHA-256, and reopened it. The running process reported v0.2.1 and Responding=True. The old v0.2.0 executable was retained separately. Existing profile directories were not changed by deployment.

Executable SHA-256: `d2edeaf1927bf338f16b509fdd26536736f4e71254ac8906ed3e7c58c48564a7`.

Installer SHA-256: `067621127e3148456d91f0d7c7c922c1cc9cf9e56ef8a4902c9c329fe52d4b8d`.

Limits: installed-app clipboard/file chooser interaction and installer execution were not manually tested. The native smoke exercises WebView2 storage independently of the React transport tests. No native restore-engine behavior changed in this version. Server-revoked sessions remain unrecoverable from cookie values alone.
