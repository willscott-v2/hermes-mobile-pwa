# Worklog — PWA issues 2026-11-19 (Bot Chat resolve + iPhone search overlap)

Resume point for this task. Tick steps as verified. Paths use `~` placeholders.

## Constraints (locked, from handoff)
- No deploy: `dist/` is LIVE. Candidate output ONLY via `npm run build:candidate` → `dist-candidate/`.
- No commit/push/service restart/auth/provider/permission changes/external sends.
- Issue 1: preserve hidden flags, canonical identity, profile isolation, ownership. Do NOT unhide all internal sessions, rename chats, touch state.db directly, auto-repin `<session-id>`, or change notification routes.
- Issue 2: Conversations search (not composer). Fix narrowly; preserve chat/voice/attachment behavior.

## Verified facts (with anchors)
- `docs/PWA-ISSUES-2026-11-19.md` read (21 lines). Confirms cause for issue 1; issue 2 root cause open.
- Backend `~/.hermes/hermes-agent/hermes_cli/web_routers/sessions.py:182-245` `GET /api/sessions` → `db.list_sessions_rich(..., include_pinned=True, **scope)`; no `include_hidden` passed. Scope = source/sources/exclude_sources/cwd_prefix/min_message_count/include_archived/archived_only/include_subagents.
- Project git: branch has 5 recent commits, HEAD `999bdf7 feat(pins): generic main chat + second pinned chat`. Tracked tree clean; only untracked docs/research. `dist-candidate/` already exists (stale: assets+icons only, no index.html).
- Scripts: `build:candidate` (→ dist-candidate), `preview:candidate` (port 4180, proxies dashboard 127.0.0.1:3456), `test` (vitest), `test:e2e` (playwright), `qa:mobile`.

## Step 1 results (2026-11-20, read-only GETs, dashboard session-token header; evidence file `~/.hermes/cache/scratch/pwa-step1-evidence.txt`)
- `GET /api/sessions/{id}?profile=default` → 200 for canonical `<session-id>`: `title=Bot Chat, hidden=1, archived=0, pinned=0, profile=default, source=cli, message_count=33`. By-id open works for hidden rows.
- `GET /api/sessions?limit=75&order=recent&min_messages=1&profile=default` (the PWA's list call) → 77 rows / total 1062; canonical ABSENT (hidden filter). Confirms issue doc.
- `GET /api/sessions/search?q=Bot%20Chat&profile=default&limit=20` → 20 results; canonical PRESENT at rank 13 (via FTS message-content lane; the route's title lane uses `list_sessions_rich(search_query=)` without `include_hidden`, so hidden rows only surface when message text matches). Search route (`hermes_cli/web_routers/sessions.py` `search_sessions`) = id-match → FTS content → title fill; dedupes by compression lineage; stamps `profile`.
- Same search with `profile=sales-test` → canonical ABSENT, all rows `profile=sales-test`. Search is profile-scoped server-side.
- sqlite ground truth (read-only): `<session-id>|Bot Chat|hidden=1|archived=0|pinned=0`; `<session-id>|Bob|0|0|pinned=1`.
- Auth for probes: `/auth/password-login` POST with config basic_auth gave 401 (config plaintext does not verify against stored hash — not touched); used `X-Hermes-Session-Token` from the dashboard LaunchAgent env instead. No config/auth changes made.
- Mechanism decision for issue 1: client-only. Any backend change (e.g. include_hidden in the title lane) would need a dashboard restart, which is not authorized; note as follow-up.

## Step 2 results (PWA inventory, 2026-11-20)
- `src/App.tsx:296-300` `filteredSessions` = substring filter over already-loaded `sessions` only (title/preview/workspace/source). Input at `:1487` placeholder "Search loaded sessions"; `canLoadMore` disabled while filtering (`:1412`). Rows render at `:1497` via `openSession(session)`; `sessionDetail` (`hermesApi.ts:473`) hits `GET /api/sessions/{id}?profile=` — works for hidden rows (Step 1).
- `hermesApi.ts:399-419` `sessionPage` → `/api/sessions?limit&offset&order=recent&min_messages=1[&profile]`; no `include_hidden` (must stay that way). No search client exists. `normalizeSession` (`:764`) keys on `raw.id`; search rows carry `session_id` + `id`.
- `App.tsx:28` `type Client = HermesApiClient | MockHermesClient` → any new client method must exist on both. Mock fixtures `src/lib/mockHermes.ts:7-26`, profile-filtered via `filterSessionsByProfile`.
- Viewport handler `App.tsx:337-361`: sets `--visual-viewport-height` = `visualViewport.height`, `--keyboard-inset-bottom` = `innerHeight - vv.height - vv.offsetTop`; never applies `offsetTop` as a position/offset. `styles.css:16` `body{overflow:hidden}`, `:20-29` `.app-shell{height:var(--visual-viewport-height);overflow:hidden}` at layout top 0, `:60` `.main-panel{overflow:hidden}`, `:134-136` `.sessions-screen{overflow:hidden}` + `.session-list` flex scroller. Only `position:fixed` is the sheet backdrop (`:245`, `inset:0`), so a `transform` on `.app-shell` would re-parent it — avoid transforms; use `margin-top`.
- Mechanism for issue 2 (likely, from layout math; not yet phone-proven): with the iOS keyboard up the layout viewport stays `innerHeight` tall while the visual viewport shrinks and can pan (`offsetTop` 0…keyboard height). The shell is `vv.height` tall at layout y=0, so once iOS pans to reveal the focused search input (or the user drags), the visible region `[offsetTop, offsetTop+vv.height]` shows the shell's bottom edge clipping the input and bare `body` background (#050607, flat black) below it, while the shell top (Talk to Bob card) slides under the status bar. Matches both observations in the issue doc.
- Step 3 (screenshot): not found in `~/.hermes/attachments`, `~/.hermes/cache/images`, Messages attachments (Nov 18-20 image search). Proceeding on the issue doc's description; physical re-check stays on the iPhone list.
## Step 4 checkpoint (RED, 2026-11-20 16:15 CST)
- `src/lib/sessionSearch.test.ts` (vitest): fails to import `./sessionSearch`, `./viewportLayout`, `HermesApiClient.searchSessions` — modules not yet written.
- `tests/e2e/search-keyboard-pan.spec.ts` (Playwright, 390×852, fake `visualViewport` installed pre-boot, mock mode, search focused with "Bot chat"): keyboard-open-without-pan state PASSES on current code; pan state (`offsetTop=200`) FAILS: `shellTop` 0 vs visual top 200 → 200px of visual viewport below the shell is bare body background. Reproduces the issue-doc mechanism in-browser. Backdrop test passes (baseline).

## Step 5 checkpoint (GREEN, 2026-11-20 16:25 CST)
- New: `src/lib/viewportLayout.ts` (pure viewport math incl. `--visual-viewport-offset-top`, clamped), `src/lib/sessionSearch.ts` (`searchQueryForServer`, `sessionMatchesQuery`, `mergeSearchResults` with exact-title > title > loaded > server tiers, profile guard, dedupe), `HermesApiClient.searchSessions` + `MockHermesClient.searchSessions` (+ mock hidden fixture `mock-hidden-bot-chat`, reachable by search/by-id only).
- `App.tsx`: debounced (250 ms, ≥2 chars) profile-scoped server search merged into `filteredSessions`; stale responses ignored via query/profile stamp; rows not in the loaded list carry `data-search-hit` + "found by search"; status lines for searching / server error / no match. Placeholder "Search loaded sessions" → "Search conversations". Viewport effect now also publishes `--visual-viewport-offset-top`. Shell gets `follow-visual-viewport` class on the Sessions screen only.
- `styles.css`: `.app-shell.follow-visual-viewport { position: relative; top: var(--visual-viewport-offset-top) }` — relative offset, not transform (would re-parent fixed `.sheet-backdrop`). Chat screen layout untouched.
- No `include_hidden` anywhere; listing request unchanged (asserted by test). No pin/notification/state.db changes.
- `npm run typecheck` exit 0. `vitest run`: 26 files / 483 tests pass (14 new in `sessionSearch.test.ts`). Playwright: 87/87 pass after updating one old placeholder string in `read-and-continue.spec.ts:184,187`. New e2e: `search-keyboard-pan.spec.ts` (pan state now GREEN: shell top/bottom == visual viewport, 0 px uncovered), `search-hidden-session.spec.ts` (hidden row absent from list, found by search, opens, pin stays explicit; profile isolation; clearing search restores list).

## Step 6 checkpoint (candidate exercised, 2026-11-20 ~16:30 CST)
- `npm run build:candidate` → `dist-candidate/` (`assets/index-CoiGEwPN.js`, `index-WJRPV6Ao.css`); exit 0. `dist/index.html` mtime unchanged (Nov 12 15:34), `git status dist` clean → LIVE output not touched.
- `npm run preview:candidate` on 127.0.0.1:4180 (ephemeral; stopped afterwards). `GET /` 200 serving the candidate hash; `GET /hermes/api/sessions/search?...` → 401 without credentials = proxy to the real dashboard is wired. No credentials were entered into the browser.
- `npx playwright test --config scripts/qa/candidate.config.ts` (390×852, mock mode, fake visualViewport) → 1/1 pass. Metrics `docs/research/evidence-2026-11-20-candidate-qa/metrics.json`: closed shell 0–852; keyboard open shell 0–516, search 291–339; panned (offsetTop 200) shell 200–716 == visual viewport, search 491–539 inside, `uncoveredBelow` 0; closed again shell 0–852. Screenshots `01-…closed.png`, `02-…keyboard-open.png`, `03-…panned-200.png` (visually: search field whole, Bot Chat row "found by search", no black band), `04-hidden-bot-chat-opened.png` (chat opened, "Set as Bob" still a manual control).

## Remaining physical-iPhone checks (not provable on desktop Chromium)
1. Sessions screen, default profile, type "Bot chat": the canonical hidden Bot Chat row (`<session-id>`, "found by search") appears; open it; confirm it is the real one (33+ messages, Bot Mode identity); then use the existing "Set as Bob" / "Pin" controls if the owner wants — nothing auto-pins.
2. Same search with keyboard up: drag the list / let iOS pan — the search field must stay whole and no flat black region appears above the accessory bar; the Talk to Bob card must not slide under the Dynamic Island. If a black band still appears, read `getComputedStyle(document.documentElement).getPropertyValue('--visual-viewport-offset-top')` vs `visualViewport.offsetTop`, and check `window.scrollY` (if iOS scrolled the document rather than panning, the offset var will be 0 and a `scrollTo(0,0)`/`pageTop` follow-up is the next lead).
3. Chat screen (composer, voice, attachments) unchanged by design — the follow-viewport class is Sessions-only. Spot-check composer focus still behaves as before.
4. Profile switch to `sales-test` + same search must show "No conversations match…" (server scoping confirmed via curl; UI confirmed in mock only).

## Follow-ups (not done here; need approvals)
- Backend: the title lane in `search_sessions` uses `list_sessions_rich(search_query=)` without `include_hidden`, so hidden rows only surface when message text matches. Today the canonical matches via content (rank 13 server-side; the client promotes exact title hits to the top). A server-side opt-in (e.g. include hidden in the title lane for the active profile) would make it robust, but needs a dashboard restart → separate approval.
- Deploy: candidate only. Promote with the project's normal deploy path after the iPhone checks; no commit/push was made.

## Steps
- [x] 1. Inventory backend resolver contract (see Step 1 results above).
- [x] 2. Inventory PWA (see Step 2 results above).
- [~] 3. iPhone screenshot: not located; working from the issue doc's description.
- [x] 4. Failing regressions written and seen RED (Step 4 checkpoint).
- [x] 5. Narrow fixes implemented; unit + e2e GREEN (Step 5 checkpoint).
- [x] 6. `build:candidate` → `dist-candidate/`; preview on 4180; 390px keyboard closed/open/panned QA (Step 6 checkpoint).
- [x] 7. Reported in PWA session `<session-id>` with evidence + iPhone checks (above).

## Decisions
- Issue 1 mechanism: client-only. Conversations search merges the profile-scoped server search (`/api/sessions/search`) into the loaded-row filter; the ordinary listing is never widened; opening a hit uses the existing by-id flow; pinning stays an explicit user action. Backend title-lane hidden-row gap noted as a follow-up needing a restart approval.
- Issue 2 mechanism, round 1 (superseded): shell follows `visualViewport.offsetTop` via `position: relative; top` on the Sessions screen only. Confirmed in-browser with a fake visualViewport; **failed on the physical iPhone** (owner: "overlap is still making search entry impossible").
- Issue 2 mechanism, round 2 (2026-11-21): stop sizing the Sessions-screen shell to the visual viewport at all. `.app-shell.layout-viewport-shell { height: 100dvh }` keeps the shell the full layout-viewport height, so every point iOS can pan to — whether it pans via `visualViewport.offsetTop` or via a document scroll, which is the unproven part — is still shell, never body background. The strip under the keyboard goes to `.session-list` as `padding-bottom: … + var(--keyboard-inset-bottom)` so the last rows can still be scrolled above the keyboard. Round 1 depended on a correct, timely `offsetTop`; round 2 holds under both pan mechanisms and needs no event timing. Chat screen untouched (still visual-viewport-sized for the composer; covered by a new e2e assertion).

## Round 2 checkpoint (2026-11-21, after the failed iPhone test)
- RED: `tests/e2e/search-keyboard-pan.spec.ts` rewritten for the layout-viewport model (shell height == layout height in every keyboard state, 0 px uncovered above/below for pan 0 / 200 / 336, `documentElement.scrollHeight == innerHeight` so iOS never gains extra scroll range, list padding ≥ keyboard inset, chat screen still visual-sized). Against the round-1 code: `Expected: 852 Received: 516` at `shellHeight`.
- GREEN: `src/styles.css` (`.layout-viewport-shell`, `.session-list` padding), `src/App.tsx:1446` class swap. Pan spec 3/3; full Playwright 88/88; `tsc -b` exit 0; vitest 26 files / 483 tests (after excluding `scripts/qa/**` and `dist-candidate/**` in `vitest.config.ts` — the Playwright QA spec was being collected by vitest and failing on `test.beforeAll`).
- Candidate: `npm run build:candidate` → `dist-candidate/` bundle `assets/index-B3ldY1ky.js`; live `dist/` unchanged (`assets/index-CD6aNzvS.js`, same mtime). Preview restarted on 127.0.0.1:4180 (the previous preview had died; tailnet `:8449` had no backend). `https://<tailnet-host>:8449/` → 200. `scripts/qa/candidate-search-qa.spec.ts` against 4180: 1/1; `metrics.json` shows shell 0–852 in every state, `uncoveredBelow/Above` 0 at pan 0/200/336, list padding 352 → 152 → 16 as the pan absorbs the keyboard, bundle `index-B3ldY1ky.js`. Screenshots `01`–`04` + new `03b-search-keyboard-panned-max.png` regenerated.
- Physical iOS (2026-11-22): owner retested on the iPhone via `:8449` (bundle `index-B3ldY1ky.js`) — "looks good." Issue 2 confirmed fixed on device. Owner approved promotion ("yes, promote it.") the same day: `dist/` backed up to `~/.hermes/backups/mobile-pwa-dist-<ts>/`, then `rsync -a --delete dist-candidate/ dist/`; live `:4179`/`:8447` now serve `index-B3ldY1ky.js`, no service restart. Committed on `main` as `79c2fd6` (not pushed).

## iOS Simulator as a QA resource (2026-11-22)
- Xcode (App Store) on Bob's House: `xcode-select`, license, first launch done (three approved `sudo` steps); `xcodebuild -downloadPlatform iOS` → iOS 27.2 Simulator runtime (24B91016s), 8.3 GB.
- Headless smoke test against live `:8447`: `xcrun simctl boot` + `openurl` + `io screenshot` on iPhone 17 (402 CSS px) and iPhone 17e (390 CSS px). Both render the Connect screen in real Safari with "Server reachable", no overflow; both shut down after capture. Captures were scratch-only (`$TMPDIR/sim-pwa-8447.png`, `sim-17e-8447.png`), not retained as evidence.
- Not exercised yet: Simulator GUI keyboard toggle (⌘K) and Web Inspector for live `visualViewport` numbers; headless `simctl` has no JS bridge, so keyboard-state QA still needs the GUI route or the physical iPhone.
- Recipe recorded in the `mobile-pwa-control-surfaces` skill, `references/ios-simulator-qa.md`.

## iPhone retest script (round 2, `:8449`)
1. Safari → `https://<tailnet-host>:8449/` (fresh load; the SW is network-only for navigations so no stale index).
2. Conversations → tap the search field → type `Bot chat` → keyboard up.
3. Drag up on the area between the search field and the keyboard, then on the results list. Expected: no flat black strip anywhere; the search field may move up with the page (native) but is never cut off; dragging down brings it back.
4. Scroll the results list to its end: last row clears the keyboard.
5. Open a chat → tap the composer: composer sits on the keyboard as before.

## Evidence
- `docs/research/evidence-2026-11-20-candidate-qa/backend-probes-2026-11-20.txt` (copied from scratch) — read-only backend probes (by-id, list, search, profile scoping, sqlite).
- `docs/research/evidence-2026-11-20-candidate-qa/` — candidate-bundle QA metrics + 4 screenshots (390×852, mock mode).
- Test files: `src/lib/sessionSearch.test.ts`, `tests/e2e/search-keyboard-pan.spec.ts`, `tests/e2e/search-hidden-session.spec.ts`, `scripts/qa/candidate-search-qa.spec.ts` (+ `scripts/qa/candidate.config.ts`).
