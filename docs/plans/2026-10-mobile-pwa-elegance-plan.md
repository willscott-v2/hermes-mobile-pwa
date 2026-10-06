# Hermes Mobile PWA Elegance Implementation Plan

> **For Hermes:** After Will explicitly approves implementation, load `subagent-driven-development` and `test-driven-development`; execute one bounded task at a time with source/protocol verification. This document is a proposal, not execution authority. Commits, deployment, credentials, and runtime changes remain separate approval boundaries.

**Goal:** Make the existing PWA a dependable way to read previous messages, engage active and recent Hermes sessions, and move work forward from a phone, including after a turn has concluded.

**Architecture:** Keep a thin React client using the existing same-origin `/hermes` REST/JSON-RPC adapter and authenticated dashboard. Execution remains on Bob's House, reachable only through the existing Tailnet boundary. UI state must reflect authenticated server evidence, not optimistic guesses or a new phone runtime.

**Tech stack:** React, TypeScript, Vite, current REST/WebSocket adapter, Vitest, Playwright; no new framework or UI library is required for Release 1.

**Date / baseline:** 2026-10-06 · `main` · `d63748d4486082a52f94a34add67f61befbaa701`.

**Status:** Research complete; implementation not approved. Authenticated WebSocket/restore behavior remains unverified.

---

## North star

**Open the right conversation, read its history, understand its live state, and move it forward with a follow-up, supported mid-turn input, or a blocker response.**

**Owner scope correction, 2026-10-06:** this is not an unblock-only client. Per-session previous messages and continuation of active/recent conversations are Release 1 requirements. A concluded turn is not a closed conversation. Existing UID/password use is authorized for testing via a correctly origin-bound masked flow; no product implementation or deployment is authorized by this correction.

## Evidence and scope

- [Benchmark](../research/mobile-agent-benchmark-2026-10.md): all six requested Hermes clients, official dashboard, Claude Code mobile/Remote Control, Linear, Gemini Live, and access-limited ChatGPT.
- [Live audit](../research/current-pwa-experience-audit-2026-10.md): observations A1–A9, source anchors, test receipts, live versus mock distinctions.
- [Retained verification](../research/evidence-2026-10/verification-recheck.txt): live shell/proxy/required-platform checks pass; 37 unit tests and 27 mobile E2E tests pass; authenticated WebSocket skipped.

The proposal is grounded in documented patterns and specific local weaknesses. It does not rank competitor execution quality from marketing. Targets below are **proposed acceptance criteria**, not achieved measurements.

## Seven design principles

1. **A remote, not another runtime.** Keep execution, policy, and authoritative session state on Hermes. No native app or backend fork.
2. **Truth before reassurance.** Reachable ≠ signed in ≠ resumed ≠ running ≠ complete. Unknown is not zero and sent is not confirmed.
3. **Continue before configure.** Prioritize a known conversation or decision; keep new-chat runtime choices in the existing sheet.
4. **One clear decision at a time.** Show scope and consequence, offer only supported request-scoped actions, and prevent accidental repetition.
5. **Answers first, activity available.** Preserve final output and collapse safe tool detail rather than hide arbitrary prose or dump internals.
6. **Private by default.** No private API/auth/chat service-worker caches; minimize other local storage too. Any later notification carries generic state only.
7. **Design for interruption.** Recover from phone suspension, login expiry, and connectivity loss without silently changing session or replaying mutations.

## Prioritization

These scores predate the owner's scope correction and are historical prioritization judgments, not new estimates for the expanded history/continuation scope. E2 and the minimal E5a active-engagement contract below are required regardless of these scores.

Scores use the contract's seven 1–5 dimensions. Higher is better; **Ease is reversed effort**. These are design judgments, not user analytics. Totals were calculated programmatically; dependency/security gates outrank the sum.

| Rank / opportunity | Frequency | Friction reduction | Remote unblocking | PWA feasibility | Ease | Security confidence | Testability | Total / 35 | User impact / effort / risk / dependency |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 · E1 Open/reconnect with certainty | 5 | 5 | 4 | 5 | 4 | 5 | 5 | **33** | High / M / low–medium / status and auth classification |
| 2 · E3 Resolve one blocker truthfully | 5 | 5 | 5 | 5 | 3 | 4 | 5 | **32** | Very high / M / medium–high / actual pending/response protocol |
| 3 · E2 Continue the right scoped conversation | 5 | 5 | 5 | 4 | 3 | 4 | 5 | **31** | High / M / medium / E1, identity and storage boundaries |
| 4 · E4 Readable answers + compact activity | 5 | 4 | 4 | 4 | 3 | 4 | 5 | **29** | High / M / medium / reliable roles and redacted events |
| 5 · E5 Explicit busy-state composer | 4 | 4 | 4 | 3 | 2 | 3 | 4 | **24** | Medium–high / M–L / medium–high / advertised stop/steer semantics |
| 6 · E6 Static offline guidance + safe updates | 3 | 4 | 2 | 4 | 2 | 4 | 5 | **24** | Medium / M / medium / versioned worker and update QA |
| 7 · E7 Generic re-engagement | 3 | 4 | 5 | 3 | 1 | 3 | 3 | **22** | Conditional high / L / high integration risk / E1–E3, E6 and trusted event delivery |

E1, E2, E3 ship together because they form a journey; ranking E3 above E2 does not remove E2's prerequisite. Effort is relative, not a calendar estimate. Protocol discovery can change estimates and must be reported before expanding scope.

### Recommendation-to-evidence map

| Opportunity | Observed local weakness | Benchmark pattern |
|---|---|---|
| E1 | A1–A3: ready-before-auth, 13px inputs, generic fetch errors | Claude continuity; Fleet truthful coverage; Cadu saved connection story |
| E2 | A4/A8: creation dominates, global last-session/cache keys, cached previews | Conduit return path; Linear focused attention; Fleet device-local Continue |
| E3 | A5: ready while blocked, unverified resolution, dead-end sensitive fallback | Vory phases; bighelp bounded choices; Fleet unsupported/unknown states |
| E4 | A6: blanket tool-like filtering, no summary, prominent manual refresh | Conduit rich reading; Vory collapsed reasoning/tool cards |
| E5 | A7: send protection exists but busy control semantics limited/untested | Claude steering and local-only boundaries; Gemini explicit interruption |
| E6 | A3/A8: cold offline fails, worker intentionally disabled, docs drift | Hermex's explicit sending-versus-offline boundary; **not** its private cache architecture |
| E7 | A2/A3/A5: no proven end-to-end return/resolve path yet | Linear inbox independent of external delivery; Claude notifications into existing sessions |

## Now — recommended Release 1: “Read and continue”

### Intended journey

```text
Open saved Bob's House connection
  → Reaching host / Sign in if required / Restoring conversation
  → Open an active or recent session, with correct host + profile
  → Read previous messages; load older messages when needed
  → Verify live state: running / needs you / ready for follow-up / unavailable
  → Send a follow-up after a concluded turn, use supported mid-turn input, or answer a blocker
  → Sending → accepted / continued / sent-unconfirmed / unavailable
  → Return to same list position or leave
```

Use the existing screens: Connect → Sessions → Chat. Do not add a Home dashboard or bottom navigation. Keep configuration behind the existing new-chat sheet. A compact host/profile identity control can expand into connection details; do not put long URLs or cost counters permanently into the main header.

**Release boundary:** E1–E3 including explicit per-session history and concluded-turn follow-up, plus E5a minimal active-session engagement, essential typography/touch/focus fixes, scoped storage migration, and validation/documentation. **Not included:** new service worker, offline transcript cache, push, tool-detail viewer, Stop/interrupt controls, voice, slash palette, Kanban, or broad session administration. Mid-turn steering/queue semantics must be discovered, not invented; an unsupported capability is an approval gate, not permission to silently drop active engagement.

### E1. Honest connection and recoverable setup

**Change:** separate reachability, auth, socket, resume, and task state. A returning user sees a recognizable saved host and primary Connect/Retry action, with URL/mode editing in Advanced. Keep existing password-cookie/ticket auth unchanged.

**Likely files:**
- Modify `src/App.tsx` (connect view, status presentation, focus/return flow).
- Modify `src/styles.css` (form typography, targets, status hierarchy).
- Modify `src/lib/hermesApi.ts` (typed failure classification without raw response leakage).
- Create `src/lib/connectionState.ts` and `src/lib/connectionState.test.ts` (pure UI-state mapping).
- Extend `src/lib/hermesApi.test.ts`, `tests/e2e/mobile-layout.spec.ts`, and `scripts/mobile-ux-qa.mjs`.

**Acceptance:**
1. A successful `/api/status` probe reads “Server reachable,” never implies authenticated chat. “Ready” appears only after the selected session is resumed and there is no known blocker.
2. Distinguish checking, unreachable, sign-in required, restoring, connected, and connection lost with text. Show host/profile identity only from validated configuration/server data; model/workspace may say unknown rather than default misleadingly.
3. A timeout or failed fetch offers Retry and honest internet/Tailscale/host guidance. The UI must not claim it has detected Tailscale's state.
4. Read-only reconnection is bounded: one active attempt, cancellable on user navigation, finite timeout, no tight background loop. Foregrounding can retry reachability/resume; auth failure stops retries and asks for sign-in. Do not retry prompts or decisions automatically.
5. Login and clarify text inputs have computed font size ≥16px at mobile widths. Interactive targets are ≥44px; primary decision/send targets ≥48px. Text remains readable at 200% zoom without page-wide overflow.
6. Focused fields remain reachable in a short viewport. Physical iPhone Safari keyboard/zoom must be checked before acceptance, not inferred from Chromium metrics.
7. The same `/hermes` proxy, password auth, cookies, ticket flow, and Tailnet URL remain unchanged. No tokens/passwords enter logs or screenshots.

### E2. Read previous messages and continue the right conversation

**Change:** make active and recent conversations easy to reopen, read, and continue, whether blocked, running, or between turns. Load previous messages for the selected conversation and expose older-message retrieval explicitly. Preserve list position/search when returning. Scope saved references to the validated dashboard origin/base path and profile. Keep previews/transcripts in memory.

**Existing source behavior, not new work:** `src/lib/hermesApi.ts:267–290` already fetches a transcript, defaults to 120 raw messages, clamps requests at 500, and calculates an offset from message count; it resolves a latest descendant first. This is not proof of a complete scrollback reader or authenticated continuation. Parent cross-check of `src/App.tsx:377,401` confirms the UI requests 160 raw messages on open and 220 on refresh; the adapter’s 120 default is not the UI window. Refresh replaces the loaded messages rather than merging older pages. `App.tsx:412,507–526` already permits another prompt after `message.complete` returns the state to ready. Completed-turn follow-up is therefore an existing client path to verify and harden, not a wholly missing send feature. Running-turn sends are blocked at `:510`; the current adapter exposes no dedicated steer/queue operation (`hermesApi.ts:340–383`). This does not prove the installed server lacks those capabilities. Preserve this foundation; expose availability and gaps honestly.

**Likely files:**
- Modify `src/App.tsx` (Continue section, restoration target, list position).
- Modify `src/lib/storage.ts`; create `src/lib/storage.test.ts`.
- Modify `src/styles.css` and `tests/e2e/mobile-layout.spec.ts`.
- Modify `src/lib/hermesApi.ts` only if verified metadata is needed; add tests in `src/lib/hermesApi.test.ts`.

**Acceptance:**
1. With a valid session and healthy authenticated connection, returning from Sessions to the last conversation requires one deliberate tap and no repeated runtime configuration.
2. Profile/source is visible where it prevents confusion. Same display names on different profiles/hosts never merge. New chat keeps the existing scoped profile/model/reasoning sheet; global defaults are not changed.
3. Continue stores only a minimal validated reference, not a transcript, prompt, command, or preview. Host/profile changes cannot display the old context or send to the old session.
4. Legacy global session cache is invalidated, not blindly rehydrated under the current host. The migration is versioned and one-way; a corrupt record fails safely. Mock references never become real continuation targets.
5. Before authenticated restore, no private cached session previews are shown. An explicit Forget this device action clears **only this app's** local references, hints, and optional remembered token; it does not claim to revoke the server cookie unless verified logout does that separately.
6. If a session is deleted, inaccessible, or belongs to another scope, say so and return to recents; never silently create a replacement session or send the held draft elsewhere.
7. Known blocked state may be shown only when obtained from actual events/snapshots. If the API does not expose a global inbox, label coverage “Known attention” or “Not checked”; never say “No tasks need you” based only on an uninspected list.
8. Search keeps “loaded sessions” wording until an actual full-history search API is verified. Back restores the prior list position and search.

9. Opening an active or recent session loads its available previous user/assistant messages, in order, without requiring a new prompt. Show loading, failure/retry, genuinely empty, and partial-history states distinctly; do not present failed history as an empty conversation.
10. If earlier messages exist, provide Load older (or equivalent bounded backward paging) against verified API semantics. Prepending preserves the reading anchor; refresh/live events do not erase older loaded pages, duplicate messages, or pull the reader to the bottom. Mark the true beginning only from authoritative pagination evidence. Do not promise data the backend no longer retains.
11. Keep selected history identity and live continuation identity explicit when compression/resume creates descendants. Do not silently substitute a descendant-only tail for the complete selected conversation. Verify lineage support; explain unavailable earlier segments and scope boundaries without mixing unrelated sessions.
12. A concluded turn remains open for follow-up: the user can submit new instructions/context in the same logical conversation, see acceptance and the next answer, and reopen it with that exchange present. Never create an unrelated new chat as an invisible fallback.
13. Switching sessions during fetch/resume/send cannot merge histories or deliver to the wrong host/profile/session. No automatic replay after ambiguous sends; preserve an explicitly unsent draft without suggesting it was queued.

**Dependency decision:** a restored blocker alone is insufficient. Release 1 must demonstrate history reading and continued dialogue after a completed turn as well as blocker handling. A global attention inbox is not promised; full-history search is separate from per-session scrollback.

### E3. Resolve one blocker with truthful state

**Change:** reuse the existing approval/clarify components and current/legacy protocol support. Bring attention into the header/state model, reconcile on resume, and make uncertain delivery explicit.

**Likely files:**
- Modify `src/App.tsx` (`AttentionCard`, event callbacks, response feedback and composer gating).
- Modify `src/lib/hermesApi.ts` and `src/lib/jsonRpc.ts` **only after checking the installed server's event/response contract**.
- Create `src/lib/attentionState.ts` and `src/lib/attentionState.test.ts`.
- Extend `src/lib/hermesApi.test.ts`, `src/lib/jsonRpc.test.ts`, `tests/e2e/mobile-layout.spec.ts`, `scripts/mobile-ux-qa.mjs`.
- Extend `scripts/daily-functional-check.mjs` for stronger **read-only** readiness/resume verification when safely configured; do not automatically execute approvals in a nightly check.

**Acceptance:**
1. Pending attention overrides ready/running presentation. A blocked session reads Needs you, retains its context, and shows only actions allowed by the active request.
2. Legacy snapshots and current `open_requests`/renderer requests still work. Missing IDs, malformed frames, multi-question/multi-select limitations, and secret/sudo requests retain fail-closed behavior. `running` alone never fabricates a prompt.
3. Approve once/Deny remain request-scoped. No always-approve, approve-all, bulk approval, default approval focus, or hidden permission-policy change. Consequence/context appears immediately above actions; make details expandable if long.
4. A tap disables both response actions while submitting. Duplicate taps, duplicate frames, delayed results from a previous session, and requests cancelled on another surface cannot produce duplicate/incorrect responses.
5. **Sending is not resolved.** Inspect actual cancellation/response/resume behavior. If the protocol has no acknowledgement for the response frame, show “Response sent; checking status,” and then authoritative resolved/continued state or “Could not confirm.” Never add an imaginary acknowledgement RPC/event.
6. On reconnect, reauthenticate if needed, resume the exact session, reconcile unresolved requests, and reject stale handles before enabling mutations. Do not blindly retry an approval after uncertain delivery.
7. Current approval or supported clarify can be resolved without composing a new chat prompt; the card reflects cancellation/resolution, and the next agent state is visible. With a known blocker active, ordinary send must not look like an alternative way to answer it.
8. Unsupported sensitive flows have clear manual instructions, not a disabled button that appears to be navigation. Add an active full-dashboard handoff **only if** the exact host/profile/session route works through the existing trusted same-origin surface. No loopback URL on the phone, raw secret, or token-bearing deep link.
9. Focus returns predictably after a decision; screen readers hear a short state change. No auto-scroll yanks the user away from context while reviewing a risky action.

**Stop gate:** if the installed gateway cannot safely reconstruct or confirm a request, report the exact gap. A client-only honest fallback may ship, but do not advertise that unsupported task as remotely resolved. Backend changes require a separate proposal and approval.

### E5a. Minimal engagement with an actively running session — Release 1

**Change:** let the user move running work forward through a verified gateway-supported mid-turn input mode (steer or queue), distinctly labeled from an ordinary follow-up after completion. Reuse the existing composer and attachment path; do not invent RPC methods.

**Likely files:** `src/App.tsx`, `src/lib/hermesApi.ts`, `src/lib/hermesApi.test.ts`, `src/styles.css`, `tests/e2e/mobile-layout.spec.ts`; protocol tests only where the installed contract requires them.

**Acceptance:**
1. Discover the installed gateway’s active-turn capability and concurrency/ownership semantics before implementation. A running session on another surface must not spawn a competing agent, silently fork, or restart the task.
2. If supported, label and test the actual action (Steer or Queue), target the exact live session, show acceptance separately from execution, and reconcile after a reconnect without duplicate delivery. Queue and steer are not synonyms.
3. If unsupported, show that limitation and retain a clearly unsent draft for explicit submission once idle. This fallback does **not** satisfy the full active-engagement requirement: return to Will with the protocol gap for an explicit release-scope or separately approved backend decision.
4. Blocker responses remain distinct from ordinary messages; never bypass approval or treat a follow-up as approval. Stop/interrupt controls remain deferred.

### Release 1 proof and shipment criteria

All must be satisfied before calling the release complete:

- [ ] Fail-first unit tests for auth/reachability/resume states, scoped storage migration, and response reconciliation.
- [ ] All existing tests still pass; added regressions cover missing/expired auth, wrong host/profile, stale response, cancellation, duplicate tap, and uncertain delivery.
- [ ] At 390px and a short viewport: no horizontal overflow, attention does not intersect composer, all primary targets fit, state is legible, long action text is reviewable.
- [ ] One physical iPhone Safari pass, both tab and home-screen launch: keyboard open/closed, focus zoom, back/foreground return, and Tailnet reachability recovery. Do not shut down host Tailscale.
- [ ] With Will-approved masked authentication and a deliberately harmless test session, verify **login → socket ready → exact session resume → pending decision → one answer → observed resolved/continued state**. No real risky operation is approved just to test the UI.
- [ ] In a harmless test conversation, verify open → previous messages → older page → stable reading position → concluded-turn follow-up → observed next reply → reopen with exchange retained. Test a session beyond the first loaded list page and a supported parent/descendant chain.
- [ ] Verify active-turn engagement against the installed gateway, including work started on another surface, exact-session targeting and no competing runtime. Unsupported mid-turn input blocks claiming this acceptance criterion; obtain an explicit scope decision.
- [ ] Separately verify that a blocker resolved on Desktop does not remain actionable after mobile reconciliation.
- [ ] Inspect Cache Storage and localStorage keys/shapes without printing values; confirm no private previews/transcripts or secret material persisted by the new path.
- [ ] `npm run check:daily` passes before and after approved deployment, retaining the distinction between status/transport and the controlled canary.
- [ ] Rollback path below is prepared. Will approves deployment separately from code completion.

If safe credentials or the physical phone pass are unavailable, report **implementation tested in fixtures, release acceptance pending**. Do not label that a verified production release.

## Execution model: cheaper workers, premium orchestration and QA

**Owner direction:** default execution to cheaper models wherever applicable. Reserve **Astra/Fable for orchestration, design/security judgment, exception diagnosis, and independent QA**, not routine implementation or repeated test-running loops. This is a project execution policy, not authorization to change model routing now.

| Work | Default owner | Required evidence / gate |
|---|---|---|
| Task decomposition, acceptance criteria, dependency and approval decisions | Astra/Fable orchestrator | Bounded task packet; no expansion of approved scope |
| Source inventory, fixture extraction, documentation reconciliation | Configured cheaper worker | Exact source anchors; no private transcripts or credentials |
| Pure state reducers, scoped storage migration, CSS/UI changes, test additions | Configured cheaper coding worker | Narrow file allowlist, failing test first, diff, commands and actual results |
| Builds, deterministic tests, link/count/format checks | Scripts/tools; cheaper worker only where interpretation is needed | Exit codes and retained receipts, not model-generated pass claims |
| First-pass review of a bounded diff | Cheaper worker where suitable | Concrete findings against frozen acceptance criteria; cannot certify its own implementation |
| Protocol/auth/storage/approval risk review; release-level mobile visual and semantic QA | Astra/Fable independent reviewer | Inspect actual diff, test evidence, screenshots, and controlled live results |
| Credential handling, approval-sensitive live actions, deployment decision | Primary orchestrator with Will's required approval | Never delegate secrets or treat implementation approval as deployment authority |

### Routing and escalation rules

1. Verify the execution session's actual available worker route and tool compatibility before assigning code work. Do not invent cheaper model identifiers or assume this research session's route remains configured. Use native Hermes delegation, leaf-only and sequential under the current policy.
2. Give the worker one bounded task: relevant sources, allowed files, constraints, acceptance tests, and exact evidence to return. Avoid repeatedly sending the whole research corpus or using a premium model to redo the worker's routine work.
3. Run a small representative code/test task before larger assignments. Gate on tool correctness, scope discipline, a real failing-then-passing test, and a reviewable diff, not a self-reported success.
4. On failure, diagnose whether the problem is model/tool compatibility, task ambiguity, or code quality. Permit one targeted cheaper-worker correction when appropriate; then stop and report the exception if the gate still fails. **No silent reroute to Astra/Fable, another provider, or a CLI subprocess for bulk execution.** Any alternate execution route requires an explicit decision within the applicable approval boundaries.
5. Batch premium review at coherent checkpoints: connection state, storage/return, attention protocol, then final release QA. Review security-sensitive boundaries before integration; do not economize by skipping those gates or by asking the implementer to certify itself.
6. Record worker/model identity, assigned task, attempts, elapsed time, actual usage/cost when provided, test results, reviewer findings, and disposition in an execution receipt. Unknown cost stays unknown; do not fabricate savings.
7. No model-policy change alters the research-only boundary. Product work starts only after Will approves the proposed release, and runtime/provider configuration changes remain separately gated.

## TDD execution sequence for Now

These are ordered, small work units for cheaper execution workers under the policy above; do not replace them with a large premium-model visual rewrite. Each regression starts RED, gets the smallest implementation, then goes GREEN before refactoring.

### Task 0 — establish evidence and preserve the baseline

1. Read the handoff, this plan, the audit, and the latest protocol source/docs. Re-run `git status --short --branch` and `git log --oneline -8`.
2. Run the baseline command block below. Record skipped auth separately.
3. Inspect the installed gateway's pending snapshot and response/cancellation shapes read-only; create synthetic fixtures from schemas, never private transcript dumps.
4. Document supported and unsupported cases. Do not begin response-path changes until the contract is known.

### Task 1 — connection vocabulary and essential mobile sizing

1. Add one reducer test per state in `src/lib/connectionState.test.ts`: reachable-but-signed-out, authenticated-but-not-resumed, resumed-idle, reconnecting, auth-expired. Run that file and see it fail for the intended missing behavior.
2. Add the pure state mapping in `src/lib/connectionState.ts`; rerun the tests.
3. Add E2E assertions that a successful status probe does not render chat-ready and all login inputs compute to ≥16px; run and observe failure against the baseline.
4. Wire the smallest App/CSS change; rerun targeted tests, then all existing tests.
5. Add/verify meaningful status labels and error retry behavior; capture narrow screenshots. No service/auth changes.

### Task 2 — scoped return and migration

1. Add `src/lib/storage.test.ts` cases for scope mismatch, corrupt records, old cache removal, mock/live isolation, and absence of private fields in serialized data. Verify failure.
2. Implement a minimal versioned reference store; no private session record persistence. Verify pass.
3. Add E2E cases for Continue, missing-session fallback, and Back restoring search/scroll. Verify failure.
4. Implement the smallest Sessions/Chat transition changes. Verify pass; check the existing new-chat sheet is unchanged functionally.
5. Add Forget this device and verify only app-owned keys are cleared.

### Task 2b — history and ongoing conversation

1. Inspect installed history pagination, lineage, resume ownership, prompt acceptance, and active-turn input contracts; record verified versus unsupported behavior. No secret or private-transcript fixtures.
2. Add failing API/state tests for backward pages, missing history, stale counts, duplicate frames, descendant mapping, and out-of-order cross-session results. Add mobile tests for prepend anchor stability and refresh retaining loaded history.
3. Implement only the verified client history/identity behavior; pass targeted tests before integration.
4. Add failing tests for follow-up after completed turn and for verified running-turn input semantics; then minimal composer integration. Reject competing runtimes, silent forks, and automatic resend.
5. Use a harmless approved test conversation to verify read/continue/reopen and live running-session engagement. If the server cannot support the latter, report the gate rather than claiming completion with an unsent draft.

### Task 3 — attention state and response certainty

1. Add pure `attentionState.test.ts` cases for waiting, submitting, sent-unconfirmed, authoritative resolved/cancelled, disconnected, and unsupported.
2. Add exact current/legacy protocol fixtures to existing API/RPC tests. Assert one correlated response, no cross-session response, no duplicate tap, and no secret rendering. Observe RED before changing response logic.
3. Implement minimal state integration and retain existing unsupported fallbacks. Do not add unverified RPCs.
4. Add E2E assertions that pending attention never has a ready header, normal send is not a substitute for a decision, and failure/cancellation remains understandable. Verify GREEN.
5. Validate long command/question layout and screen-reader announcements without exposing raw frames. Capture screenshots with synthetic values only.

### Task 4 — acceptance, docs, and approval gate

1. Strengthen the read-only checker to distinguish transport-open, gateway-ready, and resumed when a safe credential/session is explicitly configured. Missing credentials must remain an honest skip.
2. Run the controlled harmless canary only with approval and masked credential handling. Never store a password in shell history or fixture/config files.
3. Update `README.md`, `docs/ARCHITECTURE.md`, `docs/FEATURE_WISHLIST.md`, and `docs/AUTH_SETUP.md` to describe the actual state and supported setup. Do not change runtime config as a documentation shortcut.
4. Run all verification commands; inspect mobile screenshots; do physical-phone QA.
5. Present code/test/remaining-gap results. Obtain approval before commit/push/deploy if not already explicitly granted.

### Exact command gates

Run from `~/clawd/projects/hermes-mobile-pwa`:

```bash
npm run check:daily
npm test
npm run typecheck
npm run build
npm run smoke
npm run test:e2e
QA_BASE_URL=https://<tailnet-host>:8447 npm run qa:mobile
npm run scan:secrets
git diff --check
```

Use the live Tailnet URL for hosted-build QA after approved deployment. Before deployment, also run the same fixtures against the candidate preview, clearly labeled; the unchanged live URL cannot prove newly edited source. Expected results are zero unexpected failures and no layout assertions; auth remains separately reported. Do not pipe away exit codes.

## Next — E4 and remaining E5 polish, independently approvable

### E4. Answer-first reader and compact activity

**Files:** modify `src/App.tsx`, `src/lib/mobileText.ts`, `src/lib/mobileText.test.ts`, `src/lib/hermesApi.ts`, `src/lib/hermesApi.test.ts`, `src/styles.css`, `tests/e2e/mobile-layout.spec.ts`; create `src/lib/activitySummary.ts` and `src/lib/activitySummary.test.ts` if a separate reducer is justified.

**Acceptance:**
- A legitimate final answer containing JSON keys such as `output` or `method`, code fences, or protocol examples is not hidden because it resembles tool output.
- Safe roles/event types, not arbitrary string patterns alone, determine activity grouping. Raw untrusted wrappers/secret-bearing event payloads remain out of the default transcript.
- Each active turn has a compact factual summary; counts/state are derived from observed events and unknown coverage is labeled. Expand only allowed/redacted details. No invented elapsed times, completion, or delegated counts.
- Long lists/code/links remain readable at 390px; code may scroll within its block without causing page overflow. Final output dominates; Refresh transcript moves to secondary recovery controls.
- Test XSS/link schemes, very long unbroken content, sensitive output, disconnect mid-tool, and legitimate protocol explanations before implementation. Prefer existing safe rendering; any Markdown dependency/sanitizer requires review rather than being added reflexively.
- Verify fixture screenshots and then harmless live reading with permission. No private transcript screenshots in public artifacts.

### E5. Remaining busy composer controls

Minimal active-session engagement is already a Release 1 requirement under E5a. This later phase covers Stop/interrupt and broader composer polish; it does not defer ordinary follow-ups or all mid-turn engagement.

**Files:** modify `src/App.tsx`, `src/lib/hermesApi.ts`, `src/lib/hermesApi.test.ts`, `src/styles.css`, `tests/e2e/mobile-layout.spec.ts`; only touch `src/lib/jsonRpc.ts`/tests if verified protocol semantics require it.

**Acceptance:**
- Separate uploading, submitting, accepted/running, failed, and unsent-draft states. Preserve existing file-picker/chips/upload-before-submit behavior.
- Stop/Steer appears only when an inspected gateway capability supports it; tests assert the exact method/shape and scope. Unsupported means a clear unavailable state, not a no-op button.
- Draft text during a running turn remains an **unsent draft**, not a claimed server queue. No automatic resubmit after uncertain send, reconnect, or approval.
- Test double-send prevention, upload failure, unsupported capability, connection loss, session switch, cancellation failure, and preservation of the current draft.
- Physical iPhone keyboard and assistive-input behavior pass. Dictation/paste/voice are separate enhancements, not hidden expansion of this task.

## Later — platform work, not a native conversion

### E6. Static offline guidance and safe updates

**Files:** modify `src/registerServiceWorker.ts`, `public/sw.js`, `public/manifest.webmanifest`, `src/App.tsx`, `scripts/smoke.mjs`, `README.md`, `docs/ARCHITECTURE.md`; create `public/offline.html` and `tests/e2e/service-worker.spec.ts`.

**Acceptance:**
- Cold offline launch shows static connection guidance, not cached private conversations. Warm offline shows stale/disconnected state and blocks mutations.
- Versioned allowlisted static assets only. Exact `/hermes` and descendants, `/api`, `/auth`, WebSocket/ticket paths, cross-origin requests, non-GET requests, private uploads, and unknown dynamic routes bypass caching. Test representative content-leak attempts and Cache Storage contents.
- Updates never reload a draft or active decision silently; user-triggered activation preserves or explicitly warns about unsent in-memory work without persisting secrets.
- New/old worker transitions and rollback are tested; no origin-wide deletion of unrelated caches. Verify installed iPhone behavior, not just manifest presence.
- This is a fresh design with regression tests, **not simply re-registering the currently dormant worker**.

### E7. Generic re-engagement into the exact session

**Files likely in this repo:** create `docs/NOTIFICATIONS_DESIGN.md`, `src/lib/notifications.ts`, `src/lib/notifications.test.ts`, `tests/e2e/notifications.spec.ts`; modify `src/App.tsx`, `src/registerServiceWorker.ts`, `public/sw.js`, `scripts/mobile-ux-qa.mjs` only after the design is approved. Any required Hermes-side sender/plugin path must be discovered and separately approved; no server component is invented here.

**Acceptance before implementation approval:**
- Show a feasible supported installed-PWA/browser flow on Will's phone; document permission, background suspension, delivery provider, privacy, and failure behavior. No assumption of perpetual background WebSocket operation.
- Notifications contain only generic state, e.g. “Hermes needs your attention,” and an opaque routing locator if required. No prompts, session titles, profile names, commands, file names/content, tool output, or secrets. Fetch private details only after authenticated return.
- No public Tailnet exposure, inbound tunnel, or silent relay adoption. Any outbound browser-push service is explicitly reviewed; if the private-network/security contract cannot be met, defer the feature.
- Tap routes to the exact authorized host/profile/session after auth; offline and expired-login return paths are tested. Notification action buttons do not approve work from the lock screen.
- Deduplication/cancelled requests/permission denial/revocation are tested. In-app attention remains useful when notification delivery is unavailable.

## Explicit non-goals and deferred backlog

- No native app, CarPlay, Watch/Live Activities/Dynamic Island work, App Store/TestFlight distribution, phone runtime, or deep phone control.
- No cloud relay or backend replacement; no public exposure of the Tailnet service.
- No desktop parity: multi-gateway fleets, group orchestration, Kanban, API keys, config editing, plugins/MCP/skill management, or runtime restart controls.
- No approve-all/always-approve, expanded secret/sudo entry, or token-in-URL convenience.
- No private transcript cache, analytics, or content-bearing notifications.
- No avatar system, decorative motion program, redesign of brand assets, or new UI framework.
- No immediate pin/archive/delete, slash palette, context/cost pill, screenshot paste, rich media playback, or voice project. Reconsider only against observed usage after Read and continue; current file attachment support stays intact.

## Migration and rollback

1. **Before approved implementation:** preserve the baseline and working tree; do not commit another person's untracked handoff or evidence automatically. No destructive Git reset/clean.
2. **Storage:** introduce a versioned, host/base-path/profile-scoped reference schema. Discard the old preview cache; losing a convenience reference is acceptable, copying a private preview across scope is not. Existing passwords/cookies are not migrated or exposed. Explicitly clear legacy optional remembered tokens only according to the user's chosen Forget action or a separately reviewed policy.
3. **Release 1:** no service-worker/auth/route/LaunchAgent migration. Build changes are client-only. Retain a known-good build/commit artifact; rollback means restoring that approved artifact and verifying the existing URL, not changing the network boundary.
4. **Rollback caveat:** the old client can recreate its old unscoped cache behavior. Document that privacy regression and avoid treating storage rollback as lossless. Do not restore a deleted private cache as part of recovery.
5. **Later worker release:** stage a versioned static-only worker; retain a tested unregister/update recovery and never wipe unrelated origin data. Both upgrade and downgrade must be exercised on the phone before enabling it widely.
6. **After any deployment/rollback:** rerun daily check, hosted mobile QA, cookie/ticket/restore checks when safely available, and inspect exact routes. A green build is not live verification.

## Approval requested

Approve **Release 1: Read and continue (E1–E3 plus E5a)** only. It covers opening active/recent sessions, reading previous and older messages, sending follow-ups after concluded turns, verified active-turn engagement, and truthful approval/clarify resolution. It includes storage and mobile-accessibility safeguards and keeps native/platform expansion out of scope. Unsupported gateway capabilities require an explicit decision, not silent removal of the owner’s requirement.

Approval to implement this client release does not itself authorize credential changes, dangerous live approvals, backend changes, commits/pushes, or production deployment. If a protocol gap blocks the intended journey, return with evidence and a smaller safe option rather than extending scope automatically.
