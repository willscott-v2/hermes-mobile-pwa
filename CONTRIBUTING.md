# Contributing

Thanks for helping improve Hermes Mobile PWA. This project is intentionally small, mobile-first, and security-conscious because it controls a self-hosted agent.

## Development setup

```bash
git clone https://github.com/willscott-v2/hermes-mobile-pwa.git
cd hermes-mobile-pwa
npm install
npm run dev
```

Use **Mock** mode for most UI work. Mock mode avoids private dashboards, credentials, and real session data.

## Before opening a PR

Run the full verification gate:

```bash
npm run typecheck \
  && npm test \
  && npm run build \
  && npm run smoke \
  && npm run scan:secrets \
  && npm run test:e2e \
  && npm run qa:mobile
```

For UI changes, include at least one screenshot or screen recording. `npm run qa:mobile` writes mock-mode screenshots to `test-results/manual-mobile-ux/`; copy only sanitized images into docs or PR comments.

## Public-safe fixture rules

Do not commit:

- real Hermes dashboard URLs or private Tailnet hostnames
- session IDs, transcripts, logs, or screenshots from private systems
- `.env` files or copied config files
- tokens, passwords, password hashes, cookies, authorization headers, provider API keys, or connection strings
- local paths that reveal private usernames or machine names

Use these instead:

- `http://127.0.0.1:9119`
- `http://<tailnet-host>:9119`
- `https://agent.example`
- `https://hermes.example.test`
- mock session titles/messages from `src/lib/mockHermes.ts`

## Code guidelines

- Keep the browser client thin. Agent logic belongs in Hermes Agent, not in this PWA.
- Treat dashboard responses and chat content as untrusted data.
- Do not use `dangerouslySetInnerHTML` for user/assistant/tool content unless a sanitizer and tests are included.
- Do not cache `/api/`, `/auth/`, WebSocket, or non-GET traffic in the service worker.
- Prefer mobile-first behavior over desktop-dashboard parity.
- Add tests for transcript filtering, link preservation, attachments, and mobile layout regressions.

## Maintainer workflow: clean repo is canonical

The public GitHub repo is the canonical development repo:

```text
https://github.com/willscott-v2/hermes-mobile-pwa
```

Local recommended path: use a clean clone of the public GitHub repo, separate from any older private checkout.

The earlier private/local repository had useful development history but included old private Tailnet fixture references. Do not push that history. Keep it only as a private archive/reference.

If a fix is accidentally made in an old/private checkout:

1. Copy only the intended source changes into the clean public checkout.
2. Do not copy `.git`, `.hermes`, `dist`, `test-results`, `node_modules`, `.env*`, logs, screenshots, or local state.
3. Run `npm run scan:secrets` plus the full verification gate.
4. Commit and push from the clean public checkout only.

Useful one-way sync pattern from a private checkout into a clean checkout:

```bash
rsync -a --dry-run \
  --exclude .git \
  --exclude .hermes \
  --exclude node_modules \
  --exclude dist \
  --exclude test-results \
  --exclude '.env*' \
  /path/to/private-checkout/ /path/to/public-checkout/
```

Remove `--dry-run` only after reviewing the file list.

## PR review checklist

- [ ] No public-safety scan findings.
- [ ] No private screenshots, local URLs, session IDs, transcripts, logs, or credentials.
- [ ] Typecheck/tests/build/smoke/e2e/mobile QA pass.
- [ ] UI changes include mock-mode screenshots or a short recording.
- [ ] Auth/security behavior is documented when changed.
- [ ] Mobile layout remains usable on narrow iPhone-sized viewports.
