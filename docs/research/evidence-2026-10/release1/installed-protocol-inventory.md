# Installed gateway protocol inventory — Release 1 (read-only source inspection)

Inspected 2026-10-06 against the running install at `~/.hermes/hermes-agent` (git `648a309255`), the same tree the live `hermes dashboard --port 3456` process imports. Source inspection only; no RPCs were sent, no config changed. Line numbers are from that checkout.

## REST history paging — VERIFIED

`hermes_cli/web_routers/sessions.py:685–729` `GET /api/sessions/{id}/messages`

- Query: `limit` (clamped to 500), `offset`, `order` ∈ `oldest|latest`, `profile`, `include_compacted`, `inline_images`.
- `order=latest`: pages **backward from the newest** (`offset` counted from the newest message) but returns rows in **chronological order** (`hermes_state_messages.py:1384–1409`, `rows[::-1][offset:][:limit][::-1]`).
- Response: `{session_id, profile, messages, pagination:{limit, offset, order, returned}}`. **No total.** True beginning is only knowable when `returned < limit`.
- `include_ancestors=True` is forced: compression ancestors are merged root→tip, so a descendant's page already includes the pre-compaction transcript (`:703–711`). The id is first resolved through `db.resolve_resume_session_id` (`:697`).
- Each row is `dict(row)` (`hermes_state_messages.py:1311–1333`): includes durable `id`, `session_id`, `role`, `content`, `timestamp`, `tool_calls`, `tool_name`, `tool_call_id`, `display_kind`, `display_metadata`. The display projection may add `display_kind: "hidden"` and `display_content` (`sessions.py:617–682`); steer rows carry `display_kind: "steer"` with the user's words in `display_content`.
- `GET /api/sessions/{id}/latest-descendant` (`:547`) → `{session_id, path}` newest child leaf. `/api/sessions` list limit is `le=100` (`:175–179`).

Consequence for the client: backward paging = `order=latest&limit=L&offset=k·L`; dedupe by durable `id`; honour `display_kind: hidden` and `display_content`; mark "beginning" only when `returned < limit`. Message counts can be stale after compression, so never compute offsets from `message_count`.

## session.resume — VERIFIED

`tui_gateway/methods_session.py:872–914`. Result includes `session_id`, `resumed`/`session_key`, `message_count`, `messages`, `running`, `status` (`idle|streaming|…`), `inflight`, `started_at`; `open_requests` are available via the replay/open-request path used by the existing client. Reattach **attaches alongside existing viewers; it does not take the slot from them** (`session_lifecycle.py:829–847`, `_rebind_live_transport`: "Attach a live peer without displacing existing subscribers"). A stale handle returns error 4007 "session no longer live; retry resume" (`:818–826`).

Consequence: after resume the client must use `running` from the result instead of assuming ready. A mobile resume of a Desktop-driven session is a viewer, not a competing runtime.

## prompt.submit — VERIFIED

`tui_gateway/methods_prompt.py:681–772`.

- Idle session: admits the turn and returns `{status:"streaming"}` immediately (`methods_prompt.py` ~`:831`); completion arrives later as `message.complete`. Acceptance and execution are separable.
- Running session: `_handle_busy_submit` (`tui_gateway/session_auto_continue.py:400–452`) applies `display.busy_input_mode`. The **live config on Bob's House is `busy_input_mode: interrupt`** (`~/.hermes/config.yaml:259`), which means a bare `prompt.submit` during a running turn would **redirect or hard-interrupt** the live turn. A bare submit is therefore unsafe for a remote surface.
- `params.queued: true` forces queue mode regardless of config (`:406`): the text is enqueued, persisted at accept time, and drained after the turn; returns `{status:"queued"}` (`:437–452`). Attachments fall through to queue without cancelling (`:443`).
- Error 4009 "session busy" only for truncation/rewind submits; 4091 for hosted room members; 5035 backend retiring.

## session.steer — VERIFIED

`tui_gateway/methods_session.py:2438–2476`. Params `{session_id, profile?, text}`.

- 4002 if `text` empty. Session errors from `_sess_nowait`.
- If compression is in flight → enqueued as a next prompt, returns `{status:"queued"}` (`:2460–2463`).
- If agent lacks `steer` → error **4010** "agent does not support steer".
- If session is **not running** → `{status:"rejected"}` (idle agents cannot be steered; client should treat it as a normal next prompt) (`:2468–2469`).
- Accepted → `{status:"queued", text}` (the method's accepted status string is literally `queued`; see `_apply_correction` `:2419–2435`). Steer injects the text into the next tool result without interrupting or creating a new user turn.

`session.redirect` and `session.interrupt` exist (`:2478`, `:2380`) but Stop/interrupt is out of Release 1 scope and must not be exposed.

## Socket close while running — VERIFIED

Closing the PWA socket parks the session on a detached-transport sentinel; the orphan reaper does **not** interrupt healthy running work (`session_lifecycle.py:850–857`, `_ws_orphan_turn_activity_is_fresh`). Another live viewer (Desktop) keeps the session attached.

## Supported / unsupported for Release 1

| Capability | Status | Client contract |
|---|---|---|
| Backward history paging | Supported | `order=latest`, offset from newest, `returned<limit` = beginning |
| Lineage merge | Supported server-side | ancestors merged into the descendant page; client keeps selected vs live id explicit |
| Follow-up after `message.complete` | Supported | ordinary `prompt.submit`; `{status:"streaming"}` = accepted |
| Queue during running turn | Supported | `prompt.submit` with `queued:true`; `{status:"queued"}` = accepted, not executed |
| Steer during running turn | Supported, agent-gated | `session.steer`; `queued`=accepted, `rejected`=not running, 4010=unsupported |
| Bare submit during running turn | **Unsafe** | would interrupt under live `busy_input_mode: interrupt`; never send |
| Response acknowledgement for renderer requests | None | existing `peer.respond` is a one-way frame; show "sent; checking status" and rely on subsequent events/resume |
| Stop / interrupt | Exists, out of scope | not exposed |

## Addenda verified during the authenticated pass

- **Event framing:** `_event_frame` (`tui_gateway/server.py:693–696`) sends `{method:"event", params:{type, session_id, payload}}`; delta text is `payload.text`, completion text `payload.text`, status lines `status.update {kind, text}` (`heartbeat` kind is noise).
- **Identity:** `session.create` → `{session_id (live), stored_session_id (durable), …}`; `session.resume` → `{session_id (live), session_key/resumed (durable), running, status, …}`. REST and Continue references use the durable key; `prompt.submit`/`session.steer` use the live id.
- **Server-request delivery:** requires `client.capabilities {server_requests:true}` per connection (`methods_voice.py:442–450`); otherwise requests are failed fast as undeliverable. A client that cannot show a request answers error 4404 (`server_requests.py NOT_SHOWN_CODE`).
- **Result contracts** (`contracts/server_requests.py`): clarify `{answers:{qid: answer|null}}` (no `answers` = cancel-all); approval `{choice: once|session|always|deny, all?}`; sudo/secret `{value}` ('' = declined) — not used by the PWA.
