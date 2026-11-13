# Incremental updates implementation plan

> **For agentic workers:** Use task-focused parallel agents for native update management and CI packaging; integrate and review before deployment.

**Goal:** Deliver real incremental Windows updates with automated stable/nightly GitHub releases.
**Architecture:** Velopack 1.2.161 plus authenticated source, signed GitHub-hosted channel envelopes, React update controls.
**Spec:** docs/superpowers/specs/2026-11-13-incremental-updates-design.md
**Tech stack:** Tauri2/Rust, Velopack, Ed25519, React, GitHub Actions/Node24.

## Constraints / review focus

Preserve profiles. Use main-only trusted commands. Never execute unsigned feed content. PRs receive no signing key. Channel switch invalidates pending work. Same-channel version rollback refused. Delta savings must be measured rather than assumed. Authenticate previous feed before using its packages as build bases. Keep stable visible despite many nightlies. Unmanaged builds cannot pretend to have working self-update. Verify actual runtime version everywhere.

### Task 1 — Native updater
- [ ] Write failing tests for signed source validation/state/version boundaries.
- [ ] Implement src-tauri/src/updates.rs (split helpers as needed), Cargo dependencies and startup/command integration per native contract.
- [ ] Run native tests/fmt/clippy; report runtime/package expectations.

### Task 2 — Release automation
- [ ] Write failing Node tests for signing/validation/merge and version selection.
- [ ] Implement scripts/release-* tooling and CI/release workflows using feed contract; pinned vpk, immutable assets then channel pointer.
- [ ] Test scripts/workflow syntax; document operator behavior and signing backup.

### Task 3 — UI/integration
- [ ] Add failing UI tests for check/available/progress/ready/restart/channel/error/unmanaged behavior.
- [ ] Build useUpdates hook and update Settings/chrome indicators; use real version metadata.
- [ ] Provision signing key securely, build/package, test signed feed/native integration and real incremental patch in disposable layout.
- [ ] Review full change and resolve findings; run frontend/native suites and inspect layouts.

### Task 4 — Deployment
- [ ] Push integrated main and publish initial stable tag; verify stable/nightly workflows, assets, and signed feeds.
- [ ] Activate new managed local browser while preserving existing profile; verify actual process/version/update state.
- [ ] Record exact evidence and limitations; commit documentation and finish with clean source state.
