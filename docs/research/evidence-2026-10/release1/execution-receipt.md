# Release 1 execution receipt

Orchestrator: Claude (claude-fable-5-1 via anthropic). Leaf worker: native Hermes delegation → local Ollama `qwen3.8:27b-mlx`, sequential, leaf-only, no fallback. Cost figures are not provided by the local route and are recorded as unknown.

| # | Task | Worker | Attempts | Duration | Outcome | Parent verification |
|---|---|---|---|---|---|---|
| T1 | `connectionState.ts` + tests (route gate) | qwen3.8:27b-mlx | 1 | 190 s, 9 API calls | 10 tests RED→GREEN, 47/47 suite, typecheck ok, only 2 files touched | Diff read in full; precedence matches spec; tests rerun by parent |
| T2a | `sessionHistoryPage` + normalizer ids | qwen3.8:27b-mlx | 1 | 273 s, 2 API calls | **Failed**: after reading both whole files (~48 KB) the model emitted prose instead of a tool call; harness treated it as final; no files changed | Confirmed via `git status` and grep (0 matches) |
| T2b | same, bounded line-range reads + patch-only edits | qwen3.8:27b-mlx | 1 (targeted correction) | 412 s, 9 API calls | 7 new tests RED→GREEN, 54/54 suite, typecheck ok | Diff read in full (`git diff -w`); logic matches spec; parent fixed a 3-space indentation drift the worker introduced in `sessionTranscript`/new method (whitespace only); suite rerun green |
| T3 | `history.ts` reducer + tests | qwen3.8:27b-mlx | 1 | 223 s, 8 API calls | 21 tests RED→GREEN, 75/75, typecheck ok | Read in full; semantics match spec; parent fixed 3-space indents on 6 lines |
| T4 | `storage.ts` v2 scope/migration/forget + tests | qwen3.8:27b-mlx | 1 | 1273 s, 21 API calls | 14 tests RED→GREEN, 89/89, typecheck ok | Read in full; no `localStorage.clear()`, scope checks correct; parent removed two now-unused constants |
| T5 | `attentionState.ts` reducer + tests | qwen3.8:27b-mlx | 1 | 491 s, 17 API calls | 24 tests RED→GREEN, 113/113, typecheck ok | Read in full; parent later extended reducer so cancel/expire during `submitting` resolves (synchronous gateway cancel) + 1 test |
| T6 | `JsonRpcError` + queue/steer adapter + tests | qwen3.8:27b-mlx | 1 | 761 s, 27 API calls | 6 tests RED→GREEN, 119/119; expected mockHermes typecheck gap reported verbatim | Diff read in full; parent fixed 2 drifted brace indents |
| T7 | `tests/e2e/read-and-continue.spec.ts` (12 tests) | qwen3.8:27b-mlx | 1 | 329 s, 17 API calls | 12/12, full suite 39/39 | Parent reread anchor test and reran full suite: 39 passed |
| — | **App.tsx integration, mock fixtures, CSS, QA-script wait fix, docs** | **orchestrator (claude-fable-5-1)** | — | — | typecheck/120 unit/39 E2E/qa:mobile green | **Routing exception, disclosed:** 49 KB interdependent component touching session-scoping, send-path and approval seams; the worker had already failed once at ~48 KB input. Not a silent reroute. |

Diagnosis for T2a: model/tool-compatibility under large input, not task ambiguity. Correction applied: explicit read ranges, patch-only edits, "keep calling tools until the final report" rule. No reroute to another provider or model.

## Gates (receipts in this folder)

- `baseline-gates.txt`: all baseline gates green at `d63748d` before edits (secret scan already flagged research docs).
- `candidate-gates.txt`, `final-gates.txt`: 120 unit, typecheck, `build:candidate`, smoke (candidate), 39 E2E, `qa:mobile` against `http://127.0.0.1:4180` (candidate preview), `git diff --check`, `check:daily` ok with `liveWebSocket: skipped`. Live `dist/` SHA-256 matches the pre-change snapshot at `~/.hermes/cache/pwa-release1/dist-live-baseline-d63748d/`.
- `scan:secrets` exits 1 only on pre-existing untracked research docs (Tailnet hostname / local user path patterns, not credentials). New Release 1 evidence files are redacted.
- Screenshots (synthetic mock data, 390 px): `qa-01-sessions.png`, `qa-02-running-queue-steer.png`, `qa-03-needs-you-approval.png`, `qa-04-long-history-after-load-older.png`.
- Storage inspection on the candidate (names/shapes only): `hermes-mobile-pwa.login-hint` (json: mode), `hermes-mobile-pwa.schema-version`; no Cache Storage, no service worker registrations.

## Authentication

Vault had one entry labelled for the PWA but bound to `https://github.com` (`vault_a587f12060c7`, identifier <owner-email>). Root cause: the shared local browser had ~90 tabs including a stale `github.com/login?...oauth` page; the vault binds to the daemon's current page, which was that tab. That tab was closed; the candidate preview was opened as the active page (origin `http://127.0.0.1:4180` verified) and a new save was requested; the owner declined the save in this session. No credential was typed, printed, or reused; no authenticated read/send was claimed.

## Authenticated live pass on the candidate (2026-10-06, afternoon)

Vault: stray entry removed by owner (`hermes vault rm`); new entry `vault_8ec53074af5b` bound to `http://127.0.0.1:4180` (candidate preview, proxied to the real dashboard). Password filled only by the vault tool; never printed. All tests ran in one clearly labelled, isolated session titled "PWA Release 1 harmless test" (profile `default`); no real working session was touched. No private transcript screenshots were captured.

| Journey step | Result |
|---|---|
| Login → session list | `Signed in`; 75 of 659 real conversations listed |
| Open test session → previous messages from REST → `Ready` after resume | ✅ |
| Follow-up after concluded turn (`OK-1` → `OK-2`), live stream, same session | ✅ Ready→Running→Ready observed |
| Running turn: **Queue** (`prompt.submit queued:true`) | ✅ `{status:"queued"}`, drained after turn → `PWA-R1-QUEUED-OK` |
| Running turn: **Steer** (`session.steer`) | ✅ accepted, applied mid-turn → `PWA-R1-LONG-DONE STEERED` |
| Clarify via server-request protocol, answered from card | ✅ `Needs you` overrides Running; locked → "sent; checking" → resolved → `PWA-R1-CLARIFY-Beta` |
| Approval card | ⚠️ not exercised live: host smart-approval auto-approved the harmless `rm -rf` on a scratch dir; a riskier command was not attempted. Same server-request path as clarify; `{choice}` contract verified in source and fixtures |
| Back → Continue row → reopen with all exchanges (incl. steer rows) | ✅; reference survives reload |
| Cross-surface: second viewer resumes the running session, steers, first viewer keeps streaming | ✅ `Running` from resume; `PWA-R1-XSURF-DONE SECONDVIEWER`; first viewer reached `Ready` via its own `message.complete` |
| Storage inspection (names/shapes only) | `login-hint`, `server-url`, `schema-version`, `continue.v2` (v, scope, sessionId, title, savedAt); no Cache Storage, no service worker |

### Defects found only by the live pass (all fixed, tests added, suite 130 unit / 39 E2E green)

1. Installed gateway nests event payloads under `payload` (`server.py:693–696`); baseline read top-level fields → streaming text empty. Mock fixtures were flat and masked it; mock now mirrors the nested shape.
2. `session.create` returns live `session_id` ≠ durable `stored_session_id`; the Continue reference was saved with the live handle and 404'd on reload. Both ids now kept explicit (`CreatedSession`, `ResumeResult.storedId`).
3. Gateway delivers approval/clarify/sudo/secret only to clients that sent `client.capabilities {server_requests:true}` (`methods_voice.py:442`); baseline never did → "undeliverable". Handshake added; unrenderable requests (sudo/secret/multi-select/no qid) are declined with 4404 so the agent does not stall on the phone.
4. Clarify server-request result contract is `{answers:{[qid]:answer}}` (`contracts/server_requests.py:46–50`); `{answer}` was read as cancel-all. Fixed.
5. Continue row was not refreshed after opening/creating a session within a visit. Fixed.

Final gate receipt after these fixes: `final-gates-after-live.txt` (130 unit, typecheck, candidate build/smoke, 39 E2E, qa:mobile on candidate, diff check, daily check ok; live `dist/` still matches the baseline snapshot).

## Deployment

- 2026-10-06 ~16:10 CDT: owner approved commit + deploy. Commit `7a97951`. `npm run build` wrote `dist/` (js `index-DEjKa0wb.js`); Tailnet URL confirmed serving it; `check:daily` ok; `qa:mobile` against the live URL passed; live Connect screen shows "Server reachable" and 16px inputs. Rollback: copy `~/.hermes/cache/pwa-release1/dist-live-baseline-d63748d/` back over `dist/`. Candidate/dev servers stopped.
- 2026-10-06 ~16:20 CDT: owner opened the deployed PWA on iPhone while already signed in and reported it "looks good" (restore to Sessions without re-login). Treated as an owner-observed smoke pass, not the full keyboard/zoom/background/Tailscale-toggle checklist; those remain open items for a later pass.
- Owner also confirmed "Load older messages" works on the iPhone against a real session.
