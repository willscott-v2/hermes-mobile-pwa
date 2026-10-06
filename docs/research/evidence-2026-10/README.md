# October 2026 research evidence

These are internal research artifacts, not a public-release bundle. Live URLs identify the private deployment; screenshots of the product use unauthenticated or synthetic data only. No real transcript or credential values were collected.

## Receipts

- `verification-recheck.txt`: retained full command chain, commit, live health, 37 unit tests, typecheck/build/smoke, 27 mobile Chromium E2E tests.
- `verification-final.txt`: closing live health check, whitespace gate, and zero product-source diff check.
- `live-served-mock-qa.txt`: fixture UI assertions against the actual Tailnet-served build; all measured states had zero horizontal overflow.
- `source-cross-check.md`: local worker's source findings, parent-verification anchors, and rejected overstatements.

## Live, unauthenticated

- `live-launch-metrics.json`, `live-connect-390.png`: actual 390×844 launch/form.
- `live-offline-observations.json`, `live-warm-offline-390.png`, `live-cold-offline-390.png`: browser-only outage emulation. Host services/Tailscale were not stopped; browser network restored.
- `official-dashboard-login.json`, `official-dashboard-login-390.png`: official dashboard login only, 390×844. Authenticated dashboard not inspected.

## Synthetic, not production protocol proof

- `synthetic-*.png`: named mock session/approval/clarify/composer states on the live-served build. Their sample text is test data.
- `synthetic-composer-metrics.json`: normal metrics plus an immediate post-resize measurement; the latter caught pre-layout bounds and must not be treated as a persistent defect.
- `synthetic-composer-settled-short.json`: authoritative settled 390×450 recheck; composer fits. This is not a physical iOS keyboard test.

Screenshots were copied outside `test-results` because a subsequent Playwright run can clear that output directory.

## Public benchmark evidence

- `sources.json`: numbered citation ledger, accessed 2026-10-06; quoted excerpts checked against saved source text.
- Matching product `.json` and `.txt` captures: primary page title/URL/body and plain evidence text. Product marketing examples are not hands-on native-app sessions.
- `conduit`, `fleet`, `vory`, `bighelp`, `hermex`, `cadu`: all requested Hermes client identities were fetched by the parent. Cadu's rendered homepage was recovered in a browser.
- `claude-remote`, `claude-mobile`, `linear-mobile`, `linear-notifications`, `gemini`, `hermes-dashboard-docs`: official documentation/product pages, not authenticated product sessions.
- `chatgpt-agent-archived`: Wayback snapshot **2026-10-03T08:01:35Z**, accessed 2026-10-06. The page contradicts itself on availability; not current-product proof.
- `chatgpt-agent`, `chatgpt-ui`, `openai-agent`, `chatgpt-work-access`: live access failures/interstitials, not usable product observations.
- `source-*` JSON files preserve earlier failed extraction-tool responses; **not** cited as fetched article evidence. The `source-mobile.json` basename was reused for failed attempts; use the unambiguous successful browser captures instead.

Citation verification uses `--evidence`. Ledger entries 1 (blocked live ChatGPT) and 12 (non-platform-specific Gemini discovery URL) are intentionally uncited; usable evidence is instead source 14 (dated archive) and 15 (exact iOS documentation). The uncited-source warnings are accounted for, not missing claims.
