# Native host

The Rust host uses Tauri 2.12.5 multiwebview support on Windows and Evergreen WebView2. `src-tauri/tauri.conf.json` configures a frameless 1280 × 820 window, minimum 880 × 620, and an NSIS installer that downloads the WebView2 bootstrapper when required.

`create_tab` constructs a hidden, unfocused native view. Call `activate_tab` after creation to display it; `activate_tab` with `id: null` hides every website and focuses the trusted chrome. All bounds are logical pixels and only the active view is resized. Closing a pending creation cancels its eventual view. IDs must match `tab-[a-zA-Z0-9-]+` and are limited to 100 characters.

All custom commands verify both the `main` caller label and the trusted application origin. Only `main` has a capability, limited to listening and unlistening to events. A global navigation boundary also prevents the main view from leaving the application origin and prevents guests from navigating to local files or application protocols. HTTP and HTTPS are accepted from commands; `about:blank` is permitted only internally. New-window requests are denied and safe destinations are emitted as `new-tab` events. Events target the `main` **webview**, never the entire window.

Website data is persisted under the application's local data directory in `GuestProfile`, independently of the chrome's local storage. Guests share this website profile, like ordinary browser tabs. Clearing browsing data waits for WebView2's profile-clear completion. If no website is open, an offscreen maintenance view opens that profile to clear it. It remains hidden until application shutdown.

History flags and same-document URL changes come from WebView2's HistoryChanged and SourceChanged events. Back, forward and stop call native APIs. Zoom accepts a number (or a numeric string) from 0.25 to 5. Find accepts an optional string and uses WebView2's native find dialog; an explicitly empty string stops an existing find session. Older runtimes without the Find API use a page prompt and `window.find`. Printing uses the platform print dialog. Native operation errors after dispatch are logged to stderr.

`tab_action` with `action: "reload"` and `value: true` reloads through the native DevTools protocol with `ignoreCache: true`. Omitting the value performs ordinary reload.

`set_overlay {open:true}` captures the active guest as a PNG data URL, hides website views, and focuses chrome so dropdowns and address suggestions render above the page. Capture errors or a three-second timeout return null while still hiding the website. The host retains the active tab ID while the overlay is open, and resizing or activating cannot show a guest through the overlay. Closing the overlay restores the selected guest without stealing keyboard focus; `tab_action {action:"focus"}` explicitly transfers focus to a guest when needed. An overlay generation check prevents late captures from reopening dismissed overlays. Captures remain in process memory and are discarded when closed.

Native navigation completion always emits `loading:false`, with a readable `error` on network failure. Starting another navigation and completing successfully emit `error:null`. Completion of superseded navigation is ignored. Downloads use random UUID v4 identifiers so persisted download history remains distinct across application launches.

WebView2 AcceleratorKeyPressed handles browser shortcuts even when a website owns keyboard focus. Ctrl+L and Alt+D transfer native focus back to chrome before emitting the address action. Ctrl+T, Ctrl+W, Ctrl+Shift+T, Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+PageUp/PageDown, Ctrl+R, Ctrl+Shift+R, F5, Ctrl/Shift+F5, Ctrl+H/J/F/D, Ctrl+Shift+B/O, Ctrl+plus/minus/0 and F11 emit the documented shortcut actions. Chrome focus is restored for new tabs and panels. OS-reserved combinations still follow Windows behavior.

Additional shortcuts include Alt+Left/Right for navigation, Ctrl+P to print, Ctrl+K for the address, Ctrl+1–9 to select tabs (9 selects the last tab in chrome), Ctrl+Shift+A for tab search, Ctrl+Shift+B to toggle the bookmarks bar, and Ctrl+Shift+O for bookmarks. Escape emits stop while remaining available to WebView2's native find dialog.

Downloads go to the user's `Downloads/Mxplorer` directory. Filenames are sanitized for Windows, reserved device names are prefixed, and collisions with existing or concurrent downloads receive numbered suffixes. Each download emits downloading and completed/failed states. Byte progress, pause/resume, opening individual files, multiple profiles, extensions and a password manager are outside this host's scope. Browser compatibility and website permission prompts follow the installed WebView2 runtime.

Run `cargo check` and `cargo test --lib` from `src-tauri`. Unit tests cover URL and ID boundaries, invalid geometry, Windows filename sanitization, concurrent collision reservation, and keyboard mappings. Real native website loads, focus, dialogs and downloads still require the packaged-app checks described in the implementation plan.

Microsoft's [Find options reference](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2findoptions) describes the native default find dialog and highlighting settings.
