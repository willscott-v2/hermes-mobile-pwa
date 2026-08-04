# Public Release Audit

Date: 2026-08-04

## Scope

This audit covers the current tracked working tree for `hermes-mobile-pwa`, a static React/Vite PWA client for self-hosted Hermes Agent dashboards.

## Important publishing note

Do **not** publish this repository's existing git history. Earlier local commits contained a private Tailnet hostname in test/demo fixtures. The current working tree has been sanitized, but the public GitHub repository should be initialized from a fresh copy or orphan history so old local commits are not exposed.

## Sanitization performed

- Removed tracked `.hermes/` implementation planning notes from the public tree and added `.hermes/` to `.gitignore`.
- Replaced private Tailnet demo URLs with public-safe example/local URLs.
- Removed user-specific dashboard username guidance from `docs/AUTH_SETUP.md`.
- Changed the demo proxy default target to `http://127.0.0.1:9119`; real deployments must set `HERMES_DASHBOARD_TARGET` explicitly.
- Strengthened `npm run scan:secrets` to flag private Tailnet hostnames and local macOS home-directory paths.

## Scans run

- `npm run scan:secrets`
- tracked-tree grep for private Tailnet hosts, local user paths, GitHub/Slack token patterns, and private-user/project identifiers
- tracked-tree URL inventory review
- tracked-tree high-entropy token scan
- git-history grep for private Tailnet hosts/local paths

## Results

- Current tracked tree: no hardcoded credentials found.
- Current tracked tree: no private Tailnet hostnames or local user paths found outside scanner regex literals.
- Current tracked tree: URL inventory contains only public GitHub links, loopback/local examples, placeholder host examples, and `.example` / `.example.test` test domains.
- Current tracked tree: high-entropy token scan returned zero findings.
- Existing local git history: contains private Tailnet hostname references. Publish with fresh history only.

## License

MIT License is present in `LICENSE` with copyright assigned to Hermes Mobile PWA contributors.

## Verification gate

Before public publish, run:

```bash
npm run typecheck
npm test
npm run build
npm run smoke
npm run scan:secrets
npm run test:e2e
npm run qa:mobile
```

## Published repository

- URL: https://github.com/willscott-v2/hermes-mobile-pwa
- Visibility: public
- Public root commit: `5cc12f0673efdff50fb943f2e389b5cda0105cb3`
- Published with fresh git history; private local history was not pushed.

## Recommended GitHub publish flow

Create the public repository from a fresh export of the sanitized working tree, not this `.git` directory/history. Example:

```bash
mkdir -p /tmp/hermes-mobile-pwa-public
rsync -a --delete --exclude .git --exclude node_modules --exclude dist --exclude test-results \
  /path/to/hermes-mobile-pwa/ /tmp/hermes-mobile-pwa-public/
cd /tmp/hermes-mobile-pwa-public
git init
git add .
git commit -m "feat: initial public release"
gh repo create willscott-v2/hermes-mobile-pwa --public --source=. --remote=origin --push
```
