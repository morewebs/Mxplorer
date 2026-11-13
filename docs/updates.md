# Publishing Windows updates

Mxplorer uses Velopack **1.2.161**, pinned in the Rust dependency and packaging CLI. Stable releases run on a `vMAJOR.MINOR.PATCH` tag matching all source manifests. Every successful push to `main` builds a unique next-patch nightly: source `0.3.0`, Actions run `12`, attempt `2` becomes `0.3.1-nightly.12.2`. The immutable release tag is `nightly-0.3.1-nightly.12.2`. Source versions remain stable; only the nightly CI checkout is rewritten. The running executable, frontend build and package use the rewritten version.

Main uses the reusable CI workflow once through Release. PRs and feature branches retain frontend unit/build/browser tests, Windows Rust formatting/tests/Clippy, native cookie restoration, and NSIS build verification. These builds receive no signing secret. Release builds additionally restore an authenticated previous full package, produce managed Setup/portable ZIP/full and delta nupkgs, and verify a real delta round trip. Setup bootstraps Evergreen WebView2 through `--framework webview2`.

## Channel feeds and publication

The orphan `update-feed` GitHub branch contains independent canonical `stable.json` and `nightly.json` files. After committing the canonical pointer, the publish job verifies both channels and deploys their exact bytes as a GitHub Pages mirror. The app fetches `https://morewebs.github.io/Mxplorer/{stable|nightly}.json`. Each file is a complete signed envelope:

```json
{"payload":"BASE64_UTF8_JSON","signature":"BASE64_ED25519_SIGNATURE"}
```

The signature covers the exact decoded payload bytes. The payload contains `schema: 1`, `channel`, `publishedAt` and `assets`. Every entry has an original Velopack asset (PascalCase fields, normalized `NotesHtml`) and an immutable HTTPS GitHub release URL. The app embeds the raw 32-byte Ed25519 public key from `src-tauri/update-public-key.txt`. No GitHub token is needed by the app.

Publication has two stages:

1. Verify checksums, upload a draft version release, verify remote bytes, then expose the complete immutable release. Existing version files are never replaced. A failed partial draft can resume by adding missing files; a conflicting file fails the run.
2. In the separately serialized publish job, read and authenticate the current channel, verify the immutable release, merge bounded history, sign, then atomically commit only that channel's JSON through GitHub's Contents API. The request includes the previous blob SHA, so a conflicting write fails without removing the valid feed. The signing key enters this job alone. Read and verify the committed envelope again before marking a stable release latest. An equal-version rerun repairs the latest marker if a previous attempt committed the feed but failed before setting latest; an older version cannot change it.
3. While still holding the same publication lock, read both canonical channel files through the Contents API, verify their signatures and channels, and deploy their exact bytes to GitHub Pages. A missing first channel is omitted; an invalid existing channel blocks deployment. The Pages deployment runs last, so a failed mirror deployment leaves the previous public site available. Rerunning publish stages the current canonical files again and repairs the mirror without rolling a channel back.

The pointer job compares semantic versions and refuses to replace an equal or newer channel. This protects against slow older builds finishing after newer builds. The pointer lock uses GitHub's `queue: max` (up to 100 waiting jobs) so pending publication jobs do not replace each other. Immutable publication remains independent, so successful main commits keep their releases. Both channels share the pointer lock to protect first creation of `update-feed`; the other channel file is preserved. The branch is initialized as an orphan commit containing only a small README; source history and files are never copied into it. Twelve full versions plus their contiguous deltas are retained. A delta is included only when its restored baseline is the preceding full version in the current feed. Overlapping builds with a stale baseline publish a full fallback instead of an invalid chain. The application also bounds its delta count and total transfer size; older installations can download a full package.

The first release of each channel has no authenticated baseline, so it contains a full package without a delta. Missing initial feeds are accepted; invalid signatures, metadata, hashes, network failures and missing referenced packages fail packaging rather than being treated as a new channel. Existing bare EXE/NSIS installations require one managed Setup installation or extraction of the managed portable ZIP. Keep existing browser profiles and the Tauri application identifier; do not uninstall or clear profile data to test updates.

Baseline restoration selects the greatest authenticated full package strictly older than the target build. This allows a delayed build to finish safely when newer versions already exist; it never asks Velopack to generate a backwards delta. Use `node scripts/release-feed.mjs restore CHANNEL TARGET_VERSION OUTPUT BASELINE_JSON` for the same operation locally.

Builds read canonical channel metadata from `api.github.com` through the GitHub Contents API, then verify its signature before downloading the baseline. The CI build's token has read-only contents permission; a local `GH_TOKEN` is optional for this public repository. The updater and packaging flow do not depend on `raw.githubusercontent.com`, which reset TLS connections consistently during local rollout testing.

## Signing key

`MXPLORER_UPDATE_SIGNING_KEY` is a GitHub Actions repository secret containing an Ed25519 PKCS8 PEM private key. The repository contains only its public key. On the provisioning Windows account, `node scripts/provision-updates-key.mjs` creates or reuses the key, writes the raw public key, uploads the secret through standard input, and keeps a Windows DPAPI CurrentUser encrypted backup at `%USERPROFILE%\.mxplorer\update-signing-key.dpapi`. Do not commit, print, or copy plaintext private material. Re-running provisioning reuses the encrypted backup; preserve the account's DPAPI recovery capability. Changing the public key requires distributing an app that trusts the replacement before signing feeds with it.

## Local verification and release operations

```powershell
node --test scripts/release-*.test.mjs
node scripts/check-release-version.mjs v0.3.0
```

Before a stable release, update npm/package-lock, Cargo/Cargo.lock and Tauri versions together, pass the full project checks, integrate `main`, then push the matching version tag. Observe the Release workflow through its publish job. Confirm the version release has managed Setup, portable ZIP, full nupkg, a delta when a baseline exists, `release-manifest.json` and `SHA256SUMS.txt`. Confirm the channel envelope verifies with the embedded public key and references only that release and retained immutable predecessors. Check that stable remains the repository's latest release after nightly publication.

For a failed build, fix the build and rerun; no pointer was advanced. For a failed immutable upload, rerun the failed job against the same artifacts. For a failed pointer job, rerun publish after fixing the cause. Never repair a version release by clobbering package bytes; publish a new version. A wrong-channel, invalid or mismatched-key feed fails closed and needs operator correction.

The feed branch must allow the Release workflow's `contents: write` token to create/update metadata commits. Do not enable required-PR rules on that branch without giving this workflow an appropriate bypass. Repository Pages must use the GitHub Actions deployment source, and its `github-pages` environment must permit Release workflows from main and stable version tags. Only the publish job has `pages: write` and `id-token: write`; PR/build jobs receive neither. A failed Contents API write leaves the previous canonical channel available. Pages caching may briefly serve an older valid envelope after deployment; the signed version ordering prevents a downgrade. Do not use release-asset `--clobber` for channel publication: it deletes the old asset before uploading its replacement.

For a local packaging check, install .NET SDK 8.0.428 and `dotnet tool install vpk --version 1.2.161 --tool-path PATH`. This machine uses `D:\Mxplorer-build\dotnet` and `D:\Mxplorer-build\vpk`; set `DOTNET_ROOT` to the former before calling `vpk.exe`. Package two actual browser builds into a disposable output directory, keeping the previous full nupkg there before the second `vpk pack`. Pass `--framework webview2 --runtime win-x64 --channel stable` (or `nightly`) and the actual matching package version. Do not use `--skipVeloAppCheck`: the hook check proves the packaged binary initializes Velopack.

`node scripts/release-verify-delta.mjs OUTPUT BASELINE_JSON CHANNEL VERSION VPK_EXE` applies the generated delta and compares every uncompressed package entry and nuspec version against the full package. `BASELINE_JSON` contains `baselineFile` and `baselineVersion`, produced by `release-feed.mjs restore`. The result records actual full/delta bytes and whether the delta saves bandwidth. Compressed ZIP bytes need not be identical after reconstruction. CI retains `delta-verification.json` as a separate Actions artifact. A delta larger than its full fallback is valid but the app chooses the full transfer. This check does not replace a disposable installed-browser restart/profile-preservation smoke test.

## Local delta evidence — 2026-11-13

Two actual Windows browser builds, PE versions `0.3.0` and `0.3.1`, were packaged with `vpk 1.2.161`, startup-hook verification enabled, the `stable` channel and the WebView2 prerequisite. The first full nupkg remained in the second pack output directory. Velopack generated `Mxplorer-0.3.1-stable-delta.nupkg` automatically, and `vpk delta patch` reconstructed the target package successfully.

| Check | Result |
| --- | --- |
| Target full package | 6,916,601 bytes |
| Delta package | 2,007,904 bytes |
| Transfer reduction for this pair | About 71.0% |
| Every uncompressed package entry and nuspec version | Matched target full package |
| Reconstructed browser PE FileVersion / ProductVersion | `0.3.1` / `0.3.1` |
| Reconstructed executable SHA256 | `7c49f69456e64bf3f509123c7fa3b391e25010a422e13551117ec46720815427` (matched the actual 0.3.1 build) |

Disposable artifacts are under `D:\Mxplorer-build\incremental-validation`, with machine-readable evidence at `stable-output\verification\delta-verification.json`. The local 0.3.1 package is an experiment; publishing a stable tag still requires matching checked-in source versions. This establishes real binary-patch generation and reconstruction for this pair, without promising a fixed saving for future updates or replacing an installed restart/profile-preservation test.

Pinned upstream references: [Velopack 1.2.161](https://github.com/velopack/velopack/releases/tag/1.2.161), [delta packaging](https://docs.velopack.io/packaging/deltas), [pinned WebView2 prerequisite support](https://github.com/velopack/velopack/blob/1.2.161/src/bins/src/windows/runtimes.rs), [GitHub atomic file-content update API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents), [GitHub concurrency queues](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
