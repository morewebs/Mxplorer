# Mxplorer

A Windows browser built with Tauri 2, React, and Microsoft Edge WebView2. Modern monochrome chrome, real native website tabs, and a focused set of everyday browser features.

## Run

Open `releases/Mxplorer.exe` for the standalone app, or install `releases/Mxplorer_0.2.0_x64-setup.exe`. The installer checks for Evergreen WebView2 and downloads its bootstrapper if necessary. Builds are unsigned.

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
- Sidebar cookie editor with JSON/Netscape/header imports, JSON/Netscape exports, and encrypted saved cookies with selectable auto-restore policies.

The top arrow opens a searchable dropdown of tabs. Bookmarks and downloads toolbar buttons open library panels. The menu is a compact dropdown. Website snapshots stay in memory while chrome dropdowns are open so native WebView2 content cannot cover the controls.

## Cookie editor

Open a website and click the cookie icon in the toolbar, or choose **Cookie editor** from the menu. Inspect, add, edit or delete cookies, including HttpOnly cookies. Cookie values stay masked until explicitly revealed or edited. Domain, path, expiry, Secure, HttpOnly, host-only scope and SameSite are editable. Reload the page when you want a website to use changed cookies.

Import Cookie-Editor JSON, Netscape cookies.txt, or Cookie header text by pasting or selecting a file. Imports are validated before any cookies are changed and must belong to the current site. Export as JSON or Netscape using Copy or Download. Exported files contain plain cookie values.

Each import or edit offers three policies:

| Policy | Behavior |
|---|---|
| No auto-restore | Apply once; let the website manage the cookie. |
| Restore missing | Recreate a deleted or expired cookie; preserve refreshed values. |
| Keep exact values | Recreate missing cookies and replace differing values or attributes. |

Saved templates are encrypted with Windows DPAPI and persist across restarts. A native background loop checks them about every two seconds, even with the sidebar closed. They are also checked before navigation and after clearing website data. Expired persistent templates receive a renewed lifetime; WebView2 limits persistent cookies to 400 days. Session templates remain session cookies and are recreated on the next launch if enabled. Restoring a cookie cannot revive a session revoked by the server.

The **Saved for restore** tab lets you switch policies, pause/enable entries, restore now or forget a saved copy. Open a new tab with the editor still open to manage saved cookies across all sites. **Delete cookie** removes both the live cookie and its saved copy. **Clear live cookies** and Settings’ browser-data clearing retain saved copies; enabled entries return automatically. Pause or forget those entries to stop restoration.

WebView2 cannot distinguish an unspecified SameSite setting from Lax on reads. Netscape format cannot represent SameSite. The cookie editor supports the shared Windows website profile; partition-key editing is not available.

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
npm run test:native-cookies
npm run bundle
```

The normal build writes the executable and NSIS installer to `src-tauri/target/release/`. Set `CARGO_TARGET_DIR` to another drive when disk space is limited. Commit lockfiles make builds reproducible.

## Implementation and limits

`src/useBrowser.ts` owns tab and persisted UI state. `src/model.ts` validates stored data and resolves addresses. `src/App.tsx` implements trusted browser chrome; native views are managed by Rust in `src-tauri/src/`. Remote tabs have no native capabilities, and every custom command also validates its caller. Website profiles and the trusted interface’s local storage are separate. See [native host details](docs/native.md).

Windows is the supported target. Mxplorer uses WebView2, so website compatibility, DRM and sign-in restrictions may differ from full Edge. This release has one window and one website profile. It has no extensions, sync, password manager, private mode, ad blocking, download pause/resume, byte progress, or automatic updates. Popup links open as ordinary new tabs; scripted popup/opener workflows may not work. Session restore saves tab addresses, rather than each tab’s full navigation stack. Bookmarks and browsing history in UI local storage are not encrypted. Saved cookie templates use Windows DPAPI encryption.

Interface tests exercise the UI with a browser preview; Rust tests cover native input boundaries, keyboard mappings, download naming/identity, and navigation error state. Packaged website interactions require a separate native smoke check and are not established by those tests alone.
