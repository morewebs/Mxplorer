# Mxplorer

A Windows browser built with Tauri 2, React, and Microsoft Edge WebView2. Modern monochrome chrome, real native website tabs, and a focused set of everyday browser features.

## Run

Open `releases/Mxplorer.exe` for the standalone app, or install `releases/Mxplorer_0.1.1_x64-setup.exe`. The installer checks for Evergreen WebView2 and downloads its bootstrapper if necessary. Builds are unsigned.

For development, install Node.js 22+, stable Rust MSVC, Visual Studio C++ Build Tools, and WebView2, then:

```powershell
npm ci
npm run desktop
```

`npm run dev` serves an interface preview at `http://127.0.0.1:1420`. Native website browsing is available in the desktop app. Preview mode identifies itself in the corner.

## Features

- Multiple native tabs, tab search dropdown, reopen closed tabs, keyboard and middle-click tab controls.
- Address/search bar, native back/forward history, same-page URL updates, reload, stop, and Home.
- Clean new-tab page with editable website shortcuts and recent visits.
- Bookmarks and optional bookmarks bar; searchable history and download lists.
- Downloads saved to `Downloads/Mxplorer`, with safe filenames and collision handling.
- DuckDuckGo, Google, or Bing search; session restore; local preferences.
- Zoom, native find, print, fullscreen, and window controls.
- Clearing history, download records, cookies and cached site data; downloaded files and bookmarks are kept.

The top arrow opens a searchable dropdown of tabs. Bookmarks and downloads toolbar buttons open library panels. The menu is a compact dropdown. Website snapshots stay in memory while chrome dropdowns are open so native WebView2 content cannot cover the controls.

## Shortcuts

| Action | Shortcut |
|---|---|
| New / close tab | Ctrl+T / Ctrl+W |
| Reopen closed tab | Ctrl+Shift+T |
| Search open tabs | Ctrl+Shift+A |
| Address/search | Ctrl+L, Ctrl+K, Alt+D |
| Next / previous tab | Ctrl+Tab / Ctrl+Shift+Tab |
| Select tab | Ctrl+1 through Ctrl+9 |
| Back / forward | Alt+Left / Alt+Right |
| Reload / hard reload | Ctrl+R / Ctrl+Shift+R |
| Toggle bookmarks bar | Ctrl+Shift+B |
| Bookmark / bookmarks | Ctrl+D / Ctrl+Shift+O |
| History / downloads | Ctrl+H / Ctrl+J |
| Find / print | Ctrl+F / Ctrl+P |
| Zoom / reset | Ctrl+plus or minus / Ctrl+0 |
| Fullscreen | F11 |

## Check and build

```powershell
npm test
npx playwright install chromium
npm run test:e2e
npm run build
cd src-tauri
cargo test --lib
cargo clippy --all-targets -- -D warnings
cd ..
npm run bundle
```

The normal build writes the executable and NSIS installer to `src-tauri/target/release/`. Set `CARGO_TARGET_DIR` to another drive when disk space is limited. Commit lockfiles make builds reproducible.

## Implementation and limits

`src/useBrowser.ts` owns tab and persisted UI state. `src/model.ts` validates stored data and resolves addresses. `src/App.tsx` implements trusted browser chrome; native views are managed by Rust in `src-tauri/src/`. Remote tabs have no native capabilities, and every custom command also validates its caller. Website profiles and the trusted interface’s local storage are separate. See [native host details](docs/native.md).

Windows is the supported target. Mxplorer uses WebView2, so website compatibility, DRM and sign-in restrictions may differ from full Edge. This release has one window and one website profile. It has no extensions, sync, password manager, private mode, ad blocking, download pause/resume, byte progress, or automatic updates. Popup links open as ordinary new tabs; scripted popup/opener workflows may not work. Session restore saves tab addresses, rather than each tab’s full navigation stack. Local storage is not encrypted.

Interface tests exercise the UI with a browser preview; Rust tests cover native input boundaries, keyboard mappings, download naming/identity, and navigation error state. Packaged website interactions require a separate native smoke check and are not established by those tests alone.
