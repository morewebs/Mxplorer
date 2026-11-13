# Cookie editor workflows implementation plan

> **For agentic workers:** Use executing-plans to implement task-by-task.

**Goal:** Add the approved Cookie-Editor workflows and install the updated local build.
**Architecture:** Extend React cookie components; retain native encrypted storage and commands. Separate non-sensitive preferences from cookie data.
**Tech stack:** React, TypeScript, Tauri/WebView2, Vitest, Playwright.
**Spec:** docs/superpowers/specs/2026-11-13-cookie-editor-workflows-design.md

## Constraints and review focus

No cookie values in localStorage. No changes to either native restore policy. Preserve security/expiry attributes hidden by simple editing. Avoid draft resets during polling. Keep toolbar usable for long lists and the 880x620 minimum window. Provide clipboard-denied fallback and avoid double encoding values. Site changes must discard the previous site's draft.

### Task 1: Transfer workflows

- [x] Add failing format tests for Header String and UI tests for direct-copy format choices and simple import.
- [x] Implement exportHeader in formats.ts; simplify TransferForm.tsx, preserving optional file import/download and policy choices.
- [x] Verify unit and transfer UI tests.

### Task 2: Compact editing and options

- [x] Add failing UI tests for inline edit, preserving hidden attributes, copy value, persisted preferences, site changes, and fixed toolbar visibility.
- [x] Add CookieOptions.tsx for preference state/UI; make CookieForm support inline/simple mode; update CookiePanel.tsx and cookies.css with compact rows and an anchored action bar.
- [x] Verify cookie UI tests and the full frontend suite/build. Inspect synthetic screenshots at normal and minimum window sizes.

### Task 3: Delivery

- [x] Review changes; resolve findings and rerun affected checks.
- [x] Bump to 0.2.1, document verification, build the Windows installer/executable, replace the old local executable, and reopen Mxplorer.
