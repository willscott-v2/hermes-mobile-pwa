# Handoff: Live interruptible voice for "Talk to Bob" — build phase

Date: 2026-11-05 (end of second inspection session).
Supersedes `HANDOFF_LIVE_VOICE_CANDIDATE.md` (kept for history; its "Not verified" list is fully
cleared). Working scratch: `LIVE_VOICE_TODO_SCRATCH.md` (keep updating it as you go).
Recovery session ids: `<session-id>` (first inspection), `<session-id>`
(this one). Use `session_search(query=..., session_id=...)` for exact file excerpts.

## Status in one line

> **UPDATE 2026-11-12: the build plan below is COMPLETE.** A third session (2026-11-05 PM) landed
> steps 2–9; the deliverable is `docs/LIVE_VOICE_CANDIDATE_REPORT.md` and `dist-candidate/`.
> Re-verified 2026-11-12: `tsc -b` clean, vitest 24 files / 465 tests pass (73 live-voice), no
> source newer than the candidate build, `scan:secrets` 0 findings in `src/` or `dist-candidate/`.
> Do not restart at step 2. The text below is the pre-build state, kept for history.
>
> **UPDATE 2026-11-12 PM: pilot steps 1–3 PASSED.** Step 1 (candidate on the iPhone over the
> tailnet, :8449), step 2 (`OPENAI_API_KEY` in `~/.hermes/.env`, `voice.voice_chat_mode: gpt-live`
> in `~/.hermes/config.yaml`, status probe returns `available:true`), step 3 (Will's one authorised
> live WebRTC test on the phone: "live voice worked on the phone side"). Details and the evidence
> caveats are in `docs/LIVE_VOICE_TODO_SCRATCH.md` ("Pilot step 3"). Still not committed, not
> deployed; `dist/` is untouched. Next decision is Will's: promote `dist-candidate` to `dist/`
> (and commit the live-voice files separately from the dirty profile-scoped-chat work), or keep
> piloting on :8449 first (delegation turn, lock screen, barge-in).
>
> **UPDATE 2026-11-12 06:50 CT: SHIPPED.** Pilot step 3b (delegation turn) PASSED — Will's spoken
> "ask Bob to tell me the last line of my session log" landed in the pinned session
> `<session-id>` as `messages` id 236855 (with the delegation framing in `api_content`),
> Bob answered at 236933 (~14 s server-side, ~8–10 s perceived), and the answer was spoken back.
> `dist-candidate/` was then promoted to `dist/` (bundle `index-BAqKqk_r.js`; prior live bundle
> `index-CEc9p-tj.js` backed up to `~/.hermes/backups/mobile-pwa-dist-20261020-1330/`). Live :4179
> and tailnet :8447 both serve the new bundle; `sw.js` is `Cache-Control: no-store` so phones pick
> it up on next open. Live-voice files committed as `0063179` (41 files). **Not in that commit:**
> the wiring hunks in `App.tsx`, `hermesApi.ts`, `hermesApi.test.ts`, `mockHermes.ts`,
> `mockHermes.test.ts`, `styles.css` — they interleave hunk-for-hunk with the uncommitted
> attachment work and go with that commit. Still not run: lock-screen/background, barge-in on
> the phone, mic re-acquire after a phone call. Details: `LIVE_VOICE_TODO_SCRATCH.md`.
>
> **UPDATE 2026-11-12 10:23 CT: COMMITTED + PUSHED.** The six interleaved files plus the attachment
> work (`attachments.ts`, its unit tests, `tests/e2e/attachments.spec.ts`) landed as `20e2a2f`, so
> `HEAD` alone typechecks (465 unit tests green). Pushed to the public repo the only way the policy
> allows: a sanitized export of the `HEAD` tree (placeholders for the Tailnet host, home path and
> session ids; `scan:secrets` clean), not local history. Record in `PUBLIC_RELEASE_AUDIT.md`.

**(Historical, 2026-11-05 AM) Inspection complete. Decision locked. Zero code written, zero tests
run, zero builds.** Every file the first handoff listed as unread has now been read. Build plan
step 2 is the next action. Nothing in the working tree was changed by either inspection session.

## The ask (unchanged, abbreviated)

Live, bidirectional, interruptible voice behind the existing "Talk to Bob" button, bound to the
exact pinned default-profile Bob session. Keep talking while Bob works; barge-in stops playback;
distinguish stop-speech / correct-task / cancel-work; correlate results to requests; one brief
ack when work starts; bounded voice context; credentials server-side; release audio on hang-up,
logout, connection loss, session/profile change, iPhone background/foreground.

Deliverable: isolated candidate build + report (choice, changed files, test evidence, limits,
pilot steps). Physical-iPhone and live-provider checks are reported as **not run**, never claimed.

## Hard constraints

- `dist/` is served live. Build only with `npm run build:candidate`
  (= `tsc -b && vite build --outDir dist-candidate`, confirmed in `package.json`). Never
  `npm run build`.
- Preview a candidate with `npm run preview:candidate` (demo server on 4180, dist from
  `dist-candidate`, proxying `/hermes` → `127.0.0.1:3456`).
- Branch `main`, dirty with unrelated profile-scoped-chat work: `src/App.tsx`,
  `src/lib/hermesApi.ts` (+test), `src/lib/mockHermes.ts` (+test), `src/lib/storage.ts` (+test),
  `src/styles.css`; untracked `docs/HANDOFF_ASTRA_MOBILE_PWA_RESEARCH.md`, `docs/plans/`,
  `docs/research/**`. Do not stash/reset/checkout. Edit around it.
- No plugin install (Hermes Talk / hermes-live-voice stay uninstalled), no config/provider
  change, no deploy, commit, push, paid voice session, Twilio/ElevenLabs change, calls, messages.
- No new UI surface. No Twilio media bridge.
- Live-audio gates (`voice-agent-operations` skill): any WebRTC handshake against the real
  gateway is live-provider use (mic audio leaves the device, credits, transcript retention).
  If Will ever authorizes one test: one token attempt, latch *before* the session POST so an
  error cannot retry; the local watchdog is not a provider hard limit; text simulation is not
  evidence for barge-in, playback cancel, or turn timing.

## Decision (locked)

Native Hermes `gpt-live` through `/api/audio/voice-live/{status,session}`, WebRTC client
delegation, **binding to the pinned Bob session done client-side** (the server route takes no
target session id). New `src/lib/liveVoiceBackend.ts` + sibling machine/controller; chained
backend stays as the fallback when status says unavailable.

Why not Hermes Talk / hermes-live-voice: both need plugin install (prohibited); Talk lets the
voice model steer *any* session with no confirm; neither pins a fixed session.
Why not extending `ChainedVoiceBackend`: it cannot talk during work or cut playback mid-stream
without a rewrite.

Known limit to report: `gpt-live` is OpenAI-only and direct-key only (`voice.gpt_live.api_key`
→ `OPENAI_API_KEY` → pool). The Nous-managed audio proxy does not carry `/live/sessions`. If
the gateway has no resolvable OpenAI key, `status.available` is false and the PWA must fall
back to chained silently.

## Verified upstream contracts (`~/.hermes/hermes-agent`)

Sources read: `tools/voice_live.py` 81–186, `hermes_cli/web_routers/audio.py` from 150,
`apps/desktop/src/lib/voice-live.ts` (549 lines), `use-voice-live-conversation.ts` to EOF.

- `GET /api/audio/voice-live/status` → `{ok, mode:'chained'|'gpt-live', available, reason,
  model, voice}`. Non-secret. Profile-scoped dashboard auth (`?profile=`, Bearer or cookie).
- `POST /api/audio/voice-live/session` body `{sdp, history?}` →
  `{ok, session:{id}, transport:{type:'webrtc', sdp}}`. 503 on ValueError (not configured),
  502 on RuntimeError. Key never leaves the server. **Open item:** the Pydantic request model
  name is not `VoiceLiveSessionRequest` (grep returned nothing); re-grep `audio.py` for
  `BaseModel` near the route before hard-coding the body shape.
- Client handshake (from desktop `voice-live.ts`): `RTCPeerConnection` → `addTrack(mic)` →
  `createDataChannel('oai-events')` → `createOffer` / `setLocalDescription` → wait for ICE
  (10 s cap) → POST (45 s timeout) → `setRemoteDescription({type:'answer', sdp})`. Send the
  SDP byte-exact.
- Remote `track` → `audio.srcObject`. Speaking probe: AnalyserNode peak > 6 every 100 ms,
  4 quiet frames hysteresis.
- Server→client data-channel events: `session.started`, `session.input_transcript.delta`,
  `session.output_transcript.delta` (speaker/start_ms/end_ms), `session.delegation.created`
  (→ `onDelegation(id, contextWindow)` with 5 min / 80 fragment window), `error` (ignore
  `context_injection_incomplete`), `session.closed`.
- Client→server: `session.thinking.append`, `session.commentary.append` (≤1400-char chunks on
  sentence boundaries), `session.instructions.append`, `session.input_audio.mute|unmute`,
  `session.close` (15 s grace then force).
- `build_session_config(history)` sets model, `live_instructions()` persona, voice,
  `delegation:{type:'client'}`, optional `input: history`. `toLiveHistory()` seeds ≤24
  messages / ≤6000 chars. `voice_live_turn_note(context)` is the per-turn note handed to the
  real agent session on delegation (this is the bounded-context mechanism).

## Verified PWA seams (`<home>/clawd/projects/hermes-mobile-pwa`)

Line numbers are from the dirty tree on 2026-11-05; treat as approximate.

- `src/lib/voiceBackend.ts` (60 lines) — `VoiceBackend { id; capability(); unlockAudio();
  startDictation(scope, handlers) → DictationSession; openSpeech(scope, handlers) →
  SpeechSession; dispose() }`. `VoiceBackendError(code, msg)` redacts via `redactForLog`.
  Dictation and speech are separate sessions; **there is no "conversation" primitive**, so a
  live backend cannot be a drop-in `VoiceBackend` without either widening the interface or
  running beside it.
- `src/lib/voiceMachine.ts` — pure `transition(state, event) → {state, effects}`. Phases
  `idle | requesting-permission | listening | transcribing | submitting | waiting | speaking |
  interrupted | error`. Events (50–80): START/STOP/INTERRUPT/RESET/MIC_GRANTED/MIC_DENIED/
  STT_PARTIAL/STT_FINAL/PROMPT_ACCEPTED/ASSISTANT_DELTA/ASSISTANT_COMPLETE/TTS_STARTED/
  TTS_ENDED/TTS_FAILED/SOCKET_CLOSED/FAIL/SESSION_CHANGED/PROFILE_CHANGED/GATEWAY_LOST.
  No steer / cancel-work / barge-in / work-started / work-result. Invariants: transcript
  submitted once from a final STT result, never blank; TTS trouble never fails the chat turn;
  scope change/reset/fatal emits `release-all`. **`transition` body from line 107 still
  unread** — read before deciding to extend vs. write the sibling `liveVoiceMachine.ts`.
- `src/lib/voiceController.ts` (181 lines) — framework-free; owns machine + backend sessions;
  epoch-guarded callbacks; `gatewayEvent()` only accepts frames whose `session_id` equals the
  scope's live session id (fail closed); `submit()` opens speech then calls `deps.submitText`.
- `src/hooks/useVoiceController.ts` (76 lines) — one controller per backend;
  `visibilitychange: hidden` / `pagehide` → `RESET` (immediate, no grace).
- `src/lib/chainedVoiceBackend.ts` — STT over `/api/audio/transcribe-stream` ws (batch
  fallback `POST /api/audio/transcribe`), TTS over `/api/audio/speak-stream` ws; deps
  `{audio, socketUrl(kind, profile), transcribeBatch(profile, wav, signal)}`. Pattern for
  injectable deps.
- `src/lib/fakeVoiceBackend.ts` — unread; it is the test double App.tsx uses when the client
  lacks `audioSocketUrl`. Read before writing the live fake.
- `src/lib/hermesApi.ts` — `HermesApiClient(baseUrl)`; `GatewayHandle` (~174):
  `submitPrompt(sessionId, text)` (`prompt.submit`, 10 min timeout), `queuePrompt`,
  `steerSession(sessionId, text, profile?)` (`session.steer`); `endpointUrl` (~224);
  `authHeaders(auth)` (~264; Bearer only in token mode, otherwise cookie +
  `credentials:'include'`); `socketCredential` (~466) mints a one-use ticket in cookie mode;
  `transcribeAudio` (~481) is the only authenticated POST and is the pattern to copy;
  `private get<T>` (~583). **No `post<T>` helper exists** — add one or inline like
  `transcribeAudio`.
- `src/lib/bobMain.ts` — `resolveBobMain(reference, fetchDetail)`; pin is an exact session id
  under profile `default`; `canPinAsBobMain`.
- `src/App.tsx` ~1036–1130 — `voiceBackend` memo on `[client, auth]` (`ChainedVoiceBackend`
  if `'audioSocketUrl' in client`, else `FakeVoiceBackend`); `voiceScope = {profile,
  sessionId: liveSessionId}`; `voiceBlockedReason` returns a block when
  `chatStatus === 'running'` (~1064–65) — **this is the gate to replace with steer routing, not
  remove**; `submitVoicePrompt(text)` pushes a local user bubble then `gateway.submitPrompt`;
  `onVoiceAction(start|stop|interrupt)`; `toggleVoice()`; "Talk to Bob" →
  `openSession(session, {openVoice:true})` (~1191).
- `vite.config.ts` — **no proxy** (dev 5178 / preview 4178, strictPort). Live signalling is only
  reachable through `scripts/tailnet-demo-server.mjs` (port 4179 default, `/hermes` →
  `127.0.0.1:9119`, all verbs + ws via `http-proxy`) or the dashboard origin directly.
- Tests: 19 vitest files incl. `voiceMachine.test.ts`, `voiceController.test.ts`,
  `chainedVoiceBackend.test.ts`, `bobMain.test.ts`, `micCapture.test.ts`, `pcmPlayer.test.ts`.
- `scripts/`: `scan-secrets.mjs`, `smoke.mjs`, `mobile-ux-qa.mjs`, `daily-functional-check.mjs`,
  `tailnet-demo-server.mjs`, `generate-icons.py`.

## Reuse / build matrix

| Need | Reuse (verified) | Build |
|---|---|---|
| Availability | `GET /api/audio/voice-live/status` | `HermesApiClient.voiceLiveStatus(auth, profile)`; cache result on backend construct |
| Signalling | `POST /api/audio/voice-live/session` | `HermesApiClient.voiceLiveSession(auth, profile, sdp, history)` + a `post<T>` helper |
| WebRTC transport | desktop `voice-live.ts` flow (copy the sequence, not the file) | `src/lib/liveVoiceSession.ts` with injectable `RTCPeerConnection` / `getUserMedia` / `AudioContext` factories |
| State | `voiceMachine.ts` conventions (pure reducer, `release-all`) | `src/lib/liveVoiceMachine.ts` sibling: phases `idle/connecting/live/working/error`; events `DELEGATION/BARGE_IN/STEER/CANCEL_WORK/WORK_STARTED/WORK_RESULT/...` |
| Delegated turn → Bob | `gateway.submitPrompt` (new work), `steerSession` (correction), existing interrupt helper (cancel) | `src/lib/liveVoiceController.ts`: correlation map `delegationId → {sessionId, utterance, startedAt}`, dedupe, one ack on start, speak verified result once |
| Session pinning | `voiceController.gatewayEvent` exact-`session_id` filter, `bobMain` pin | same filter in the live controller; `SESSION_CHANGED`/`PROFILE_CHANGED` → `release-all` + `session.close` |
| Barge-in | — | mute remote track locally first, then `session.input_audio.*` / cancel over the data channel; never touches the agent task |
| Lifecycle | `useVoiceController` hidden/pagehide hooks | `src/hooks/useLiveVoice.ts`: pause mic on hidden, tear down after short grace (not immediate `RESET`) |
| App wiring | `voiceBackend` memo, `voiceScope`, `submitVoicePrompt` | select live when `status.available && mode==='gpt-live'`, else chained; replace the `running` gate with steer routing |

## Build plan (step 2 onward)

Do these in order; tick them in `LIVE_VOICE_TODO_SCRATCH.md` as each lands.

1. Reads left (cheap, `read_file` only): `voiceMachine.ts` from 107, `fakeVoiceBackend.ts`,
   `audio.py` request model near the voice-live route.
2. `src/lib/hermesApi.ts`: add `post<T>` (mirror `transcribeAudio` auth/credentials), then
   `voiceLiveStatus(auth, profile)` and `voiceLiveSession(auth, profile, sdp, history?)`.
   Add to the existing `hermesApi.test.ts` (file is already modified in the tree — append,
   don't rewrite).
3. `src/lib/liveVoiceMachine.ts` — pure reducer + tests first (TDD; the chained machine tests
   are the template).
4. `src/lib/liveVoiceSession.ts` — WebRTC transport; all browser globals injected.
5. `src/lib/liveVoiceController.ts` — delegation routing, correlation, dedupe, pin filter.
6. `src/hooks/useLiveVoice.ts` + `App.tsx` wiring (status probe → backend choice; steer
   routing replaces the `running` block; "Talk to Bob" unchanged).
7. Tests (vitest, offline fakes): mic denied; status 503 → chained fallback; session 502 →
   error, no retry; auth expiry on status/session; reconnect; barge-in mutes remote track before
   data-channel send; background completion speaks exactly once; correction → `steerSession`
   not `submitPrompt`; cancel → interrupt helper; different scope → `release-all` +
   `session.close`; duplicate `WORK_RESULT` ignored; hidden → mic paused, torn down after grace.
8. `npm run typecheck`, `npm test`, `npm run build:candidate`, `npm run scan:secrets`
   (confirm it scans `dist-candidate`, not only `dist`).
9. Report: choice + why, changed files, test output, limits (OpenAI-only, no Nous proxy, no
   dev-server proxy), pilot steps (`preview:candidate` on the tailnet, then one authorized live
   test under the gates above). iPhone + live provider: "not run".

## Working-method notes for the next session

- Multi-line `terminal` / `execute_code` output was lost at every compaction in both sessions.
  Use `read_file`, `search_files`, `skill_view` per item; they survive.
- Both sessions hit the tool-call ceiling. Budget: write to the scratch doc after every two or
  three substantive steps, not at the end.
- Load `hermes-agent` and `voice-agent-operations` skills right before the step that needs
  them; they were pruned repeatedly when loaded early.
- Do not touch the unrelated dirty files beyond the minimal `App.tsx` / `hermesApi.ts` edits
  above; keep diffs reviewable per file.
