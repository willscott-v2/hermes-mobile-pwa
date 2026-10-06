# Mobile agent benchmark — October 2026

**Research date:** 2026-10-06. **Decision:** borrow the return-to-work loop, not a native application's breadth.

Companion documents: [live PWA audit](current-pwa-experience-audit-2026-10.md) · [phased elegance plan](../plans/2026-10-mobile-pwa-elegance-plan.md).

## Executive judgment

The most relevant references are **Claude Code Remote Control for continuity**, **Hermes Fleet for honest coverage/state**, **Vory for readable progress and attention**, **Linear for focused away-from-keyboard triage**, and **Conduit for answer-first reading**. These are judgments about documented patterns, not a ranking of tested app performance.

For our PWA, opening the right active or recent conversation, reading its previous messages, understanding its current state, and moving it forward is a stronger first release than push, avatars, Kanban, or more administration screens. Moving it forward includes sending follow-ups after a concluded turn, supported mid-turn input, and resolving blockers. Our current approval/clarify components already exist; the remaining work is a coherent conversation journey and trustworthy state, not rebuilding cards. **Owner scope clarification, 2026-10-06:** this is not an unblock-only client; see Release 1 “Read and continue” in the plan. This clarification changes the recommendation, not the evidence of what competitors were inspected.

## Methodology and evidence limits

- Studied all six requested Hermes clients, the official dashboard, and four broader references: Claude Code on mobile/Remote Control, Linear Mobile, Gemini Live, and ChatGPT. Claude also supplies the remote-coding comparator; another coding product would add scope without filling a missing rubric dimension.
- Inspected public primary pages in a real browser; inspected Fleet's GitHub README. Read official product documentation, rather than equating store ratings or promotional claims with quality. No installation, enrollment, accounts, transactions, messages, or competitor product actions.
- Native-client research was delegated to the configured local worker. Its findings were discovery leads. The parent fetched every primary page used below; unverified store ratings, star counts, Android identity claims, and distribution assertions were omitted.
- Cadu's curl-only extraction failed in the worker; parent browser rendering recovered its homepage. This is not an unresolved access failure.
- The official dashboard was directly opened at the configured local dashboard on a **390 × 844** viewport. Only its sign-in surface was accessible. Its authenticated surfaces below are documentation claims, not hands-on findings.
- Our PWA was opened on its real Tailnet URL. Authenticated WebSocket flows remain unverified. Live-served mock flows prove UI behavior under fixtures, not production request delivery. See the audit for receipts.
- `web_extract` failed because the configured backend could not extract; public browser body-text extraction was the recovery. ChatGPT's live app and help pages showed a bot interstitial. A dated Wayback help snapshot was inspected instead; its contradictions materially lower confidence.
- **No measured competitor launch latency, reconnect reliability, keyboard ergonomics, notification delivery, or accessibility score is claimed.** No product earned an overall numerical quality score from marketing.
- Public text captures and the citation ledger live in [`evidence-2026-10/`](evidence-2026-10/). All live-page claims mean “the primary source documented this on the research date.” Unknown means not established from inspected evidence, not absent from the product.

### Evidence notation

- **UI:** direct live user-interface inspection.
- **DOC:** official technical/help documentation or repository README; behavior documented, not exercised.
- **SITE:** developer marketing page or interactive promotional representation; weaker than tested behavior.
- **ARCHIVE:** dated historical copy, not proof of present availability.
- **U:** untested or unsupported by this inspection.

## Product evidence cards

### 1. Conduit — continuity and room for the answer

**Inspected:** developer homepage, live SITE, 2026-10-06. It links to an iOS App Store listing and its public source; neither native binary nor store review claims were tested. The page says “Return to your conversations and switch between the profiles you already use,” and presents code, tables, math, and Mermaid as its reading surfaces.[6]

**Pattern judgment:** returning to existing work and giving rich answers room are more useful to us than recreating a desktop console. Session/profile continuity and a Kanban view are advertised; cold-launch behavior, approvals, notification privacy, and real keyboard behavior are not established by the landing-page inspection.[6]

- **Borrow now in the PWA:** an obvious Continue path; readable answer hierarchy.
- **Possible later with web-platform work:** safe rich-message rendering.
- **Native-only / reject:** SwiftUI implementation and copying the application's visual identity; Kanban is rejected for scope, not because the web cannot support it.
- **Confidence:** medium for represented capabilities, low for practical execution quality.

### 2. Hermes Fleet — never confuse unknown with empty

**Inspected:** public repository README, live DOC, 2026-10-06. It describes a native controller under active development and expressly distinguishes source capabilities from distributed builds. No release binary was installed. It documents eight top-level destinations, reconnect/replay handling, gateway-qualified identities, and capability-gated controls.[7]

The strongest passage is: **“Unknown never renders as zero.”** Its Needs You section is explicitly known-items-only; unseen rooms do not become a fabricated empty inbox. Continue is a device-local recent-open index, not claimed cross-device synchronization.[7]

- **Borrow now in the PWA:** separate known blocked items from incomplete coverage; qualify state by host/profile; keep unsupported actions unavailable.
- **Possible later with web-platform work:** richer delegated activity if the gateway exposes authoritative events.
- **Native-only / reject:** Keychain/SwiftData implementations; eight-tab fleet administration is rejected as product bloat for our single-host mobile job.
- **Confidence:** strong evidence of the documented design contract; runtime reliability and distributed-build coverage untested.

### 3. Vory — make the agent's phase legible

**Inspected:** developer homepage and its rendered interaction examples, live SITE, 2026-10-06. It advertises a public TestFlight beta, direct gateway connection, Messages-style streaming, tool cards, and approval actions from multiple native surfaces. The approval and notification examples on the website are representations, not a connected agent session.[8]

The useful semantic vocabulary includes **thinking, using a tool, needs you, writing, reconnecting, error, finished**. The page says an approval answered on one device clears on the other; that is an important consistency target, not something verified here.[8]

- **Borrow now in the PWA:** a compact phase label and separate Needs you state; expandable tool detail; an approval that clears only when resolved or cancelled authoritatively.
- **Possible later with web-platform work:** generic notification-to-session return path.
- **Native-only / reject:** Live Activities, Dynamic Island, menu-bar controls, iCloud setup sync, animated character customization, and broad configuration editing. Do not borrow “always approve” choices.
- **Confidence:** medium on documented interaction intent; low on cross-device delivery and reconciliation reliability.

### 4. bighelp — task-sized choices, not another console

**Inspected:** rendered developer homepage, live SITE, 2026-10-06. It represents one-to-one/group chat, scheduled tasks, voice, activity, approvals, and interactive replies. The most transferable claim is “Agents reply with cards and forms, so choosing is one touch.” It separately claims device-encrypted notification text and local turn-based transcription.[9]

**Pattern judgment:** concise clarify choices, a clear waiting state, and an outcome-centered response can reduce mobile effort. The website's hotel approval is a promotional interaction, not proof of a safe real purchase flow.[9]

- **Borrow now in the PWA:** compact choice cards with consequence and scope visible; keep the transcript around the decision.
- **Possible later with web-platform work:** voice input or richer structured replies after upload/auth/state are dependable.
- **Native-only / reject:** Apple Watch approval, native biometric credential storage, Live Activities; also reject content-bearing push even if a competitor encrypts it. Our contract permits generic state only.
- **Confidence:** medium on claimed patterns; low on delivered app behavior and privacy implementation.

### 5. Hermex — a useful boundary, but a different backend

**Inspected:** developer homepage and FAQ, live SITE, 2026-10-06. It explicitly states: **“It isn’t the dashboard that comes with Hermes Agent — Hermex needs hermes-webui.”** It advertises streaming, approvals, tasks/Kanban, workspace browsing, notifications, and a read-only cache of recent conversations.[10]

Its separation is useful: sending requires the server, while offline reading is presented as a different capability. But its backend and private conversation-cache model are not architectural defaults for our PWA.[10]

- **Borrow now in the PWA:** explain what the phone can and cannot do while disconnected; make server execution explicit.
- **Possible later with web-platform work:** a static offline guidance screen, **not** a copy of the private conversation cache.
- **Native-only / reject:** adopting `hermes-webui`, introducing a push relay by imitation, or publicly tunneling our service. The page's App Store rating is not used as a quality score.
- **Confidence:** high on documented backend distinction; medium on feature claims; app behavior untested.

### 6. Cadu — connect, choose an agent, continue

**Inspected:** browser-rendered developer homepage, live SITE, 2026-10-06. The page identifies an iOS/iPadOS client, links to TestFlight, and says “Connect your Hermes instance with a QR code or connection link.” Its illustrated sequence is connect → meet agents → converse/manage files/configure.[11]

The browser recovered text that a plain HTML fetch missed. No beta was joined. The page's agent/chat preview is promotional; it provides insufficient evidence for reconnect, approvals, notification delivery, or keyboard quality.[11]

- **Borrow now in the PWA:** a saved connection with understandable host identity and little repeated setup.
- **Possible later with web-platform work:** a credential-free, validated connection link if repeated setup actually proves a problem.
- **Native-only / reject:** install management from the phone and native distribution. Do not encode credentials in QR codes or URLs.
- **Confidence:** medium on setup/story; low for operational interaction depth.

### 7. Official Hermes web dashboard — authority and an escape hatch

**Inspected UI:** configured dashboard at `http://127.0.0.1:3456/`, redirected to `/login?next=%2F`, 390 × 844. Sign-in fields and “PUBLIC BIND · AUTH REQUIRED” were visible; horizontal overflow was zero. No authentication was performed. [Local evidence](evidence-2026-10/official-dashboard-login.json).

**Inspected DOC:** current official dashboard documentation. It describes profile-scoped management, explicit target identity, a narrow-screen slide-over session rail, and an embedded TUI chat over a PTY. Its management scope includes API keys, configuration, logs, schedules, skills, and channels.[13]

- **Borrow now in the PWA:** explicit host/profile identity and an honest distinction between reachability, authenticated access, and a resumed session.
- **Possible later with web-platform work:** a verified session-specific full-dashboard handoff, using the same origin/proxy and no auth material in URLs.
- **Native-only / reject:** no native component required, but reject copying the dashboard's administrative breadth or terminal UI into our mobile surface.
- **Confidence:** high for observed login only; DOC confidence for other features. Published docs do not prove our installed version has every route/capability.

### 8. Claude Code mobile / Remote Control — the strongest continuity contract

**Inspected:** two current official DOC pages, 2026-10-06; no subscription-backed session was launched. The mobile documentation says the app is a client, not a place where code runs. Remote Control documents session names/URLs/QR entry, phone attachments, cross-surface progress, and reconnect after the host or network returns.[2][3]

The crucial distinction is **execution location versus transport location**: execution stays on the user's machine, but Remote Control traffic passes through Anthropic and transcripts are stored there for synchronization. That is not our Tailnet-only architecture.[2]

Its limitations are useful evidence rather than a defect to hide: some commands remain local-only, forwarded dialogs have distinct lifetimes, and device/session takeover needs explicit handling. The mobile page documents push for completion/decisions, but delivery was not exercised.[2][3]

- **Borrow now in the PWA:** resume one exact session, show the machine context, make failed continuation understandable, and preserve local-only boundaries.
- **Possible later with web-platform work:** stop/steer or delegated-task views only against confirmed Hermes capabilities; generic return notifications.
- **Native-only / reject:** cloud relay/transcript synchronization architecture, bypass-permissions controls, and native push assumptions.
- **Confidence:** high on documented semantics/limitations; no comparative performance or mobile UI-quality claim.

### 9. Linear Mobile — attention as the primary mobile job

**Inspected:** product page plus notifications DOC, 2026-10-06. Linear frames mobile as away-from-keyboard work, with an inbox for high-priority updates, tap-to-act, snooze, and quick capture. Its documentation separates the persistent inbox from external notification channels.[4][5]

Notably, the inspected notification page says it **does not support new browser push subscriptions**. Do not infer web-push feasibility from its native mobile notifications.[5]

- **Borrow now in the PWA:** bounded attention/continue sections ahead of secondary creation controls; recoverable list position; compact state and a short route to action.
- **Possible later with web-platform work:** gentle re-engagement after a reliable in-app return path exists.
- **Native-only / reject:** copying swipe-only interactions or snoozing a security approval as though it were an ordinary task update. Approval state must remain server-authoritative.
- **Confidence:** medium/high on documented interaction model; no hands-on timing, tactile, or accessibility claim.

### 10. Gemini Live — explicit interruption and modality boundaries

**Inspected:** official iPhone/iPad help DOC, 2026-10-06. It documents an interruptible spoken conversation, Hold/End, resume/transcript headings, and camera/screen-sharing controls. It explicitly says: **“For now, Gemini Live isn’t available in the Gemini web app.”** Availability is staged.[15]

- **Borrow now in the PWA:** explicit busy-state semantics: the user should know whether a message is being sent, accepted, or waiting. Do not present silence as progress.
- **Possible later with web-platform work:** intentional foreground dictation with permission and capability checks.
- **Native-only / reject:** promised lock-screen/background listening, system-wide screen sharing, or a Gemini-like voice runtime in our thin PWA.
- **Confidence:** high that these are documented mobile-app controls; PWA equivalence is explicitly unsupported. No voice latency or quality measurement.

### 11. ChatGPT — access-limited, not a current benchmark winner

**Attempted live UI:** `https://chatgpt.com/`, OpenAI's agent introduction, and current help pages. They returned “Just a moment…” interstitials rather than usable UI. No login or product flow was inspected.

**Inspected historical source:** Wayback snapshot dated **2026-10-03 08:01:35 UTC** of OpenAI's agent help article, fetched 2026-10-06. It describes interruptibility, high-impact confirmations, and a separate sensitive-input takeover surface. However, its overview says “ChatGPT agent is no longer available” while later sections still list availability and setup instructions. Its linked ChatGPT Work page was also blocked live.[14]

**Conclusion:** current product availability/quality is unresolved here. Retain only the historical design lessons: separate sensitive input from ordinary conversation and make interruption/confirmation explicit. Neither lesson is uniquely dependent on ChatGPT evidence. Do not recommend copying an apparently retired mode or extrapolate to ChatGPT Work.[14]

- **Borrow now in the PWA:** the general sensitive-input boundary, already partly implemented locally.
- **Possible later with web-platform work:** controlled interruption, independently capability-gated.
- **Native-only / reject:** cloud-browser takeover as a new mobile product, or current-performance claims from this archive.
- **Confidence:** low for current ChatGPT; historical/document-level only.

## Consistent comparison matrix

Two panels keep the same nine-part rubric readable. All product behavior below inherits its evidence class; **U is not a negative score**. Every launch-speed and real keyboard measurement is U. Source IDs refer to the evidence cards.

### Rubric 1–4: getting in and conversing

| Product / evidence | 1. Launch / reconnect | 2. Information architecture | 3. Conversation readability | 4. Composer |
|---|---|---|---|---|
| Conduit · SITE [6] | Return to existing sessions claimed; recovery U | Sessions/profiles + Kanban | Code/tables/math/diagrams represented | Real input/busy behavior U |
| Fleet · DOC [7] | Reconnect/replay; incomplete coverage explicit | Eight destinations; local Continue; source-qualified identity | Streaming documented; narrow-screen reading U | Attachments/on-device voice documented; keyboard U |
| Vory · SITE [8] | Saved gateways; reconnect phase; same-chat continuity claimed | Bots, chats, Home, projects; broad settings | Streaming, unfoldable reasoning, tool cards | Attach, slash commands, dictation, mid-reply steering claimed |
| bighelp · SITE [9] | Pick up same chats claimed; recovery U | Chats/groups/tasks | Cards/forms and media represented | Voice represented; send/stop semantics U |
| Hermex · SITE [10] | URL/password setup; offline read-only cache claimed | Sessions/tasks/Kanban/workspace | Streaming represented; long-answer quality U | Input/keyboard quality U |
| Cadu · SITE [11] | QR/link setup; restore U | Agents/conversations/files | Promotional preview only | Input/keyboard quality U |
| Official dashboard · UI + DOC [13] | Live sign-in reached; authenticated restore U | Profile scope; sessions rail + many admin pages | TUI chat; Markdown session inspection documented | TUI controls documented, real mobile keyboard U |
| Claude Code · DOC [2][3] | Named session/QR return; reconnect documented | Code tab, local/cloud distinctions | Conversation and delegated progress synchronized | Photos/files, questions, steering documented; keyboard U |
| Linear · SITE + DOC [4][5] | Launch/reconnect U | Attention inbox and focused mobile tasks | Issue/update reading represented, not chat | Quick capture and screenshots represented |
| Gemini Live · DOC [15] | Hold/resume controls documented; network recovery U | Live/non-Live modes | Voice with transcript/caption controls | Voice interruption, Hold/End; not web Live |
| ChatGPT · ARCHIVE [14] | Live blocked; current availability unresolved | Historical tools/menu/schedules | Historical answer/source output; current U | Historical `/agent`, interrupt, takeover; current U |

### Rubric 5–9: understanding, acting, trusting

| Product / evidence | 5. Agent progress | 6. Attention / approvals | 7. Re-engagement | 8. Trust / control | 9. PWA fit |
|---|---|---|---|---|---|
| Conduit [6] | U | U from inspected page | U | User-owned dashboard boundary stated | Borrow continuity/readability; rich rendering later |
| Fleet [7] | Known work vs stale/unknown | Known reported attention; capability gates | Delivery/privacy U | Gateway-qualified identity; fail closed | Borrow honesty; reject fleet-admin breadth |
| Vory [8] | Distinct named phases | Inline card; cross-device clearing claimed | Native notifications/Live Activities via companion | Direct gateway; Keychain claim | Borrow phases; generic web return later; native surfaces reject |
| bighelp [9] | Task-sized activity represented | Choice cards; risky actions wait for yes | Native surfaces; encrypted content claim | Device Keychain/local transcription claims | Borrow choices; reject native/wrist and content-push model |
| Hermex [10] | U in inspected detail | Approval support claimed; semantics U | Optional relay; encrypted-text claim | Different backend explicitly stated | Borrow disconnected boundary; reject backend/cache migration |
| Cadu [11] | Activity advertised; semantics U | U | U | Own instance and retained tools/files/memory | Borrow simple setup; QR later, management reject |
| Official dashboard [13] | Runtime/status/tool detail documented | TUI prompts documented, live U | U in inspected scope | Profile banners; password auth observed | Borrow identity; validate safe handoff later |
| Claude Code [2][3] | Subagents/workflows and state sync documented | Remote questions/permissions, local-only boundaries | Native push documented | Local execution, cloud transport/storage explicitly distinct | Borrow continuity; do not copy cloud relay |
| Linear [4][5] | Work-item status, not agent execution | Inbox triage, not security approvals | Inbox plus native/email/Slack; new web push unsupported | Notification preferences; auth recovery U | Borrow focused attention; reject unqualified push analogy |
| Gemini [15] | Spoken activity; agent-tool detail U | Task-approval details U | Background/lock-screen controls documented for native | Permission/account boundary; no web Live | Borrow busy clarity; foreground voice later; background reject |
| ChatGPT [14] | Historical guided/interruptible work | Historical confirmations/sensitive takeover | Current U | Historical risk warnings; source conflicts | Borrow principle only; no current product-quality claim |

## Patterns to transfer, in order

1. **Return with certainty.** Saved host + resumable conversation + explicit restoration stage. Basis: Claude continuity and Fleet's coverage honesty; local offline/restore weakness in audit A1–A3.
2. **Needs you outranks “ready.”** A server-reachable pill must not mask a blocked task. Basis: Vory phases, Fleet known attention, local approval screenshot; audit A5.
3. **One clear, bounded decision.** Keep safe command/question context with the answer choices; show pending/confirmed/unavailable accurately. Basis: bighelp cards and local already-implemented attention controls; audit A5.
4. **Continue before configure.** A compact known-attention/continue block and recency beat eight tabs or full-width creation as the dominant mobile action. Basis: Linear and Conduit; audit A4.
5. **Answer first, activity summarized.** Collapse safe activity under the response without erasing meaningful final content. Basis: Conduit/Vory and local tool-filtering gap; audit A6.
6. **Re-engage only into a working return path.** Push is not the first fix for failed restore. Basis: Claude mobile notifications and Linear's persistent inbox/channel separation; local auth and return-path gaps.

## Attractive patterns we should not copy

- Native Live Activities, Dynamic Island, Watch approval, widgets, Keychain assumptions, iCloud setup sync, CarPlay, App Store distribution, or a phone-side agent runtime.
- Full configuration, API-key, MCP, skill-install, multi-gateway/fleet, Kanban, or plugin administration simply because competitors advertise them.
- Cloud relay/transcript synchronization or a switch to `hermes-webui` to match another client.
- Private conversation caches, content-bearing notifications, or credentials in connection links.
- Approve-all/always-approve, automatic response retry after uncertain delivery, or treating incomplete attention coverage as “all clear.”
- Decorative character systems before reconnect, identity, and the approval loop are dependable.

**Scope:** the research supports a small first release. It does not establish a competitor speed winner, prove authenticated behavior in our installation, or authorize implementation.

## Sources

[2] https://code.claude.com/docs/en/remote-control
[3] https://code.claude.com/docs/en/mobile
[4] https://linear.app/mobile
[5] https://linear.app/docs/notifications
[6] https://hermesconduit.app
[7] https://github.com/AIowa-LLC/hermes-fleet
[8] https://vory.dev
[9] https://bighelp.app
[10] https://hermexapp.com
[11] https://cadu.bot
[13] https://hermes-agent.nousresearch.com/docs/user-guide/features/web-dashboard
[14] https://web.archive.org/web/20261003080135/https://help.openai.com/en/articles/11752874-chatgpt-agent
[15] https://support.google.com/gemini/answer/15274899?hl=en&co=GENIE.Platform%3DiOS
