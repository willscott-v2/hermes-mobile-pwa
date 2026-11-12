# Live voice candidate — build report (2026-11-05)

Status: **candidate built, tests green, nothing deployed, nothing committed, no live-provider or
iPhone run.** `dist/` untouched (mtime still Oct 20 13:30). Candidate in `dist-candidate/`.

> **UPDATE 2026-11-12: superseded — SHIPPED.** Pilot gates 1–3 and the delegation turn (3b) passed
> on Will's iPhone over the tailnet; `dist-candidate/` was promoted to `dist/` (bundle
> `index-BAqKqk_r.js`) and the live-voice files were committed as `0063179`. The wiring hunks in
> `App.tsx` / `hermesApi.ts` / `mockHermes.ts` / `styles.css` and their tests landed with the
> attachment work as `20e2a2f` (2026-11-12); pushed as a sanitized export. Current state and evidence: `LIVE_VOICE_TODO_SCRATCH.md`
> ("Pilot step 3b", "Promotion + commit") and the top of `HANDOFF_LIVE_VOICE_BUILD.md`.
> The rest of this report is the 2026-11-05 build-time state, kept for history.

## Choice (unchanged from the locked decision)

Native Hermes `gpt-live` through `GET/POST /api/audio/voice-live/{status,session}` with WebRTC
client delegation. Binding to the pinned Bob session is client-side: every delegation becomes a
`prompt.submit` on the scope's live session id, and only gateway frames whose `session_id` equals
that id are correlated back. Chained voice stays the fallback whenever `status.available` is false
or `mode !== 'gpt-live'` (older gateway, no OpenAI key, mock client).

Rejected alternatives and why are in `HANDOFF_LIVE_VOICE_BUILD.md`.

## Verified contracts this build relies on

| Contract | Source |
|---|---|
| `GET /api/audio/voice-live/status` → `{ok, mode, available, reason, model, voice}` | `hermes_cli/web_routers/audio.py:180` |
| `POST /api/audio/voice-live/session` body `{sdp, history?}` → `{ok, session:{id}, transport:{type:'webrtc', sdp}}`; 400 blank sdp, 503 not configured, 502 vendor | `audio.py:190`, `hermes_cli/web_models.py:247` (`VoiceLiveSessionRequest`) |
| `prompt.submit` accepts `surface:'voice-live'` + `voice_context` (≤6000 chars, model input only) | `gateway/session_surface.py:13-40`, `gateway/session_controls.py:817` |
| `session.interrupt {session_id, profile?}` → `{status:'interrupted'|'not_interrupted'}` | `tui_gateway/contracts/sessions.py:605-621` |
| Data-channel events / commands and the handshake sequence | `apps/desktop/src/lib/voice-live.ts` (copied sequence, not the file) |
| Local gateway has the route (answers 401 unauthenticated, i.e. route exists, auth-scoped) | `curl http://127.0.0.1:3456/api/audio/voice-live/status?profile=default` during this session |

## Files

New (all under `src/`, none tracked yet — the whole voice stack was already untracked):

| File | Lines | Purpose |
|---|---|---|
| `lib/liveVoiceMachine.ts` | 311 | Pure reducer. Phases `idle/connecting/live/working/error`. `classifyUtterance` → `new` / `correction` / `cancel` / `stop-speech`. FIFO queue for new work while working. One ack per delegation, result spoken once, duplicates ignored. |
| `lib/liveVoiceSession.ts` | 320 | WebRTC transport, every browser global injected (`LiveRtcEnv`). Desktop handshake order, byte-exact SDP, ICE 10 s cap, `oai-events` channel, bounded context window (5 min / 80 fragments), sentence-chunked commentary (≤1400 chars), `close()` with 15 s grace vs `release()` immediate. |
| `lib/liveVoiceController.ts` | 266 | Runs machine effects: session factory, SDP exchange, submit/steer/interrupt deps; epoch-guarded callbacks; 1.5 s utterance settle; hidden → mic pause + 20 s teardown; exact `session_id` filter on gateway frames. `delegationPrompt` and `toLiveHistory` ported from desktop. |
| `lib/browserLiveRtc.ts` | 104 | Real `RTCPeerConnection` / `getUserMedia` / `<audio>` / analyser probe. `unlock()` inside the tap. |
| `lib/fakeLiveRtc.ts` | 114 | Test double env with release assertions. |
| `lib/liveVoiceView.ts` | 35 | Maps live state onto the existing `VoiceControls` (no new UI surface). |
| `hooks/useLiveVoice.ts` | 65 | React binding; visibility/pagehide → pause+grace, not immediate reset. |
| `lib/liveVoiceMachine.test.ts`, `liveVoiceSession.test.ts`, `liveVoiceController.test.ts`, `liveVoiceView.test.ts` | 790 | 73 tests. |

Modified:

- `src/lib/hermesApi.ts` (+~110): `VoiceLiveStatus`/`VoiceLiveHistoryMessage`/`VoiceLiveAnswer` types, private `post<T>` (same auth rules as `transcribeAudio`), `voiceLiveStatus()` (non-throwing except auth errors), `voiceLiveSession()`, `submitPrompt(sessionId, text, {surface, voiceContext})`, `submitPromptParams`, optional `GatewayHandle.interruptSession` + `interruptOutcomeFromResult`. Mock gateway untouched (optional method).
- `src/lib/hermesApi.test.ts`: 9 tests appended (status shape/404/401, session POST byte-exact + header-only auth, 503/502, blank guards, params, interrupt outcome).
- `src/App.tsx` (~75 lines in the voice block): status probe on `[client, auth, activeProfile]`; `liveEngine` flag; `liveRtcEnv` + `liveVoiceDeps` memos; `submitLiveVoiceDelegation` (same bubble + `prompt.submit` path as the composer, tagged `voice-live`, refuses a session id other than the live one); `useLiveVoice`; the `running` block on voice is lifted only for the live engine; `onVoiceAction` routes start/hang-up/stop-speaking; `talkToBob` also unlocks the live audio element; `VoiceControls` gets the mapped state + `live` flag; live hook receives `gatewayEvent`/`gatewayLost` next to the chained one (both gateway attach sites).
- `src/lib/voiceView.ts`, `src/components/VoiceControls.tsx`: optional `live` flag → "Start live voice" / "Hang up" / "Stop speaking" / "Bob is working. Keep talking." Chained labels unchanged (covered by a test).

Not touched: the unrelated dirty profile-scoped-chat work in `mockHermes.ts`, `storage.ts`, `styles.css` and their tests, `vite.config.ts`, `package.json`, scripts, `dist/`.

## Test evidence (this session)

```
npm run typecheck         → clean (tsc -b, exit 0)
npm test                  → Test Files 24 passed, Tests 465 passed (was 19 files before this work)
npm run build:candidate   → dist-candidate/assets/index-BAqKqk_r.js 497.71 kB (gzip 151.83 kB); dist/ mtime unchanged
npm run scan:secrets      → 0 findings in src/ or dist-candidate/ (all findings are pre-existing docs/ research/plan files; the script skips `dist` only, so dist-candidate IS scanned)
preview:candidate on 4180 → index 200, bundle contains the voice-live route; /hermes proxy forwards to 127.0.0.1:3456 (401 unauthenticated = route present)
```

Behaviours covered by offline tests (handoff step 7 list): mic denied; status 404/500 → chained;
session 503 → `unavailable`, 502 → `session-failed`, 401 → `auth-expired`, each with exactly one
exchange attempt (no retry); reconnect after error; barge-in mutes the remote track locally with no
data-channel send; "stop" keeps playback muted and never touches the agent turn; background
completion spoken exactly once; correction → `steerSession` (never a second submit) and a rejected
steer re-submits; cancel → `interruptSession` (never steer/submit); new work while working → queued,
acked, submitted after the result; other-session frames ignored; scope/profile change →
`release()` (sends `session.close`, stops tracks, closes peer); hidden → mic muted, torn down after
grace, cancelled by visible; gateway loss / provider close / hang-up all release; epoch guard on a
released session's callbacks; `dispose()` stops notifications.

## Not run (reported, not claimed)

- Physical iPhone: Safari audio unlock via the silent-WAV `play()` in the tap, `playsinline`,
  background/lock behaviour, echo cancellation with the speaker. **Not run.**
- Live provider: no WebRTC handshake was made against the gateway; no OpenAI session was created;
  no credits used. Barge-in timing, playback cancel latency and turn timing have **no evidence**
  (text simulation is not evidence for them — `voice-agent-operations` gate).
- Playwright e2e: not extended (the fake voice path still drives `FakeVoiceBackend`; live has no
  fake-client path because the mock client has no `voiceLiveStatus`).

## Known limits

- `gpt-live` is OpenAI-only and direct-key only (`voice.gpt_live.api_key` → `OPENAI_API_KEY` →
  pool). The Nous audio proxy has no `/live/sessions`. Without a key, `status.available` is false
  and the PWA stays on chained silently (no UI hint beyond the ordinary chained labels).
- The vite dev server has no proxy; live signalling only works through `tailnet-demo-server.mjs`
  (`preview:candidate`) or the dashboard origin.
- Utterance classification is regex-based (`classifyUtterance`): "cancel"/"never mind" always
  cancels running work; "no, …"/"actually …" only count as corrections while work is running. A
  request that merely contains "stop" ("stop the container") is new work. Expect misfires on
  unusual phrasing; the voice model's own delegation choice is the first filter.
- Barge-in unmutes playback when the user utterance settles (1.5 s quiet); the model's next reply
  can start slightly before that and lose its first fraction of a second.
- Results are spoken once on `message.complete` (not streamed sentence-by-sentence like desktop):
  long replies arrive as one paraphrased block.
- `session.interrupt` is wired through the optional `GatewayHandle.interruptSession`; the mock
  gateway has none, so cancel in mock mode says "stopped" without stopping anything (mock never
  reaches the live engine anyway).
- A delegation while a composer-typed turn is already running is routed as a correction/queue
  against that turn; the machine does not distinguish who started the turn.
- No streamed "Hermes is working: <tool>" thinking appends (desktop sends them); only the single
  spoken ack.

## Pilot steps (in order, each a gate)

1. On the host: `npm run preview:candidate` (serves `dist-candidate` on 4180, proxies `/hermes` →
   `127.0.0.1:3456`). Open from the phone over the tailnet, sign in, confirm chained voice still
   works exactly as before (status probe returns `available:false` today → chained).
2. Confirm the gateway can resolve an OpenAI key for the default profile and that
   `voice.voice_chat_mode: gpt-live` is set **only when Will authorises the live test** (config
   change is outside this build's scope). Then `GET /api/audio/voice-live/status?profile=default`
   from the signed-in phone should show `available:true`.
3. One authorised live test under the `voice-agent-operations` gates: one token attempt; the
   controller already latches (`CONNECT_FAILED` → `error`, no automatic retry; a new attempt needs
   another tap). Watch: ack once, result once, "stop" silences without killing the turn, "never
   mind" interrupts, lock the phone → mic paused and call torn down after 20 s.
4. Only after 3 passes: decide on streaming commentary, Playwright coverage for the live path, and
   whether to promote `dist-candidate` (never via `npm run build` without a separate decision).
