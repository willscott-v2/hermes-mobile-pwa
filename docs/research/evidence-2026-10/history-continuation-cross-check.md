# History and continuation source cross-check

Native leaf worker: `qwen3.8:27b-mlx`; batch `deleg_a6568c74`; reported duration 331.67 seconds, 6 API calls. Read-only audit; no fallback. Parent checked source directly before adopting findings.

## Verified

- `src/lib/hermesApi.ts:267–290`: adapter defaults to 120 raw messages, clamps requested window to 500, selects a tail offset, normalizes and returns a bounded window. It is not backward paging.
- `src/App.tsx:401`: opening a session requests 160 raw messages. `:377–380`: refresh requests 220 and replaces state only when nonempty. Earlier loaded messages could not survive this replacement under a future paging feature without a change.
- `hermesApi.ts:299–304` and `App.tsx:416–418`: latest-descendant resolution feeds the resume target; the gateway can return a different live ID. This is source evidence, not live lineage or cross-surface ownership proof.
- `App.tsx:412,451,507–526`: message.complete returns the UI to ready; ordinary submit then uses the live session ID. Follow-up after completion already has a client path.
- `App.tsx:510` blocks ordinary sends while running/connecting. `hermesApi.ts:340–383` exposes no dedicated steer/queue operation. Backend support is unverified.

## Worker claims not adopted

- 75 is the session-list page size, not initial per-session message history.
- The user requested manual engagement, not automatic model-led re-engagement. Absence of autonomous re-engagement is not a defect against this requirement.
- No client steer API does not prove no server capability. Do not infer a backend change is required without installed-protocol inspection.
- Following up after a concluded turn does not inherently require a new send/steer path; the existing prompt.submit path already permits it in source.
- The polling observation is conditional on client state and live events; it does not establish every remote completion's timing.
- Broad assertions about missing test coverage were not independently exhaustively checked and are not used as proof.

No credentials or private transcripts were inspected. Authenticated acceptance remains blocked by the separately recorded browser/vault origin mismatch. This check does not authorize implementation.
