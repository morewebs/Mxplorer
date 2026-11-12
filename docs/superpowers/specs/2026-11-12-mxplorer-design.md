# Mxplorer

A focused Windows desktop browser powered by Tauri 2 and Microsoft WebView2. The user requested a new project built end to end, with normal browser features and modern monochrome dark styling.

## Product

Horizontal tabs above a compact navigation toolbar, optional bookmarks bar, and a generous new-tab screen. Charcoal (#141414), graphite (#1c1c1c), raised surfaces (#252525), borders (#333333), secondary text (#999999), and white (#eeeeee). Segoe UI Variable for controls; large restrained new-tab typography. The custom M mark is the distinguishing visual. Controls have keyboard focus, labels, tooltips, and appropriate disabled states.

Real native tabs, URL/search omnibox, back/forward, reload/stop, home, bookmarks, searchable history, download list and folder access, session restore, search engine preference, clear browsing data, zoom, find, print, fullscreen, and common shortcuts. Persist bookmarks/history/settings/session locally. Keep a useful new-tab page with editable shortcuts and recently visited pages. No seeded browsing history or fake download entries.

## Architecture and alternatives

Use React/TypeScript/Vite for trusted chrome and Rust/Tauri for child webviews. Native views allow normal website navigation without iframe restrictions. An iframe browser would fail on many sites; bundling an independent Chromium engine would conflict with the requested Tauri scope and add significant weight. Windows uses the installed Evergreen WebView2 runtime. NSIS installer bootstraps it if missing.

The trusted main webview alone receives native privileges. Remote guests have no Tauri capabilities. Rust commands additionally validate their caller and remote URLs. Prevent remote tabs from loading application protocols or file URLs. Guest keyboard accelerators use native WebView2 integration where possible. Download paths stay in the user's Downloads/Mxplorer directory, names are sanitized and collisions avoided.

## Scope boundaries

Single browser window; no extension store, profile sync, password manager, ad blocker, or production browser security claims. OS webview permission handling applies. Web compatibility, DRM and OAuth may differ from full Microsoft Edge. Deliver source, reproducible commands, tests, executable and Windows installer. Test real website loads, navigation, tabs, persistence, and downloads in the packaged app.

## Interaction refinement

The user found the tab arrow opening a sidebar surprising and asked for a calmer home screen. Use a compact searchable tab dropdown and standard menu dropdown. Keep the home page to branding, search, shortcuts, and real recent visits; omit date, taglines, empty history cards and decorative footers. Match standard bookmarks and address-selection shortcuts. Native guest previews remain in memory only while chrome overlays are open.
