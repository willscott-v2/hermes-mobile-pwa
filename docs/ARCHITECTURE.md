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

No service worker is active. `src/registerServiceWorker.ts` deliberately unregisters any prior worker and deletes caches to avoid stale builds; `public/sw.js` is retained but dormant. A versioned static-only offline shell is a later project (see the elegance plan, E6). Nothing from `/hermes`, `/api/`, `/auth/`, or the WebSocket is ever cached.

## Release 1 client state (read and continue)

- `src/lib/connectionState.ts` — pure mapping from connection facts (reachable, authenticated, socket, resumed, running, attention) to the header label; `chatReady` is true only when resumed, socket open, idle, and no attention.
- `src/lib/history.ts` — pure history reducer: initial / older (prepend, dedupe by durable row id) / refresh (replace the overlapping tail, keep older pages); results carrying a different `baseUrl|profile|sessionId` scope key are discarded.
- `src/lib/attentionState.ts` — one request per session: waiting → submitting → sent-unconfirmed → resolved/cancelled, reconciled from `request.cancel` / `*.expire` / message events and from `session.resume` open requests.
- `src/lib/storage.ts` — schema v2: a scoped Continue reference only; legacy global session cache and last-session keys are removed on first load; `forgetThisDevice()` removes only `hermes-mobile-pwa.*` keys.
- `src/lib/hermesApi.ts` — `sessionHistoryPage` (backward paging), structured `ResumeResult` (`running`, open request keys), `queuePrompt` / `steerSession` built on verified gateway methods, `HttpError` with status for auth/not-found classification. The installed-protocol inventory is in `docs/research/evidence-2026-10/release1/installed-protocol-inventory.md`.
