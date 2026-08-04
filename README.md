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
- service worker that caches only app shell assets, never API responses
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
- The service worker intentionally does not cache `/api/`, `/auth/`, or WebSocket traffic.

## Scripts

```sh
npm test              # unit tests
npm run typecheck     # TypeScript
npm run build         # production build
npm run smoke         # verifies dist files/markers
npm run scan:secrets  # simple public-release safety scan
```

## Roadmap

- richer Markdown/code rendering with sanitizer
- approve/deny and clarify cards wired to real pending-input frames
- file/photo attachments
- slash command palette
- profile switcher
- cron job controls
- Web Push, where browser support and deployment constraints allow it
