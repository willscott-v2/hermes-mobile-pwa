# Hermes Mobile PWA Feature Wishlist

**Reconciled 2026-10-06. Plan proposed; implementation requires Will's approval.**

Priority sources: [benchmark](research/mobile-agent-benchmark-2026-10.md), [live audit](research/current-pwa-experience-audit-2026-10.md), and [phased elegance plan](plans/2026-10-mobile-pwa-elegance-plan.md). The plan owns acceptance criteria, file paths, TDD, and rollback.

## Product boundaries

- Thin, mobile-first, **Tailnet-only PWA**. Hermes executes on Bob's House.
- Mobile job: read previous messages, engage active/recent sessions, send follow-ups after concluded turns, steer where supported, approve, clarify, attach, and resume. No desktop parity.
- Preserve the same-origin `/hermes` proxy, authenticated dashboard/cookie/ticket model, and existing routes.
- No private API/auth/chat service-worker caching; minimize private localStorage too.
- Any later notification contains generic state only, never prompts, titles, commands, tool output, files, or secrets.
- No native app, CarPlay, phone runtime, public exposure, or approve-all.

## Already implemented — preserve, do not rebuild

Source/fixture verification is not authenticated runtime verification.

- Recent sessions, loaded-only search, scrolling list, new-chat profile/model/reasoning sheet.
- Multiline composer, file picker/attachment chips, upload-before-submit path, disabled send during submission, clickable transcript links.
- Compact approval/clarify cards; legacy `pending_approval` / `pending_clarify` restore parsing.
- Current `open_requests` and live `approval`, `clarify`, `sudo`, `secret` request parsing; matching `request.cancel` handling.
- Request-scoped Approve once/Deny according to allowed choices; correlated JSON-RPC responses for current-protocol approval/single-question clarify, not legacy `*.respond` misuse.
- Supported choice/free-text clarify responses. Multi-select/multi-question, missing IDs, and sensitive input remain safely constrained.
- Safe/redacted context, wrapped long options, preserved transcript, and no fabricated sensitive prompt from `running`/`inflight` metadata alone.

These capabilities accumulated through the earlier 2026-08/09 attention-card work and are present at baseline `d63748d`. The old “build attention cards next” priority is stale.

## Now — proposed Release 1: Read and continue

### E1. Honest launch, login, and reconnect

Saved-host connection view; distinct reachable/authenticated/resuming states; actionable internet/Tailscale guidance; bounded read-only recovery; ≥16px mobile inputs; consistent touch/focus behavior. A generic fetch failure does not prove Tailscale is off.

### E2. Continue the right scoped conversation

Open active/recent sessions and load previous messages; provide bounded older-message retrieval, stable reading position, clear partial/error states, and verified parent/descendant continuity. Continue a concluded turn with a follow-up in the same logical conversation. Preserve list/search position. Scope references to host/base path/profile, remove legacy private preview cache, and offer Forget this device. No invented global attention inbox. The source already fetches a bounded transcript (default 120 raw messages); that does not establish complete scrollback or live continuation.

### E3. Complete one blocked-task journey

Reuse existing cards. Needs you overrides ready. Reconcile pending state after resume, prevent duplicate/stale responses, and distinguish sent from authoritatively resolved. Explain sensitive/unsupported handoff; only link to a full surface when its exact route works safely.

### E5a. Engage a running session

Verify the installed gateway’s steer/queue and cross-surface ownership semantics, then expose the supported mid-turn action with exact-session targeting and honest acceptance. Do not launch a competing runtime. If unavailable, retain an explicitly unsent draft but return to Will for a scope/backend decision; a draft alone does not satisfy active engagement. Stop/interrupt controls stay deferred.

**Release gate:** safely authenticated login → exact session → read previous/older messages → follow up after completion → observe next reply → reopen with exchange retained; separately prove supported running-session engagement and a harmless blocker response. Also require real iPhone Safari/home-screen/keyboard QA. Will authorized existing UID/password use for testing; origin-bound masked access must work. Real-session mutations and a controlled prompt canary remain separate gates.

## Next

- **E4: Answer-first reader and compact activity.** Replace blanket tool-like text suppression with role-aware answer preservation and factual collapsed activity; no raw/sensitive dumps.
- **Remaining E5: Busy composer polish.** Stop/interrupt only against verified installed-gateway capabilities. Minimal running-session engagement is in Release 1, not deferred here. Preserve attachments and never imply an unsent draft is a server queue.

## Later — platform projects

- **E6: Static offline guidance and safe updates.** Workers are currently intentionally unregistered. Manifest presence is not offline proof; design/test a versioned static-only fallback before re-enabling a worker.
- **E7: Generic re-engagement.** Only after reliable return/resolve, installed-PWA testing, and approval of the delivery/privacy design. No public exposure or content-bearing payloads.

## Deferred, not promised

Pin/rename/archive/delete, screenshot paste/drop, audio/media playback, slash palette, context/cost pill, voice, and broader administration. Reconsider against observed usage; native feature lists do not set our priorities.

## Verification debt

- Live shell/proxy/gateway/required-platform checks pass at the audit; authenticated WebSocket is **skipped**, not passed.
- Even when configured, the daily socket probe only proves transport-open. Extend readiness/resume coverage; do not infer send/receive or approval resolution from socket-open.
- Physical iPhone keyboard, install/update, real uploads, and concurrent Desktop/mobile resolution remain unverified.
- README/architecture caching descriptions drift from `src/registerServiceWorker.ts`; correct them during approved implementation, not by caching private data.

## Execution and approval boundary

Default execution to verified **cheaper workers** for bounded code, tests, source inventory, and routine checks. Reserve **Astra/Fable for orchestration, design/security decisions, exception diagnosis, and independent QA**. Use scripts for deterministic work. No silent premium/provider/CLI fallback if a worker fails; diagnose and escalate explicitly. No model routing changed by this plan.

Until Will approves Release 1, this wishlist does not authorize nightly implementation, credential changes, commits, pushes, or deployment. Use of the existing login for testing is authorized, subject to safe masked access and exact-origin verification. Read-only health checks may report new failures; do not rebuild existing cards automatically.

## Changelog

- **2026-10-06 Release 1 candidate implemented (not deployed):** per-session history with backward paging and stable anchors, honest connection/resume/running states, scoped Continue reference + Forget this device, verified Queue/Steer running-turn input, truthful approval/clarify response states, ≥16px inputs and 44px Back target. Candidate builds go to `dist-candidate/`; live `dist/` untouched. Authenticated canary and physical-iPhone pass still pending (vault save declined this session). See `docs/research/evidence-2026-10/release1/`.

- **2026-10-06 owner correction:** Expanded and renamed Release 1 to Read and continue: per-session history, older-message loading, follow-ups after completed turns, and supported active-turn engagement are required, not merely blocker resolution. Existing login testing authorized; vault origin mismatch currently blocks safe access. No product code changed.

- **2026-10-06:** Reconciled after the [benchmark](research/mobile-agent-benchmark-2026-10.md), [audit](research/current-pwa-experience-audit-2026-10.md), and [plan](plans/2026-10-mobile-pwa-elegance-plan.md). Moved existing cards/attachments out of “to build,” prioritized Return and resolve, deferred push until restore is dependable, added storage/privacy and physical-phone gates, and recorded cheaper-worker execution with Astra/Fable orchestration/QA. No product implementation occurred.
