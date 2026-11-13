# Incremental Windows updates for Mxplorer

Researched 2026-11-13 against primary documentation and pinned upstream source. This note proposes an architecture; it does not implement an updater.

## Recommendation

Use **Velopack for packaging, binary deltas, installation and restart**, with a small Mxplorer-owned **signed release-source adapter**. Keep Tauri for the application. This is the most established candidate examined that already supplies the Windows update helper and delta pipeline. Its official Rust client has a stable **1.2.161** release; pin the Rust crate and `vpk` to the same version. Current website documentation also describes newer development features, so the pinned source is the authority when they disagree. [Stable release](https://github.com/velopack/velopack/releases/tag/1.2.161), [Rust API](https://docs.rs/velopack/1.2.161/velopack/), [matching CLI version](https://docs.velopack.io/distributing/github-actions).

This requires a distribution change: Velopack's self-updating portable output is a **ZIP containing its managed layout**, rather than a lone executable. Continue offering the raw EXE as a manual-update artifact if useful. Do not promise that an arbitrary copied bare EXE can update itself through Velopack. [Packaging outputs](https://docs.velopack.io/packaging/overview).

If retaining the current NSIS distribution is more important than incremental downloads, the current official Tauri updater is the simpler alternative. It downloads a signed complete NSIS installer; it does not offer an official binary-delta transport. Building patches around it would require additional patch/cache/security orchestration. [Official updater](https://tauri.app/plugin/updater/), [upstream source](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/updater).

## What actually becomes incremental

Velopack creates Zstandard binary patches **inside individual files**, so even a single executable with embedded React assets can benefit. This is genuinely downloading patch data, rather than downloading the entire new EXE and only copying changed files. Delta generation needs the previous full `.nupkg` in the pack output directory; `vpk download` supplies it in CI. More than one sequential delta can be applied when versions were skipped. There is a 2 GB per-file limit. Actual savings must be measured on two real Mxplorer release builds: recompilation and compression can change substantially more bytes than the source edit suggests. [Delta format and CI prerequisite](https://docs.velopack.io/packaging/deltas).

## Rust integration and limitations

Run `VelopackApp::build().run()` before starting Tauri. Construct `UpdateManager::new(source, options, None)`, call `check_for_updates()`, then `download_updates(&info, progress_sender)`, then apply/restart. These Rust calls are synchronous; put checking/downloading on a blocking worker and send progress to the trusted application UI. [Official Rust integration](https://docs.velopack.io/getting-started/rust).

The extension point is `sources::UpdateSource: Send + Sync`, with two synchronous methods:

```rust
fn get_release_feed(&self, channel: &str, app: &Manifest,
    staged_user_id: &str) -> Result<VelopackAssetFeed, velopack::Error>;
fn download_release_entry(&self, asset: &VelopackAsset,
    local_file: &Path, progress_sender: Option<Sender<i16>>)
    -> Result<(), velopack::Error>;
```

`Manifest` is `velopack::bundle::Manifest`; implementing this outside the crate requires its `public-utils` feature because `bundle` is otherwise private. Suggested dependency: `velopack = { version = "=1.2.161", features = ["public-utils"] }`. [Trait](https://docs.rs/velopack/1.2.161/velopack/sources/trait.UpdateSource.html), [module exports](https://raw.githubusercontent.com/velopack/velopack/1.2.161/src/lib-rust/src/lib.rs), [visibility macro](https://raw.githubusercontent.com/velopack/velopack/1.2.161/src/lib-rust/src/macros.rs).

Important pinned Rust-source findings: downloaded full/delta packages get size and SHA256 checks, falling back to SHA1 when SHA256 is absent. Delta errors fall back to a full download. However, `MaximumDeltasBeforeFallback` is declared/defaulted but never consulted, and this implementation has no summed-delta-size heuristic. It also skips validation for an existing target cache file, and does not compare a reconstructed ZIP to the published full-package digest. The source adapter must enforce chain/size policy; cache handling needs explicit review. Do not copy claims about the C# client's heuristics into Rust acceptance criteria. [Pinned manager implementation](https://raw.githubusercontent.com/velopack/velopack/1.2.161/src/lib-rust/src/manager.rs).

The patcher reconstructs and recompresses a package rather than reproducing the original compressed ZIP byte-for-byte. It relies on Zstandard patch checksums; separate `.shasum` verification is commented out. Therefore authenticate every patch input and treat the installed base/cache as trusted local state. This is not the same guarantee as verifying a signature over the final Tauri installer. [Pinned patcher](https://raw.githubusercontent.com/velopack/velopack/1.2.161/src/bins/src/commands/patch.rs).

## Signature boundary

Stock Velopack feeds contain hashes, not a pinned publisher signature. Authenticode signing is available for Windows binaries and Setup, but it should not be described as authenticating the JSON feed. A hash fetched alongside a hostile package does not establish publisher identity. [Feed format](https://docs.velopack.io/distributing/overview), [code signing](https://docs.velopack.io/packaging/signing).

Proposed adapter contract, inferred from the source extension point:

1. Fetch bounded raw feed bytes and a detached Ed25519 signature over those exact bytes; verify with a public key embedded in Mxplorer **before returning a feed**. Private signing key stays in protected CI secrets.
2. Validate signed channel, package identity, architecture, version, mandatory SHA256, sizes and unique basename-only package names. Keep immutable HTTPS download URLs in a signed mapping; `FileName` remains a plain basename because the manager uses it as a local path.
3. Return only authenticated assets and delegate their downloads to the established HTTP machinery. Reject missing/bad signatures; never silently use an unsigned feed.
4. Authenticate each delta and full fallback. Require sequential chain continuity and cap total chain bytes/count before passing deltas to the manager. Protect cached packages and validate reuse; fresh corrupt/missing bases should force a full package.
5. Keep normal downgrade rejection. An explicit user channel change can permit the required lateral/downgrade transition; never let web content choose arbitrary feeds, keys, paths or execution arguments.

This adapter owns **release authentication and selection**, while Velopack continues to own patching, waiting for process exit, installation and restart. It avoids implementing a second Windows replacement helper. The API supports the design, but a Windows integration test is still needed before calling it production-ready. [Source extension API](https://raw.githubusercontent.com/velopack/velopack/1.2.161/src/lib-rust/src/sources/mod.rs), [graceful apply API](https://docs.rs/velopack/1.2.161/velopack/struct.UpdateManager.html).

## Stable, nightly, and GitHub Actions

Use separate channels, e.g. `win-x64-stable` and `win-x64-nightly`. Built packages remember their channel; `UpdateOptions.ExplicitChannel` switches it and `AllowVersionDowngrade` permits returning to an older stable version. Keep downgrade opt-in tied to that user action. [Channels](https://docs.velopack.io/packaging/channels), [options](https://docs.rs/velopack/1.2.161/velopack/struct.UpdateOptions.html).

Velopack's GitHub source supports prereleases and searches channel-specific feed assets across releases, but stable 1.2.161 fetches only the **first ten GitHub releases, then filters prereleases**. Frequent nightlies can therefore hide the last stable release. Do not use this source unchanged for a mixed stable/nightly repository. Prefer a signed aggregate feed per channel at a predictable location, referencing immutable GitHub release asset URLs. The HTTP source actually requests `releases.{channel}.json` despite its stale `RELEASES` doc comment. [GitHub source](https://raw.githubusercontent.com/velopack/velopack/1.2.161/src/lib-rust/src/sources/github.rs), [HTTP source](https://raw.githubusercontent.com/velopack/velopack/1.2.161/src/lib-rust/src/sources/http.rs).

Proposed CI: stable runs on explicit version tags/manual release; nightly runs after each `main` commit, with a unique monotonically ordered SemVer prerelease. For each channel: restore previous full package, compile, `vpk pack --channel ...`, round-trip the delta in CI, upload immutable assets, then publish/sign the completed aggregate feed last. Serialize publishing per channel to prevent two runs selecting the same predecessor or older runs overwriting the newest feed. Retain a contiguous delta history and complete-package fallback. Never overwrite the single previous-nightly package in place. The upstream CLI automates `download -> pack -> upload` and GitHub publishing; signing the Mxplorer feed is the additional step. [Deployment CLI](https://docs.velopack.io/distributing/deploy-cli), [GitHub workflow](https://docs.velopack.io/distributing/github-actions).

## Migration and alternatives

There is no documented automatic NSIS-to-Velopack migration: documented migrations cover ClickOnce and Squirrel. Existing Mxplorer users need one full Velopack Setup installation or portable ZIP extraction. Keep the Tauri identifier and profile locations unchanged; explicitly verify existing browsing data survives and remove obsolete shortcuts/uninstall registration carefully. A raw development EXE without Velopack metadata cannot simply construct an installed `UpdateManager`. [Documented migration families](https://docs.velopack.io/category/migrating), [locator contract](https://docs.rs/velopack/1.2.161/velopack/locator/struct.VelopackLocatorConfig.html).

The promising `tauri-plugin-updater-delta` is published as **0.2.0** (registry checked directly), but the maintainer labels it pre-release and says its independent security audit has not happened. It deliberately supports official updater `>=2.10.1,<2.12.0`: 2.12's signed-version trusted-comment behavior conflicts with its own signed identity. It would keep NSIS and reconstruct/verify official artifacts, but requires adopting an unaudited dependency and older updater contract. Do not choose it as the maintained production default today. Revisit after the audit and current-updater compatibility land. [Release caveat](https://github.com/Chahdane/tauri-updater/releases/tag/v0.2.0), [exact dependency constraint](https://raw.githubusercontent.com/Chahdane/tauri-updater/v0.2.0/crates/plugin/Cargo.toml), [registry](https://crates.io/api/v1/crates/tauri-plugin-updater-delta).

Before rollout, test a real Windows installation through two releases; missing/corrupt base; skipped nightlies; signature/digest failures; interrupted download; stable/nightly switch and return; restart with browser state preserved; and old NSIS/profile migration. Measure full versus delta bytes on those actual binaries. No percentage saving is guaranteed by this research.
