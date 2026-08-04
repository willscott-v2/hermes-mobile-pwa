# Architecture

Hermes Mobile PWA is a static React client with two data adapters:

1. `HermesApiClient` talks to a real Hermes dashboard.
2. `MockHermesClient` simulates sessions/chat for local development and public screenshots.

## Real protocol

The app uses:

- `GET /api/status` to confirm the URL is Hermes and inspect auth requirements.
- `GET /api/auth/providers` to detect password support when available.
- `POST /auth/password-login` for gated/password auth.
- `GET /api/sessions?limit=...&offset=...&order=recent` for the session list.
- `POST /api/auth/ws-ticket` before gated WebSocket connections.
- `WS /api/ws?ticket=...` or `WS /api/ws?token=...` for JSON-RPC.

Core JSON-RPC calls:

- `session.create`
- `session.resume`
- `prompt.submit`

The server streams events such as `gateway.ready`, `session.info`, `message.start`, `message.delta`, `message.complete`, tool/status events, approval/clarify prompts, and errors. Unknown events are shown as low-emphasis status rows instead of crashing.

## Browser deployment constraints

Same-origin deployment is easiest. Cross-origin browser clients depend on Hermes dashboard CORS and cookie settings. If cross-origin cookies are blocked, use token mode only on private trusted networks or serve the PWA from the dashboard origin.

## Service worker

The service worker caches static app-shell assets only. It bypasses `/api/`, `/auth/`, and non-GET requests so private chat/session data is never stored in Cache Storage.
