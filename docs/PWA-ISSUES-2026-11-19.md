# Mobile findings — 2026-11-19

Status: investigated; no product code, deployed build, session metadata or routing changed.

## Canonical Bot Chat absent from search — confirmed cause

Owner reports no result for `Bot chat` under default profile. Read-only session metadata confirms the intended canonical conversation exists, is not archived, and has `hidden=1` (Bot Mode identity). Do not clear that flag or rename the canonical conversation to force listing.

PWA `src/App.tsx:296-300` searches only already-loaded rows; `src/lib/hermesApi.ts:399-418` requests 75 recent sessions using `/api/sessions`, `order=recent`, `min_messages=1`, active profile. Backend `hermes_cli/web_routers/sessions.py:183-242` calls `list_sessions_rich` without `include_hidden`. Installed `hermes_state_sessions.py:1335-1340` excludes hidden rows by default. Therefore loading more cannot discover this Bot Chat. Prior instruction to search then pin was wrong for this client.

Next design: supported profile-aware canonical Bot Chat resolution/open, then existing explicit pin controls. Verify exact installed resolver contract before implementing; preserve hidden state, ownership and profile boundaries. Do not widen ordinary listing to every hidden/internal conversation.

## iPhone search/scroll overlap — screenshot confirmed; root cause open

Source: owner's iMessage attachment, associated with text: “Send this to the PWA project there’s this Funky overlap where when I try to scroll, it covers up the box”. Private screenshot retained in Hermes attachment cache (not copied into this public-project document).

Observed: keyboard open; search field contains `Bot chat`; lower portion of the search field is clipped by a large flat black region above the iOS form-navigation accessory bar; top `Talk to Bob` panel is partly underneath the status/Dynamic Island area. This is the Conversations search screen, not the message composer. Screenshot alone does not establish which element paints the black region or reproduce scrolling.

Relevant seams: `src/App.tsx:337-360` writes visualViewport.height but does not use viewport.offsetTop as a layout offset; `src/styles.css:15-39,60` uses hidden body/shell overflow, fixed-to-visual-height flex layout, sticky topbar and clipped main panel. These are investigation leads, not proven cause. Require a keyboard/search/scroll-specific reproduction; reduced desktop viewport is not physical-iOS proof.

Source checkout had no tracked modifications at inspection; unrelated untracked research was preserved. Served-output bundle inspected locally requests recent ordering (minifier uses backticks); a naive search for double-quoted recent is not valid version evidence. No repair/deployment or physical-phone retest performed.

## Update 2026-11-20 — candidate built, not deployed

Both issues have an exercised fix in the working tree and in `dist-candidate/` (`dist/` untouched, no commit). Full record, test list, QA metrics/screenshots, decisions and the remaining physical-iPhone checks: `docs/plans/2026-11-19-pwa-issues-worklog.md` and `docs/research/evidence-2026-11-20-candidate-qa/`.

- Search: Conversations search now also runs the profile-scoped server search (`GET /api/sessions/search`) and merges hits into the loaded-row filter; hidden rows surface only when they match, under the active profile; opening uses the existing by-id flow; pinning stays manual. Ordinary listing unchanged (no `include_hidden`).
- Overlap (round 1, superseded): shell followed `visualViewport.offsetTop` (`.app-shell.follow-visual-viewport { position: relative; top: … }`). Chromium RED → GREEN, but the physical iPhone test on 2026-11-21 still showed the overlap.
- Overlap (round 2, 2026-11-21): the Sessions-screen shell keeps the full layout-viewport height (`.app-shell.layout-viewport-shell { height: 100dvh }`) so no keyboard pan — offsetTop- or scroll-based — can expose body background; the keyboard strip becomes `.session-list` bottom padding via `--keyboard-inset-bottom`. Chat screen unchanged. Candidate rebuilt (`dist-candidate/`, `assets/index-B3ldY1ky.js`), served on `:8449`; **confirmed on the physical iPhone 2026-11-22** ("looks good"). Details: worklog "Round 2 checkpoint".
