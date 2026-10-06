# Astra Handoff: Hermes Mobile PWA Benchmark and Improvement Plan

## Purpose

Use **Astra (`gpt-6-astra`)** to study the strongest mobile agent experiences and produce an evidence-based improvement plan for our existing Hermes Mobile PWA.

This is a **research, product-design, and planning session**, not an implementation session. Do not modify product code, runtime configuration, Tailscale routes, authentication, or launch services unless Will explicitly approves implementation after reviewing the plan.

## Owner direction

Will wants to study the best mobile agent experiences and make our PWA more elegant.

He likes the ideas behind native Hermes clients and Apple CarPlay, but **does not want to build a full native app**. Treat native apps as references for interaction patterns, not as the target architecture.

The product should remain:

- a mobile-first PWA;
- a thin remote control for Hermes running on Bob's House;
- private behind Tailscale;
- focused on high-value mobile actions rather than desktop feature parity;
- safe around tools, approvals, files, credentials, and private session content.

## Project and runtime

- Repository: `~/clawd/projects/hermes-mobile-pwa`
- Branch: `main`
- Starting commit: `d63748d4486082a52f94a34add67f61befbaa701`
- Live PWA: `https://<tailnet-host>:8447`
- Tailscale Serve: HTTPS `:8447` → `http://127.0.0.1:4179`
- PWA proxy: `/hermes` → Hermes dashboard at `http://127.0.0.1:3456`
- Launch service: `ai.hermes.mobile-pwa-tailnet`
- Dashboard service: `com.hermes.dashboard`

Do not print or copy dashboard passwords, session tokens, password hashes, auth secrets, provider credentials, or private transcript content.

## Current verified state

At handoff time:

- Git working tree was clean.
- The live PWA shell and manifest loaded successfully.
- `npm run check:daily` passed against the Tailnet URL.
- Gateway and Photon were reported healthy.
- Mobile mock-flow QA had no failures or horizontal overflow.
- Authenticated WebSocket QA was **skipped** because no safe check credential was available. Do not describe that path as verified.
- A reported phone loading failure was traced to Tailscale not running on the phone, not a PWA defect.

Re-run the live checks before relying on these facts.

## Read first

1. `README.md`
2. `SECURITY.md`
3. `docs/ARCHITECTURE.md`
4. `docs/AUTH_SETUP.md`
5. `docs/FEATURE_WISHLIST.md`
6. `src/App.tsx`
7. `src/lib/hermesApi.ts`
8. `src/styles.css`
9. `scripts/daily-functional-check.mjs`
10. `scripts/mobile-ux-qa.mjs`

Also load these Hermes skills:

- `mobile-pwa-control-surfaces`
- `hermes-integrations-operations`
- `browser-visual-qa`
- `writing-plans`
- `grounded-citations` or `research-intelligence` for the benchmark research

## Baseline commands

Run these before research or recommendations:

```bash
cd ~/clawd/projects/hermes-mobile-pwa
git status --short --branch
git log --oneline -8
npm run check:daily
npm test
npm run typecheck
npm run build
npm run smoke
```

Use the real Tailnet URL for browser QA. Do not rely only on mock mode or screenshots already in `test-results/`.

## Research question

> What interaction patterns from the best current mobile AI-agent products would make our Hermes PWA feel fast, calm, clear, and trustworthy without turning it into a native app or copying desktop complexity onto a phone?

## Products and experiences to study

Start with the recent Hermes mobile ecosystem, then compare it with polished general-purpose agent/chat products.

### Hermes-specific references

- Conduit
- Hermes Fleet
- Vory
- bighelp
- Hermex
- Cadu
- the current official Hermes web dashboard on a mobile viewport

### Broader quality references

Select a small, defensible set based on actual access and current product quality. Likely candidates include:

- ChatGPT mobile/web
- Claude mobile/web
- Gemini mobile/web
- Grok mobile/web
- Linear's mobile interaction patterns for inbox, triage, and compact state
- one strong mobile developer-agent or remote-coding interface, if current and accessible

Do not treat marketing copy as proof. Prefer direct product inspection, current App Store pages, official documentation, recent demonstrations, and high-signal community reports. Record dates and access limitations.

## What to evaluate

Use one consistent rubric for every product:

1. **Launch and reconnect**
   - time to useful state;
   - session restoration;
   - stale/offline handling;
   - whether the user understands what is happening.

2. **Information architecture**
   - recent sessions;
   - switching agents/profiles/workspaces;
   - search, pinning, archive, and orientation;
   - how much navigation is visible at once.

3. **Conversation readability**
   - visual hierarchy between user text, final answers, reasoning, tool activity, files, and errors;
   - long-answer scanning;
   - code, links, tables, and media on a narrow screen.

4. **Composer quality**
   - keyboard behavior;
   - voice/dictation;
   - attachments and screenshots;
   - command discovery;
   - send/stop/steer behavior during an active turn.

5. **Agent state and progress**
   - thinking/running/blocked/completed states;
   - compact tool summaries;
   - progress without transcript noise;
   - background task and delegated-agent visibility.

6. **Attention and approvals**
   - clarify questions;
   - command approvals;
   - secrets/sudo prompts;
   - notification-to-action flow;
   - whether risky actions are easy to understand but hard to approve accidentally.

7. **Re-engagement**
   - push or browser notifications;
   - badges/live status;
   - deep links back to the exact session;
   - privacy of notification payloads.

8. **Trust and control**
   - visible host/runtime identity;
   - authentication clarity;
   - model/profile/workspace context;
   - handling of errors, lost connection, and expired login;
   - clear boundary between the phone client and the server doing the work.

9. **Fit for a PWA**
   - mark each pattern as:
     - `Borrow now in the PWA`
     - `Possible later with web-platform work`
     - `Native-only / reject`

## Product principles to preserve

- Do not pursue CarPlay, deep native phone control, App Store distribution, or a parallel Hermes runtime on the phone.
- Do not chase feature parity with Hermes Desktop.
- The mobile job is: **check, steer, approve, clarify, attach, resume, and leave**.
- Final answers should dominate; tool logs and internal mechanics should collapse behind summaries.
- Prefer progressive disclosure over dense control panels.
- Preserve the existing same-origin `/hermes` proxy and authenticated dashboard model.
- Keep all private API, auth, and chat traffic out of service-worker caches.
- Notifications must contain generic state only, never prompts, tool output, files, commands, or secrets.
- Do not make Tailnet-only services public for convenience.

## Required deliverables

Create these files without changing application code:

### 1. `docs/research/mobile-agent-benchmark-2026-10.md`

Include:

- methodology and research date;
- products inspected and access limits;
- one evidence-backed card per product;
- a consistent comparison matrix using the rubric above;
- specific interaction patterns worth borrowing;
- patterns that look attractive but conflict with our PWA/security constraints;
- source links and sparing citations;
- no invented hands-on experience.

### 2. `docs/research/current-pwa-experience-audit-2026-10.md`

Audit the real live PWA at approximately 390px width. Cover:

- first launch;
- login and expired-login states;
- session list and new-chat flow;
- resume/reconnect;
- long conversation readability;
- active turn and tool activity;
- approval and clarify cards;
- keyboard/composer behavior;
- offline/Tailscale-down behavior;
- install/update behavior;
- accessibility and tap targets.

Distinguish verified observations from untested paths. The authenticated WebSocket path remains unverified unless a safe masked credential flow is explicitly provided.

### 3. `docs/plans/2026-10-mobile-pwa-elegance-plan.md`

Produce a phased plan with:

- **North star:** one sentence describing the intended mobile experience;
- 5–8 design principles;
- prioritized opportunities ranked by user impact, effort, security risk, and dependency;
- `Now`, `Next`, and `Later` phases;
- explicit non-goals;
- acceptance criteria for every proposed change;
- exact files likely to change;
- TDD and mobile browser-QA strategy;
- migration/rollback notes where applicable;
- no implementation until Will approves the plan.

Prefer a small number of coherent improvements over a feature pile. A likely first release should improve the complete path from opening the PWA to resolving one blocked Hermes task.

### 4. Update `docs/FEATURE_WISHLIST.md`

Only after the research and plan are complete, reconcile the wishlist so it reflects the evidence and removes stale priorities. Keep a short changelog note linking to the benchmark and plan.

## Decision framework

Score proposed improvements from 1–5 on:

- frequency of mobile use;
- reduction in friction or uncertainty;
- ability to unblock Hermes remotely;
- PWA feasibility;
- implementation effort, reversed so easier scores higher;
- security/privacy confidence;
- testability.

A feature should not rank highly merely because a native competitor has it.

## Likely hypotheses to test, not assumptions to accept

- The biggest elegance gain may come from navigation, hierarchy, and reconnect behavior rather than additional features.
- A compact activity/progress model may matter more than exposing every tool call.
- The session list may need stronger recency, project/profile orientation, and continue-where-I-left-off behavior.
- The composer may need clearer busy-state actions such as stop, steer, or queue.
- Push may be lower priority than reliable pending-attention restore and a clean return path.
- Better Tailscale/offline diagnostics may remove more real-world frustration than visual polish alone.

Validate or reject these with evidence.

## Guardrails

- Research and planning only unless the user explicitly approves code changes.
- No posting, messaging, App Store interaction, TestFlight enrollment, purchases, or account creation.
- No copying proprietary app assets or trade dress.
- No printing credentials or private session content.
- No public exposure changes.
- No destructive Git operations.
- Preserve the live service and existing URLs.
- If a benchmark product cannot be inspected directly, label the limitation and lower confidence.

## Completion gate

Before reporting completion:

- confirm all three new documents exist;
- verify every recommendation maps to benchmark evidence or an observed weakness in our PWA;
- run `npm run check:daily` again to prove the research session did not disturb the live service;
- run `git diff --check`;
- summarize the top five proposed improvements and the recommended first release;
- stop for Will's approval before implementation.

## Exact prompt for the next Astra session

> Use Astra for this session. Work in `~/clawd/projects/hermes-mobile-pwa`. Read `docs/HANDOFF_ASTRA_MOBILE_PWA_RESEARCH.md` completely and follow it as the task contract. Study the strongest current mobile agent experiences, audit our live PWA, and produce the benchmark, experience audit, and phased elegance plan. Keep ours a thin Tailnet-only PWA; do not propose a full native app or CarPlay build. Do not implement product changes yet. Verify the live service before and after, cite what you actually inspected, and stop for my approval after presenting the recommended first release.
