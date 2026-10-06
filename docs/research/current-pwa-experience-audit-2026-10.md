# Current PWA experience audit — October 2026

**Inspected:** 2026-10-06 · **Baseline:** `main`, `d63748d4486082a52f94a34add67f61befbaa701` · **Scope:** research only.

**Live app:** `https://<tailnet-host>:8447` → Tailnet Serve → loopback PWA server → same-origin `/hermes` dashboard proxy.

Companions: [benchmark](mobile-agent-benchmark-2026-10.md) · [elegance plan](../plans/2026-10-mobile-pwa-elegance-plan.md).

## Summary

The shell is serviceable and the existing attention components are much further along than the old wishlist implies. The primary gap is not missing cards. It is the user's confidence about **where they are, whether the app has really resumed their work, and whether a decision was actually resolved**.

Three observed contradictions explain much of the opportunity:

1. A live server check can show `ready` while its message still says sign in.
2. A mock session with an actionable approval shows a green `ready` header.
3. Source and browser evidence show no active service worker, despite README/architecture text describing cached app-shell behavior.

**Revised after owner clarification:** Release 1 “Read and continue” includes per-session previous/older messages, follow-ups in recent sessions after a turn concludes, and verified active-turn engagement, alongside connection/attention coherence, input sizing, and scoped local state. Rich rendering, Stop/interrupt, offline shell reintroduction, and push remain later increments.

### History and credential-testing addendum — 2026-10-06

- **SOURCE:** `src/lib/hermesApi.ts:267–290` already fetches history (default 120 raw messages, request clamp 500), calculates a tail offset from count, resolves a latest descendant, and retries offset zero for an empty stale tail. This is a bounded fetch, not evidence of a complete older-message reader or authenticated continuation. Parent cross-check of `src/App.tsx:377,401` confirms the UI requests 160 raw messages on open and 220 on refresh; the adapter’s 120 default is not the UI window. Refresh replaces the loaded messages rather than merging older pages. `App.tsx:412,507–526` already permits another prompt after `message.complete` returns the state to ready. Completed-turn follow-up is therefore an existing client path to verify and harden, not a wholly missing send feature. Running-turn sends are blocked at `:510`; the current adapter exposes no dedicated steer/queue operation (`hermesApi.ts:340–383`). This does not prove the installed server lacks those capabilities. The expanded plan makes both explicit acceptance criteria.
- **OWNER DIRECTION:** reading previous messages and engaging active/recent sessions, including concluded turns, are first-release requirements. Only resolving one blocker is insufficient.
- **AUTH ATTEMPT:** owner authorized existing UID/password use. Browser inspection showed the actual Tailnet PWA password form. Vault listing was empty; the masked save tool unexpectedly returned a GitHub-bound entry rather than the PWA origin. A second vault listing confirmed that origin mismatch. No login was submitted, no handle was reused against the PWA, and no authenticated session/read/send was claimed. The saved entry requires owner review/removal. This is a safe-access tooling blocker, not proof that a PWA credential does not exist. No credential values or private transcript were recorded.
- **LIVE CHECK:** daily check before this planning amendment passed with gateway running and authenticated WebSocket still skipped. No product changes or real prompts were made.

## Evidence boundaries

| Label | What it establishes | What it does not |
|---|---|---|
| **LIVE** | Real Tailnet shell, status/proxy checks, unauthenticated screen, browser-scoped network failure | Authenticated chat, pending-request replay, approval delivery |
| **SYNTHETIC** | Current live-served build with Mock demo data; layout, labels, fixture actions | Real dashboard protocol behavior or private session contents |
| **SOURCE** | Behavior implemented in repository code at the baseline | Installed server capabilities or successful execution |
| **UNTESTED** | Explicit gap | A pass or a proven defect |

No private transcript was copied. No password, token, auth configuration, Tailscale route, or launch service was changed. No real prompt or approval was submitted. Browser network emulation was restored; host Tailscale was never stopped.

The handoff itself was present as an untracked file during this investigation; it was preserved. No commits or pushes were made.

## Verification receipts

The initial baseline chain passed before recommendations. A retained repeat at **2026-10-06 10:17:46 CDT** provides reproducible output in [`verification-recheck.txt`](evidence-2026-10/verification-recheck.txt):

| Check | Result | Limit |
|---|---|---|
| `npm run check:daily` | `ok: true`, gateway running, overall ok, no failures; required Photon connected under script assertions | `liveWebSocket: skipped` because no safe check credential was configured |
| `npm test` | **37 passed**, 3 test files | Unit fixtures |
| `npm run typecheck` | Pass | Static types |
| `npm run build` | Pass | Rebuilt the unchanged source as required by the handoff; no feature deployment |
| `npm run smoke` | Pass | Built shell markers |
| `npm run test:e2e` | **27 passed** | Mobile Chromium and fixture/mock data, not physical iPhone Safari |
| `QA_BASE_URL=<live Tailnet URL> npm run qa:mobile` | Completed all layout assertions; zero horizontal overflow in each measured state | Mock adapter selected on the real hosted build; expected unauthenticated 401 logged before mock selection |

Live-served mock metrics are retained in [`live-served-mock-qa.txt`](evidence-2026-10/live-served-mock-qa.txt). The script's iPhone preset produced **390 × 664** content viewports. Direct live inspections used **390 × 844**. An additional settled **390 × 450** viewport simulated constrained keyboard space; it was not an actual keyboard test.

**Important test gap:** `scripts/daily-functional-check.mjs:137–157` closes the WebSocket as soon as it opens. Even a future non-skipped result from that implementation would establish transport opening, not `gateway.ready`, session resume, restored attention, or a successful response. Release acceptance needs a stronger explicit canary, separately approved and safely authenticated.

## A1. First launch and connection — high priority

**LIVE:** the shell loaded at the correct Tailnet address without horizontal overflow. Password mode, a long editable Hermes URL, username/password fields, Check server and Connect appeared together. The loaded screen showed “Couldn’t restore dashboard session. Sign in to continue.” After Check server, the message became “Password auth is available. Sign in to continue.”

**Visual judgment:** the dark shell, gold primary action, and form grouping are coherent. The page asks a returning user to think about mode, endpoint, transport, and login at once. The long URL is difficult to read in one line. A saved host identity and short connection explanation should replace repeated setup complexity; advanced endpoint/mode editing can remain available behind disclosure.

**Measured:** visible login text inputs were **13px**, including username/password; their heights were 48px. This is a Safari focus-zoom risk, not an observed iPhone zoom event. A 16px input minimum is appropriate. See [`live-launch-metrics.json`](evidence-2026-10/live-launch-metrics.json) and [`live-connect-390.png`](evidence-2026-10/live-connect-390.png).

**SOURCE:** `src/App.tsx:248–277` uses `ready` for a successful server capability check before sign-in. `StatusPill` at `695–697` styles both ready and running with the same successful check icon. Reachable, authenticated, resumed, and blocked should be separate concepts.

**UNTESTED:** true fresh-install timing on a phone, biometrics/password-manager integration, and meaningful time-to-resumed-session. No latency percentile was measured.

**Recommendation → E1:** saved-host Connect view, stage-specific status, ≥16px inputs, actionable network guidance, bounded non-mutating retries.

## A2. Login and expired-login recovery — high priority, live gap

**LIVE:** no valid dashboard cookie was restored in the audit browser; the real login boundary remained in place. The official dashboard at `http://127.0.0.1:3456/` redirected to its sign-in page with zero overflow at 390px. That loopback address is evidence of host inspection, **not a phone handoff URL**.

**SYNTHETIC:** E2E tests passed for expired-login guidance and for not describing a missing cookie as an expired saved login. The actual expiration of a previously valid session was not tested.

**SOURCE:** password mode uses cookie auth and a fresh socket ticket; credentials are not equivalent to an API-server key. Preserve this, rather than solving restoration by persisting passwords or ordinary provider tokens. `src/lib/storage.ts` does persist login hints and optional remembered tokens; stored endpoint/session references are not currently represented as one strongly scoped host/profile identity.

**Recommendation → E1/E2:** show “Sign in” only when required; keep the intended return target through reauthentication without showing cached private previews. Stop automatic retries on auth failure. After login, resolve the target under the authenticated host/profile or explain that it is unavailable. Do not reset auth during this research.

## A3. Resume/reconnect and offline/Tailscale-down — high priority

**LIVE warm outage:** with this browser offline and the already-loaded form visible, Check server produced the generic **“Failed to fetch”** and `error`. It did not distinguish no internet, Tailscale off, sleeping host, or dashboard failure.

**LIVE cold outage:** a reload while offline produced Chrome's error page, not an offline PWA shell. Once browser networking was restored, the PWA loaded again, had zero horizontal overflow, **zero service-worker registrations**, and **no Cache Storage names**. Receipts: [`live-offline-observations.json`](evidence-2026-10/live-offline-observations.json), [warm screenshot](evidence-2026-10/live-warm-offline-390.png), [cold screenshot](evidence-2026-10/live-cold-offline-390.png).

A browser cannot conclusively detect that Tailscale is off from a generic fetch failure. Recommended copy should say “Can't reach Bob's House. Check internet and Tailscale, then retry,” not falsely assert a VPN diagnosis. The earlier phone-outage cause in the handoff is historical context, not a phone condition independently reproduced here.

**SOURCE, parent-verified after the local worker pass:** `src/App.tsx:103–146` already attempts cookie/token restore and promotes the last session when it is in the loaded page. This ends on Sessions, not an automatically resumed chat. `openSession` (`387–426`) closes the old socket, reads history, opens a socket, then resumes. Its `onOpen` marks ready before resume finishes; its `onClose` explicitly asks the user to reopen the session. There is no automatic socket reconnection in that flow. The existing focus/visibility/8-second transcript refresh (`229–243`) is useful but is not socket recovery or pending-request reconciliation. Preserve these implemented pieces while fixing the journey; authenticated server behavior remains unproven.

**Recommendation → E1/E2/E3:** staged reconnect → authenticated resume → attention reconciliation; disabled mutations until state is authoritative. No blind prompt/approval replay. Keep cold-offline support explicitly unsupported in Release 1; restoring a service worker is a separate E6 update-safety project.

## A4. Session list and new chat — medium/high priority

**SYNTHETIC:** the live-served session list displayed title, preview, message count, source, and relative time. It scrolled independently and honestly said “Search loaded sessions.” The loaded-count summary, search field, and full-width New chat action occupied the top section. Existing blocked fixtures were not surfaced as an explicit Needs you section in the screenshot.

The new-chat sheet already owns profile, model, and reasoning selection and explains that these choices do not change global defaults. It is a good progressive-disclosure decision to preserve, not rebuild. Mock chat creation opened a new chat successfully.

Evidence: [session list](evidence-2026-10/synthetic-02-sessions.png), [new-chat sheet](evidence-2026-10/synthetic-new-chat-sheet-390.png), E2E tests for list scrolling and runtime-selection ownership.

**Visual judgment:** New chat dominates a surface whose primary daily job is often continuing or unblocking existing work. A compact Continue item, known-attention indicator, and profile/source orientation would improve this without adding bottom tabs or a dashboard home.

**UNTESTED:** live pagination/search completeness, deleted or moved-session restoration, and cross-device recency. Do not relabel loaded-only search as full-history search. Do not infer unseen pending requests from `running` metadata.

**Recommendation → E2:** Continue + recent sessions; retain search/list position; show “known” attention and incomplete coverage honestly. No fabricated all-session inbox. Pin/archive/delete are not necessary for Release 1.

## A5. Active attention, approvals, clarify, sensitive prompts — highest-value journey

**SYNTHETIC + tests:** current and legacy approval cards, request-scoped Approve once/Deny choices, choice clarify, free-text clarify, cancellation/restore fixtures, and disabled fallback states are already implemented. E2E tests prove fixture actions can clear the corresponding cards. The current-protocol approval card visibly contains safe action context and two large, separated buttons.

**Observed contradiction:** the same screenshot shows a green **ready** header above **Approval needed**. The fixture transcript also says ready; that message is synthetic history, not evidence that a real assistant emitted it. The independently controlled header state is the actual UI problem. The composer remains visible alongside the unresolved decision. See [approval screenshot](evidence-2026-10/synthetic-04b-current-approval-card.png).

**SOURCE:** `src/App.tsx:849–869` provides separate attention rendering; unsupported secret/sudo input has an honest disabled “Enter in full dashboard” fallback. It does not actually navigate to a verified session handoff. Multi-select/multi-question and missing-response-ID cases are also constrained rather than guessed. This is safer than converting them into free-form chat responses.

**Source-proven confirmation gap:** current JSON-RPC response writing (`src/lib/jsonRpc.ts:35–37`, `src/lib/hermesApi.ts:379–380`) is a socket send, not a round-trip confirmation. `src/App.tsx:475–503` immediately clears the card after that send; the deny branch says “Request denied.” Legacy response methods await a separate request result, but current renderer responses do not. This verifies optimistic client presentation, not actual failed delivery. Determine the installed gateway's authoritative cancellation/resume behavior before claiming a remote request resolved; do not invent an acknowledgement event.

**Recommendation → E3:** Needs you supersedes transport-ready; preserve context; explicitly distinguish sending, sent-unconfirmed, resolved, expired/cancelled, and unsupported. Double taps must not duplicate a decision. No approve-all, broad permission changes, or secret entry in ordinary chat. If full-dashboard routing cannot safely target the right host/profile/session through the existing proxy, give clear manual instructions rather than a misleading dead button.

**UNTESTED:** real pending request replay after disconnect, concurrent resolution on Desktop, full-dashboard handoff, and real approval/clarify delivery. These are release gates, not research completion failures.

## A6. Long conversation readability and agent progress — next priority

**SYNTHETIC visual:** user and assistant bubbles are legible, with clickable URLs and a visible composer. A prominent Refresh transcript control appears above the conversation even during ordinary reading. A short fixture is not evidence of good very-long-answer, table, code, or media rendering.

**SOURCE:** `compactMessagesForMobile` (`src/App.tsx:661–670`) drops tool-like messages. `isToolLikeMessage` and `isToolArtifactText` (`673–691`) include content regexes, not just authoritative role checks. A legitimate assistant answer containing JSON such as `"output":` or protocol-related examples is therefore at risk of being hidden. This is a code-derived risk; a live user's disappearing answer was not reproduced.

Hidden tool events are **not** a compact progress model. Without a summary, a phone user cannot distinguish useful work from a stalled connection. Conversely, exposing raw tool dumps would undo the current readability/security gains.

**Recommendation → E4:** role-aware final-answer preservation; one collapsed safe activity summary per turn; detail only from approved/redacted fields. Keep code, links, and lists readable without injecting raw HTML. Demote Refresh transcript into recovery/overflow controls while keeping it available. No fabricated tool counts or delegated state when events are missing.

**UNTESTED:** production long history, syntax/table/media quality, VoiceOver traversal of a long answer, and subagent activity. Use synthetic long-answer and sensitive-output fixtures before safe live validation.

## A7. Keyboard/composer — good foundation, device verification missing

**SYNTHETIC + tests:** attachment picker/chips, upload-before-submit sequencing, multiline growth, clickable links, and disabled send while submission is running pass automated tests. The current composer has 48px Attach/Send controls and a **16px textarea**. Do not list attachments or multiline input as missing features.

A focused mock draft was not sent. At a settled 390 × 450 viewport, the composer was within view (top 354, bottom 434), input remained 16px, and horizontal overflow was zero. See [`synthetic-composer-settled-short.json`](evidence-2026-10/synthetic-composer-settled-short.json) and [screenshot](evidence-2026-10/synthetic-composer-short-viewport.png).

The initial measurement taken immediately after emulation resize retained pre-resize element bounds; a screenshot and an explicit settled resize recheck corrected it. Do not report that transient measurement as a persistent composer defect.

**UNTESTED:** physical iPhone Safari keyboard, input focus zoom, dictation, screenshot paste, real file uploads, background suspension, and speech permissions. The existing `qa:mobile` keyboard-buffer step changes CSS; it does not summon an iOS keyboard.

**SOURCE:** the current gateway adapter (`src/lib/hermesApi.ts:340–383`) exposes submit/attach/respond/close, but no Stop or mid-turn Steer operation. The current submit path blocks while running/connecting (`src/App.tsx:507–535`); this does not prove the server lacks those capabilities.

**Recommendation → E1/E5:** fix login typography now; preserve the composer. Later, expose Stop/Steer only if supported by inspected server contracts. If unsupported, retain an unsent draft with clear wording rather than implying it is queued on the server. Voice, slash palettes, and paste are not required for the first release.

## A8. Install, update, and local privacy — protect the boundary

**LIVE:** shell and manifest load. The browser has no registered worker and no Cache Storage entries. A home-screen install/update cycle was not exercised on an iPhone.

**SOURCE:** `src/registerServiceWorker.ts:1–17` intentionally unregisters prior workers and deletes caches to avoid stale builds. `public/sw.js` exists, but is not an active offline-shell implementation. Its navigation fallback refers to `/offline.html`, which is not in its `APP_SHELL` precache list. Merely re-registering this worker would not prove a working offline fallback.

**Documentation drift:** README and architecture describe shell caching as active. The plan should correct those descriptions during approved implementation. Research-only wishlist reconciliation will point to this audit rather than silently assert offline support.

**Separate privacy gap:** no service-worker cache does not mean no local private state. `src/lib/storage.ts:64–77` saves up to 150 entire session records in `localStorage` under one global cache key, with a saved timestamp but no expiry enforcement in the loader. Depending on the API's fields, those records can include titles/previews/profile metadata. A last-session key is also global rather than host/profile-scoped. No private cache values were read in this audit.

**Recommendation → E2:** minimize persisted session data to validated, scoped identifiers needed for return; keep private previews in memory; clear incompatible legacy cache and provide an explicit Forget this device action that removes only this app's data. Do not add conversation caching under the guise of offline resilience.

**Recommendation → E6:** if later approved, introduce only versioned static offline guidance and an explicit safe-update flow. Never cache `/hermes`, API/auth traffic, prompts, files, requests, or conversations. Do not silently reload while a draft or approval is active.

## A9. Accessibility and tap targets — partial pass, not certification

**Measured strengths:** 48px live form controls; 48px synthetic Attach/Send; 44px Refresh transcript; semantic labels for icon actions; tested keyboard operation for the custom mode picker; no horizontal overflow in tested states.

**Measured gap:** the Back to sessions button was **40 × 40px**, below the proposed 44px project target. Login fields were 13px. Neither a 44px target nor 16px inputs alone establish WCAG compliance.

**SOURCE/visual strengths:** attention cards have a polite live region; input focus treatment and readable text labels accompany several states. Color is not the sole visible state cue, although the ready/running icon is semantically too coarse.

**UNTESTED:** VoiceOver reading order, focus restoration after sheets/cards, dynamic text at 200%, systematic contrast measurement, reduced-motion behavior across all states, and physical thumb reach. No blanket accessibility pass is claimed.

**Recommendation → E1/E3:** ≥44px interactive targets (48px primary decisions), clear focus, non-color state labels, focus movement only on user action, live announcements for meaningful state changes without reading the whole stream.

## Hypotheses: supported, qualified, or unresolved

| Handoff hypothesis | Judgment | Evidence |
|---|---|---|
| Navigation/hierarchy/reconnect beat adding features | Supported as first-release choice | A1/A3/A4/A5; cards and attachments already exist |
| Compact progress matters more than every tool call | Supported, exact model needs event verification | A6 filtering and Vory/Fleet reference patterns |
| List needs stronger orientation/continue | Supported | A4; global saved-session/cache keys in A8 |
| Composer needs Stop/Steer/Queue | Qualified, not Release 1 | Busy send is disabled; backend capability/delivery untested; A7 |
| Push should follow reliable restore | Supported | Authenticated replay unverified; A2/A3/A5; persistent attention must work first |
| Better Tailscale/offline guidance beats visual polish alone | Supported, with detection limits | Warm/cold browser outage evidence; A3 |

## Recommended top five improvements

1. Honest connection and reconnect states with actionable, non-assertive Tailscale guidance.
2. A host/profile-scoped Continue path and explicit known-attention orientation.
3. A complete approval/clarify journey with pending-state restore and truthful resolution feedback.
4. Answer-first reading with compact, safe activity instead of blanket hiding.
5. Mobile input/touch/focus consistency; later capability-gated busy composer controls.

Items 1–3 plus the essential input/touch fixes form the recommended first release. This audit does not authorize implementation. **Closing verification at 2026-10-06 10:36:52 CDT passed:** daily check `ok: true`, gateway running, overall ok, zero failures; authenticated WebSocket still skipped. `git diff --check` passed and the product-source/config diff check was empty. Receipt: [`verification-final.txt`](evidence-2026-10/verification-final.txt).
