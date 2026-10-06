# Hermes Mobile PWA

A mobile-first progressive web app for controlling a self-hosted [Hermes Agent](https://github.com/NousResearch/hermes-agent) from a phone without Xcode, TestFlight, or iOS-specific dependencies.

This repo is intentionally a thin client: no agent logic runs in the browser. The app talks to a Hermes dashboard over REST and `/api/ws` JSON-RPC.

## Status

Initial MVP. Working pieces:

- mobile-first installable PWA shell
- safe connection screen with password/token/mock modes
- recent session list
- live chat screen with WebSocket JSON-RPC adapter
- mock mode for development and screenshots without a Hermes server
- no active service worker: `src/registerServiceWorker.ts` unregisters workers and clears caches on load (offline shell is a later project); API responses are never cached
- TypeScript tests and secret scan

## Recommended deployment

Run it same-origin with the Hermes dashboard or behind a private network/VPN such as Tailscale. Do **not** expose your Hermes dashboard or this client to the open internet without a real authentication boundary.

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:5178` for local development.

To connect to a real Hermes server, run the dashboard on a reachable private address with username/password auth enabled:

```sh
hermes dashboard --host 0.0.0.0 --port 9119 --no-open
```

Then enter `http://<tailnet-host>:9119` in the app.

## Auth model

See [`docs/AUTH_SETUP.md`](docs/AUTH_SETUP.md) for operator setup instructions.

- **Password mode:** preferred. The app posts to `/auth/password-login`; Hermes returns httpOnly cookies. The app mints a fresh `/api/auth/ws-ticket` before opening `/api/ws`.
- **Token mode:** experimental compatibility hook only. The ordinary `API_SERVER_KEY` is for the separate OpenAI-compatible API server and does **not** authenticate the dashboard `/api/sessions` + `/api/ws` endpoints used by this PWA.
- **Mock mode:** demo adapter; no network calls, no credentials.

## Open-source safety notes

- Do not commit real Hermes server URLs, session IDs from private systems, tokens, screenshots with personal data, or `.env` files.
- API responses and chat content are treated as untrusted data.
- Assistant/tool output is rendered as text in this MVP. No server-provided HTML is injected into the DOM.
- There is currently no registered service worker and no Cache Storage; `/api/`, `/auth/`, and WebSocket traffic are never cached. Local storage holds only the server URL, a login hint, an optional remembered token, and a host/base-path/profile-scoped *Continue* reference (session id + title). Private previews/transcripts are not persisted; **Forget this device** on the Connect screen clears only this app's keys.

## Scripts

```sh
npm test              # unit tests
npm run typecheck     # TypeScript
npm run build         # production build into dist/ — WARNING: the live LaunchAgent serves dist/ directly, so this deploys
npm run build:candidate   # build into dist-candidate/ (never served live)
npm run preview:candidate # serve dist-candidate on 127.0.0.1:4180 with /hermes -> 127.0.0.1:3456
npm run smoke         # verifies dist files/markers (HERMES_PWA_DIST=dist-candidate to check a candidate)
npm run scan:secrets  # simple public-release safety scan
```

## Roadmap

See [`docs/FEATURE_WISHLIST.md`](docs/FEATURE_WISHLIST.md) for the prioritized mobile-control-surface wishlist.

Current top priorities:

- approval/clarify attention cards wired to real pending-input frames
- pending prompt restore/replay support on session resume
- authenticated restore/WebSocket coverage in `npm run check:daily`
- compact tool activity with expand-on-tap
- Web Push re-engagement, where browser support and deployment constraints allow it
- better Tailscale/setup diagnostics
- clipboard screenshot paste where browser APIs allow it
- session pin/rename/archive/delete actions
- TTS/audio playback bubbles for generated media
- slash command palette

## Release 1: Read and continue (candidate, not yet deployed)

- Opening a session loads its newest 120 raw messages from `GET /api/sessions/{id}/messages?order=latest`; **Load older messages** pages backward (offset counted from the newest) with a stable reading anchor; the beginning is marked only when the server returns fewer rows than requested. Refresh merges the newest page and keeps already-loaded older pages.
- Header states are derived from evidence: *Server reachable* ≠ *Signed in* ≠ *Ready*; *Running* comes from `session.resume`'s `running` flag; *Needs you* overrides everything else.
- After a turn completes the composer sends an ordinary follow-up in the same session. While a turn is running the composer offers **Queue** (`prompt.submit` with `queued: true`) and **Steer** (`session.steer`); a bare `prompt.submit` is never sent mid-turn because the host's `busy_input_mode: interrupt` would interrupt the live turn. Unsupported steer keeps the draft and says so.
- Approval/clarify responses show *sent; checking status* until a gateway cancel/expire frame or continued output confirms them; a second tap can never send a second response. The client advertises `client.capabilities {server_requests:true}` on every connection (required by the installed gateway) and hands back requests it cannot render (sudo/secret/multi-select) with error 4404 so the agent is not left waiting on the phone. Stop/interrupt is intentionally not exposed.
