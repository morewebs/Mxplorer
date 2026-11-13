# Stable/nightly incremental updates

The user requested built-in incremental updates, automated GitHub releases, stable updates on explicit releases, and nightly updates on commits. They confirmed nightly means successful pushes to main; stable means version tags. Both channels are selectable in the app.

## Architecture and alternatives

Use pinned Velopack 1.2.161 for Windows x64 packaging, binary deltas, staging and application replacement. Preserve Tauri/WebView2 and application identifier/profile storage. A small signed-source adapter verifies Ed25519 channel metadata before giving Velopack package data. Keep no GitHub credentials in the app. Tauri's official updater downloads entire installers; the third-party Tauri delta plugin remains unaudited and requires an older updater. Neither meets this project's needs as well. See docs/research/2026-11-13-incremental-updates.md.

Existing standalone/NSIS copies need a one-time full managed installation. New managed Setup.exe and portable ZIP builds support subsequent incremental updates. Never claim every update can be a delta: missing/corrupted baselines, large changes, or invalid patches fall back to a full package. Use deltas only when their total size is smaller than full and the chain is bounded. The updater downloads packages separately from user profiles. Changing channels is explicit and may move to an earlier version; same-channel downgrades are refused.

## User experience

A Settings update section shows the actual running version, selected channel, update status, optional release notes, progress, and errors/retry. Check at startup and every 15 minutes, plus a manual check. Make available updates visible from browser chrome without opening Settings. Checking never restarts or installs automatically. User clicks Download update, then Restart to update. Preserve browser session state before restart. Show a confirmation when switching channels could install an earlier version. Bare legacy executables explain that the managed installer enables updates and offer the official downloads page. Preview mode clearly cannot update.

## Native interface

All commands use the existing trusted main-webview guard. Update state is native, not arbitrary renderer URLs. Serialize state changes; repeated clicks or channel changes during download cannot race an install. Network/check/download work runs off the UI thread. Emit `update-status` with every state change/progress.

`UpdateStatus` JSON:
```
{currentVersion:string,channel:'stable'|'nightly',installed:boolean,
 phase:'idle'|'checking'|'available'|'downloading'|'ready'|'installing'|'error',
 progress:number|null,availableVersion:string|null,releaseNotes:string|null,
 downloadBytes:number|null,fullBytes:number|null,delta:boolean,
 error:string|null,lastCheckedAt:number|null,channelSwitch:boolean}
```

Commands: `get_update_status {}`; `check_for_updates {}`; `set_update_channel {channel}` returns status and invalidates previously staged work; `download_update {}` returns ready/error status; `install_update {}` applies only the currently verified pending update. Do not accept URLs, filesystem paths, version strings or arbitrary install arguments from the renderer. Persist selected channel in native app data. Build defaults derive from MXPLORER_CHANNEL, actual package version and commit metadata. Initialize VelopackApp before Tauri in the real browser entry point, not cookie smoke.

## Signed feed contract

Public key: `src-tauri/update-public-key.txt`, a base64 raw32-byte Ed25519 key. GitHub secret `MXPLORER_UPDATE_SIGNING_KEY` is PKCS8 PEM. Keep a Windows-DPAPI protected backup outside the repo; never print private material. Envelope JSON `{payload:string,signature:string}` contains base64 UTF8 payload bytes and base64 Ed25519 signature over exactly those bytes. Verify the signature BEFORE parsing/trusting payload.

Payload: `{schema:1,channel:'stable'|'nightly',publishedAt:RFC3339,assets:[{asset:VelopackAsset,url:string}]}`. VelopackAsset field names/types are the pinned Rust type (PackageId, Version, Type, FileName, SHA1, SHA256, Size, NotesMarkdown, NotesHtml as emitted by vpk). Require PackageId Mxplorer, safe basenames, SHA256 and matching size, no duplicate/conflicting filenames; URLs must be HTTPS under github.com/morewebs/Mxplorer/releases/download/ with the exact encoded filename. Bound feed/package sizes, response time, redirects, and delta-chain count. Assets live in immutable version releases. Canonical signed feeds are committed atomically through the GitHub Contents API on the separate update-feed branch, with the prior blob SHA as an optimistic concurrency check. Release attachment replacement was rejected during review because --clobber deletes the previous file before uploading its replacement. The client receives these exact signed files at `https://morewebs.github.io/Mxplorer/{stable|nightly}.json`, via an atomic GitHub Pages deployment after signature verification of both channels. Pages was selected after a real transport check found raw.githubusercontent.com unreachable on the target Windows machine. CI reads the canonical branch through the Contents API, avoiding CDN lag. Pages permissions are confined to the serialized publishing job. Feed contains enough previous packages/deltas to support skips. Failed feed or Pages publication leaves the previous deployed site intact. Missing first feed is not a broken installation. Authentication/integrity failures must not trigger execution or a trusted-success state.

## CI/CD

CI remains unprivileged for PRs. Trusted release workflow runs tests before publishing. Stable vX.Y.Z tags must match source version; nightlies use next patch prerelease `X.Y.(Z+1)-nightly.RUN.ATTEMPT`. Every main commit gets a unique nightly release (including initial pipeline adoption). Build metadata and UI version must match packages, eliminating hard-coded UI versions. Pin actions/tool versions. Sign channel feed only in publish job after tests/build; signing secret never enters PR/build jobs. Download previous authenticated full package before packing so vpk generates real deltas. Include Setup.exe, managed portable ZIP, nupkg assets and checksums. Publish immutable assets first, signed feed pointer last. Preserve other channel, stable latest marker, and prior release files. Failed builds do not advance feeds. Avoid overlapping publishing overwriting a newer feed with an older build. Production deployment includes main integration, first stable/nightly releases, and real hosted Actions evidence.

## Validation

Test signature tampering, malformed/cross-channel feeds, invalid URLs/filenames/digests, same-channel version ordering, channel-switch behavior, concurrent operations, missing managed installation, download errors, progress and restart confirmation. Test scripts with synthetic packages/keys and real signature verification; UI tests replace only native transport. Package two real browser versions in a disposable managed layout, generate/apply a real delta, prove transfer bytes below full, and verify resulting app version. Verify final release assets/feeds and automated hosted workflows. No user profile clearing and no destructive uninstall during tests.
