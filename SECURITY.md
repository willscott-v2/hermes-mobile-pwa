# Security Policy

Hermes Mobile PWA controls a user's self-hosted agent. Treat it like a remote shell control surface.

## Supported boundary

The intended deployment is private-network-first: same-origin with the Hermes dashboard or behind Tailscale/VPN. Public internet exposure is not recommended unless Hermes dashboard auth, TLS, DNS-rebinding protections, rate limits, and reverse-proxy headers are configured correctly.

## Credential handling

- Passwords are never persisted by this app.
- Password auth relies on Hermes httpOnly cookies and single-use WebSocket tickets.
- Token mode is high-risk. Persistent token storage is opt-in only.
- Never include real credentials, private server URLs, or private screenshots in issues or PRs.

## Reporting vulnerabilities

Open a private advisory or contact the maintainers out of band. Please include:

- affected version/commit
- reproduction steps
- expected vs actual behavior
- whether the issue requires same-origin, cross-origin, token mode, or password mode

## Development rules

- No `dangerouslySetInnerHTML` for assistant/tool/user content unless paired with a reviewed sanitizer and tests.
- No analytics/telemetry by default.
- Do not cache API responses in the service worker.
- Do not log tokens, cookies, passwords, raw authorization headers, or full URLs containing secrets.
