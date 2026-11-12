# Handoff: Live interruptible voice for "Talk to Bob" (candidate not yet built)

Date: 2026-11-05. Status: **inspection phase only. No code changed, no tests run, no build run.**
Prior session id for recovery: `<session-id>` (`session_search`).

## The ask (unchanged)

Live, bidirectional, interruptible voice through the existing "Talk to Bob" button in
`<home>/clawd/projects/hermes-mobile-pwa`, bound to the exact pinned default-profile Bob
session. Keep talking while Bob does background work; barge-in stops playback; distinguish
stop-speech / correct-task / cancel-work; correlate results to requests; one brief ack when work
starts; bounded voice context; credentials server-side; release audio on hang-up, logout,
connection loss, session/profile change, and iPhone background/foreground.

Deliverable: isolated candidate build + report (choice, changed files, test evidence, limits,
pilot steps). Report physical-iPhone and live-provider checks separately; never claim them.

## Hard constraints

- `dist/` is served live. **Never run a build that writes to `dist/`.** Confirm an isolated
  out-dir first (`package.json` scripts / `vite.config.*` were never successfully read).
- Working tree is dirty with unrelated research work. Do not stash/reset/checkout. Modified
  tracked: `src/App.tsx`, `src/lib/hermesApi.ts` + test, `src/lib/mockHermes.ts` + test,
  `src/lib/storage.ts` + test, `src/styles.css`. Untracked: `docs/HANDOFF_ASTRA_MOBILE_PWA_RESEARCH.md`,
  `docs/plans/`, `docs/research/**`.
- No plugin install (Hermes Talk stays uninstalled), no config/provider change, no deploy,
  commit, push, paid voice session, Twilio/ElevenLabs routing change, calls or messages.
- No new UI. No Twilio media bridge.

## Verified facts

### PWA
- `src/lib/voiceBackend.ts` — transport-neutral contract:
  `VoiceBackend { id; capability(); unlockAudio() /* sync in gesture */; startDictation(scope, handlers); openSpeech(scope, handlers); dispose() }`,
  `DictationSession { finish; cancel }`, `SpeechSession { speak; finish; stop; close }`,
  `VoiceBackendError(code, message)` runs message through `redactForLog`. Header comment says a
  speech-to-speech realtime adapter can replace `ChainedVoiceBackend` without touching chat controls.
- `src/lib/voiceMachine.ts` — pure `transition(state, event) -> {state, effects}`.
  Phases: `idle | requesting-permission | listening | transcribing | submitting | waiting | speaking | interrupted | error`.
  Scope `{ profile, sessionId }`. Error codes: `permission-denied | insecure-context | no-microphone | unsupported | stt-failed | stt-disconnected | prompt-failed | internal`.
  Invariants: transcript submitted once from a final STT result, never blank; TTS trouble never
  fails the chat turn; scope change/reset/fatal emits `release-all`; connection loss resets to
  `initialVoiceState(scope)`. **Middle of file (event/effect unions, `transition` body) was never
  captured — re-read.**
- `src/lib/chainedVoiceBackend.ts` (read in full) — STT socket → chat turn → TTS socket. No
  concurrent talk during work, no barge-in into background work.
- `src/App.tsx` ~lines 1035–1285 — instantiates `ChainedVoiceBackend`, gates voice on the
  working state (this gate is what must be replaced by steer/queue semantics, not removed).
- `src/lib/hermesApi.ts` — already exports `audioSocketUrl`, `submitPrompt`, `steerSession`,
  queue/interrupt/cancel helpers, `fetchJson`, `authHeaders`. The steering primitives for
  requirement 3 exist; nothing new is needed server-side for correction/cancel.
- 19 vitest files incl. `voiceMachine.test.ts`, `voiceController.test.ts`,
  `chainedVoiceBackend.test.ts`, `bobMain.test.ts`, `micCapture.test.ts`, `pcmPlayer.test.ts`.
  Use these as the pattern for new offline tests.
- `scripts/`: `daily-functional-check.mjs`, `generate-icons.py`, `mobile-ux-qa.mjs`,
  `scan-secrets.mjs`, `smoke.mjs`, `tailnet-demo-server.mjs`. No candidate-build script seen.

### Native Hermes live voice (`~/.hermes/hermes-agent/tools/voice_live.py`, lines 84–186 read)
- `voice_chat_mode()` → `chained` (default) or `gpt-live`.
- `gpt-live` is **OpenAI-only and direct-key only** (`voice.gpt_live.api_key` →
  `OPENAI_API_KEY` → pool). "The Nous-managed audio proxy does not carry `/live/sessions`."
- Transport: **WebRTC, client delegation.** Browser sends SDP offer; server
  `create_webrtc_session(sdp_offer, history)` POSTs to `{base_url}/live/sessions` with the key
  and returns `{session:{id}, transport:{type:'webrtc', sdp}}`. Key never reaches the client.
- `build_session_config(history)` sets model, `live_instructions()` persona, voice, and
  `delegation: {type: 'client'}`; optional `input: history` for bounded context.
- `voice_live_turn_note(context)` — per-turn note plus recent spoken exchange, handed to the
  real agent session when the live model delegates work. This is the bounded-context /
  pinned-session mechanism (requirements 2, 7).
- `resolve_gpt_live_status()` — non-secret `{mode, available, reason, model, voice}`.

## Not verified (read these first next session)

Use `read_file` per file. Do **not** use concatenated `cat`/grep in `terminal` or
`execute_code` — every such call this session collapsed to "1 lines output" and was lost at
compaction. `read_file`, `search_files`, `skill_view` survived.

1. `skill_view('hermes-agent')` and `skill_view('voice-agent-operations')` — both lost.
2. `src/lib/bobMain.ts`, `src/lib/voiceController.ts`, `src/hooks/useVoiceController.ts`.
3. `package.json` (scripts), `vite.config.*`, project `AGENTS.md`, `git branch --show-current`.
4. `~/.hermes/hermes-agent/apps/desktop/src/lib/voice-live.ts` (renderer side of the WebRTC
   handshake: how it builds the offer, handles delegated tool calls, barge-in, playback stop).
5. The `/api/audio/voice-live/{status,session}` route handlers (grep the server for
   `voice-live`) — auth model and whether they accept a target session id.
6. Hermes Talk catalog entry / browser implementation — never compared. Minimum: find its
   transport and whether it binds to an existing session.
7. The `/hermes` proxy config (HTTP + WS) — confirm WebRTC signalling POST passes through.

## Provisional decision (confirm after step 4–6)

Reuse native `gpt-live` behind a new `src/lib/liveVoiceBackend.ts` implementing `VoiceBackend`:
- `capability()` ← `GET /hermes/api/audio/voice-live/status` through existing auth.
- Session start ← `POST /hermes/api/audio/voice-live/session` with SDP offer; bounded `history`
  from recent dialogue + task state.
- Delegated turns → pinned Bob scope via `submitPrompt` (new work) / `steerSession`
  (correction) / existing interrupt helper (cancel), each tagged with a correlation id stored
  with the originating utterance.
- Barge-in = mute/stop the remote WebRTC track locally immediately, then send the cancel to the
  live model. Does not touch the agent task.
- Results: controller subscribes to the session's assistant events, matches correlation id,
  drops stale/duplicate ids, speaks one ack on start and the verified result on completion.
- Lifecycle: `dispose()` on hang-up/logout/scope change; `visibilitychange` + `pagehide`
  handlers on iPhone pause the mic track and tear down on background beyond a short grace.

Why over Hermes Talk: no plugin install, credentials already server-side, reuses the existing
`VoiceBackend` seam and auth. Why over extending `ChainedVoiceBackend`: it cannot talk during
work or interrupt playback mid-stream without a rewrite.

Caveat to report: works only with an OpenAI key resolvable on the gateway; Nous proxy does not
support it. Live-provider and physical-iPhone checks are out of scope for the offline candidate.

## Build plan

1. Read the items above; lock the decision.
2. `src/lib/liveVoiceBackend.ts` (new), `voiceMachine.ts` (+ events: `work-started`,
   `work-result`, `steer`, `cancel-work`, `barge-in`; + effects), `voiceController.ts`
   (correlation map, dedupe, reconnect), `App.tsx` (select live backend when status says
   available, else chained; replace the working-state block with steer routing).
3. Tests (vitest, offline fakes): mic denied, auth expiry on status/session, reconnect,
   barge-in stops playback, background completion speaks once, correction steers not submits,
   session isolation (different scope → `release-all`), duplicate result ignored.
4. Build to an isolated dir only after confirming the script: e.g.
   `npx vite build --outDir dist-candidate-voice` (verify flag works in this vite version;
   never plain `npm run build`). Run `scripts/scan-secrets.mjs` on the output.
5. Report per the deliverable list, with iPhone/live-provider explicitly "not run".
