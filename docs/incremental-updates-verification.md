# Incremental updates verification

Local checks on 13 November 2026:

- 20 Vitest tests, 37 Playwright browser tests, 23 native Rust tests, and 21 release-tool tests passed.
- TypeScript/Vite production build, Rust formatting, all-target Clippy with warnings denied, actionlint, package-version consistency, and whitespace checks passed.
- Browser tests replace only native transport. They cover manual/startup/scheduled checks, notifications, progress, channel confirmation, retry, unmanaged builds, restart confirmation, refusal to restart on storage failure, and one-time tab restoration without changing the ordinary startup preference.
- Native tests authenticate feeds before using their content, reject tampering/foreign or mutable URLs and wrong channels, enforce version ordering, validate contiguous economical deltas, reject conflicting mutations, bind reconstructed packages to Windows-DPAPI receipts, and recheck staged bytes/channel before installation.
- Release tests cover signed-envelope tampering, metadata boundaries, target-aware baseline selection, out-of-order publication, immutable-upload resume, atomic commit failure/conflict, stable-latest repair, byte-exact verified Pages staging, artifact hashes, and uncompressed delta round trips.

## Actual browser delta

Packaged real managed-aware browser executables with pinned Velopack 1.2.161, including its startup-hook verification and WebView2 prerequisite. Reconstructed a 0.3.0 → 0.3.1 update:

| Package | Bytes |
|---|---:|
| Full 0.3.1 package | 6,916,601 |
| Delta package | 2,007,904 |
| Saved transfer | 71.0% |

The patched package matched every uncompressed entry and nuspec version in the full package. Its executable had FileVersion/ProductVersion 0.3.1 and SHA-256 `7c49f69456e64bf3f509123c7fa3b391e25010a422e13551117ec46720815427`, identical to the target executable. This is a measured example, not a promised percentage for all changes. Larger changes or missing/corrupt baselines can use a full package.

Evidence is retained locally at `D:\Mxplorer-build\incremental-validation\stable-output\verification\delta-verification.json`. Test builds and package output are isolated from the user's installation and profile.

## Reviews and transport

Independent native security review found no blocking remote-trust issue. Release review found and resolved non-atomic GitHub attachment replacement, failure to repair stable latest on retry, and selecting a baseline newer than a delayed build. Atomic Contents API commits and target-aware selection now have regression tests. A second targeted review found no new blocker in the Pages staging/signing boundary.

Direct TLS requests to raw.githubusercontent.com failed consistently on this Windows host, while github.com, api.github.com and morewebs.github.io were reachable. Canonical metadata stays on a separate orphan Git branch; clients use a verified GitHub Pages mirror. CI reads the canonical branch through the Contents API, so neither path depends on the raw-file host. Pages is configured in workflow mode.

Signing uses a repository Actions secret; its Windows DPAPI backup is outside the repository. Public-key files and signed feeds contain no private signing material or browser profile data.

Hosted stable/nightly publication, live feed verification, and activation of the update-enabled local installation are recorded after rollout below.
