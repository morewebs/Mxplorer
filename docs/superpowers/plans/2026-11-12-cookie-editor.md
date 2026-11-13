# Cookie editor implementation plan

**Goal:** Native sidebar cookie management with encrypted, user-controlled auto-restore in both requested modes.
**Architecture:** Rust owns live cookie operations, encryption, templates and reconciliation. React owns editor/import/export interactions; pure TypeScript validates common file formats before invoking Rust, which independently validates input.
**Spec:** ../specs/2026-11-12-cookie-editor-design.md

- [x] Add failing import/export/validation tests, implement cookie types and parsers.
- [x] Implement guarded native operations, DPAPI persistence, both reconciliation modes and startup/background restoration; test native rules and encryption roundtrip.
- [x] Add sidebar UI, explicit persistence controls and toolbar/menu entry. Test with mocked native seam and synthetic cookies.
- [x] Review security, async races, expiry handling, clear-data integration, and domain scoping. Fix confirmed findings.
- [x] Run frontend/native suites, build 0.2.0 Windows executable/installer, document verification and commit feature.

Review focus: Same-name cookies on different paths/domains; stale results after tab changes; editor deletion versus auto-restore; batch validation before any write; corrupted encrypted storage and app restart; persistence must work while sidebar closed.

## Verification

Completed 13 November 2026: 19 Vitest tests, 17 Playwright tests, 14 Rust tests; Clippy and production frontend pass. Actual isolated WebView2 smoke passes, including the production background timer, missing/exact modes, pause, encrypted vault reload, and clearing with damaged storage. Windows 0.2.0 executable and NSIS installer built. See ../../cookie-editor-verification.md for detailed evidence and limits.
