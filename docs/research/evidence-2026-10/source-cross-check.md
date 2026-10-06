# Source cross-check receipt

Date: 2026-10-06. Read-only local worker: `qwen3.8:27b-mlx`, native Hermes delegation `deleg_fa685df2`. Reported duration 540.08 seconds; 5 API calls. Token/cost data were not supplied. No fallback or product writes.

Parent verified the load-bearing findings by reading:
- `src/App.tsx:103–146`: restore and last-session promotion already exist; no automatic chat open.
- `src/App.tsx:229–243`: visibility/focus/periodic transcript refresh is not socket reconnect.
- `src/App.tsx:387–426`: socket-open becomes ready before resume; on-close asks for manual reopen.
- `src/App.tsx:475–535`: current renderer response sends clear the card immediately; submit/attachment error restores draft/files.
- `src/lib/hermesApi.ts:340–383`: exact create/resume/attach/submit/respond adapter operations; renderer response has no round-trip acknowledgement here.
- Earlier direct reads of `src/lib/jsonRpc.ts`, storage, and tool filtering corroborate the audit.

Worker overstatements were not adopted:
- “Touch targets ≥44/48px” is not universal: parent measured Back at 40×40px.
- “aria-compliant” is too broad: keyboard/ARIA source support is not a complete accessibility audit.
- “Secret/sudo requests never enter client” is inaccurate: request events reach the client; rendered sensitive values/fields are constrained. No blanket claim that sensitive data cannot arrive is made.
- Implemented resume plus manual reopen is not automatic reconnect or production proof.

The reports retain these distinctions. No private transcripts, credentials, or request values were collected. The worker's summary is not used as proof of live authenticated behavior.
