import { AuthSession, ChatMessage, classifyAttachment, GatewayCallbacks, GatewayHandle, HermesSession, HistoryPage, HttpError, PreparedAttachment, ResumeResult, RuntimeOptions, RuntimeSelection, ServerStatus, SessionPage } from './hermesApi';

const LONG_HISTORY_TOTAL = 300;
const LONG_HISTORY_ID = 'mock-long-history';
const RUNNING_BUILD_ID = 'mock-running-build';

const RAW_MOCK_SESSIONS: HermesSession[] = [
   { id: LONG_HISTORY_ID, title: 'Long research thread', preview: 'A long conversation to test older-message loading.', updated_at: new Date().toISOString(), message_count: LONG_HISTORY_TOTAL, running: false, source: 'mock' },
   { id: RUNNING_BUILD_ID, title: 'Running build', preview: 'Hermes is still working on this one.', updated_at: new Date().toISOString(), message_count: 4, running: true, source: 'mock' },
   { id: 'mock-weekend-reading', title: 'Weekend reading', preview: 'Summarize the three articles I saved about better sleep.', updated_at: new Date().toISOString(), message_count: 6, running: false, source: 'mock' },
   { id: 'mock-lisbon-trip', title: 'Lisbon trip', preview: 'Find 3 well-rated hotels under €150.', updated_at: new Date(Date.now() - 1000 * 60 * 48).toISOString(), message_count: 9, running: true, source: 'mock' },
   { id: 'mock-deployment-question', title: 'Deployment question', preview: 'Hermes needs a short custom answer.', updated_at: new Date(Date.now() - 1000 * 60 * 55).toISOString(), message_count: 5, running: true, source: 'mock' },
   { id: 'mock-campaign-regions', title: 'Campaign regions', preview: 'Choose more than one launch region.', updated_at: new Date(Date.now() - 1000 * 60 * 75).toISOString(), message_count: 5, running: true, source: 'mock' },
   { id: 'mock-cron-digest', title: 'Morning news digest', preview: 'Cron job output from this morning.', updated_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), message_count: 3, running: false, source: 'cron' },
   { id: 'mock-interrupted-approval', title: 'Interrupted approval', preview: 'An approval snapshot is missing its response handle.', updated_at: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), message_count: 3, running: true, source: 'mock' },
   { id: 'mock-deny-only-approval', title: 'Deny-only approval', preview: 'This blocked command cannot be approved once.', updated_at: new Date(Date.now() - 1000 * 60 * 60 * 4.5).toISOString(), message_count: 3, running: true, source: 'mock' },
   { id: 'mock-current-approval', title: 'Current gateway approval', preview: 'A current-protocol approval can be answered from mobile.', updated_at: new Date(Date.now() - 1000 * 60 * 60 * 4.75).toISOString(), message_count: 3, running: true, source: 'mock' },
   { id: 'mock-deployment-credentials', title: 'Deployment credentials', preview: 'A deployment is waiting for a secret.', updated_at: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), message_count: 4, running: true, source: 'mock' },
   { id: 'mock-system-update', title: 'System update', preview: 'A system update is waiting for sudo.', updated_at: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), message_count: 4, running: true, source: 'mock' },
   // A private default-only session that must stay out of any non-default profile view.
   { id: 'mock-private-default', title: 'Private default task', preview: 'Kept out of sales-test by exact profile scoping.', updated_at: new Date(Date.now() - 1000 * 60 * 60 * 8).toISOString(), message_count: 2, running: false, source: 'mock', profile: 'default' },
   // The same id under default and under sales-test: two distinct rows.
   { id: 'mock-shared-id', title: 'Shared task', preview: 'The default shared task.', updated_at: new Date(Date.now() - 1000 * 60 * 60 * 9).toISOString(), message_count: 1, running: false, source: 'mock', profile: 'default' },
   { id: 'mock-shared-id', title: 'Shared task (sales view)', preview: 'Same session id under sales-test.', updated_at: new Date(Date.now() - 1000 * 60 * 50).toISOString(), message_count: 1, running: false, source: 'mock', profile: 'sales-test' },
   { id: 'sales-campaign', title: 'Launch campaign', preview: 'Sales launch plan under the sales-test profile.', updated_at: new Date(Date.now() - 1000 * 60 * 40).toISOString(), message_count: 3, running: false, source: 'mock', profile: 'sales-test' },
];

// The real gateway hands out a live session id distinct from the stored (history) id, and tags every
// message frame with it at the top level. The mock mirrors both so voice can be proven against them.
export const mockLiveId = (storedId: string) => `live-${storedId}`;

function normalizeProfileTag(profile?: string): string {
  const value = profile?.trim();
  return value || 'default';
}

// Untagged rows are the default profile.
const sessions: HermesSession[] = RAW_MOCK_SESSIONS.map((row) => (row.profile ? row : { ...row, profile: 'default' }));

// Mirrors the real store: a hidden (Bot Mode identity) chat is excluded from the ordinary
// listing but reachable through the profile-scoped server search and by exact id. Mock
// data only; no personal content.
const HIDDEN_MOCK_SESSIONS: HermesSession[] = [
  { id: 'mock-hidden-bot-chat', title: 'Bot Chat', preview: 'Hidden canonical chat, reachable through search only.', updated_at: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(), message_count: 33, running: false, source: 'cli', profile: 'default' },
];
const allSessions: HermesSession[] = [...sessions, ...HIDDEN_MOCK_SESSIONS];

function filterSessionsByProfile(rows: HermesSession[], profile?: string): HermesSession[] {
  if (!profile || !profile.trim()) return rows;
  const target = normalizeProfileTag(profile);
  return rows.filter((row) => normalizeProfileTag(row.profile) === target);
}

export class MockHermesClient {
  readonly baseUrl = 'mock://hermes';
  private holdNextDetail = false;
  private releaseHeldDetail: (() => void) | null = null;
  private holdNextPage = false;
  private releaseHeldPage: (() => void) | null = null;
  private holdNextSubmit = false;
  private rejectHeldSubmit: ((error: Error) => void) | null = null;

  constructor() {
    // Test hooks (mock mode only; this class is never constructed against a real host): make the next
    // `sessionDetail` call wait until released, so tests can interleave navigation with a slow request.
    if (typeof window === 'undefined') return;
    const hooks = window as unknown as { __mockHoldNextSessionDetail?: () => void; __mockReleaseSessionDetail?: () => void };
    hooks.__mockHoldNextSessionDetail = () => { this.holdNextDetail = true; };
    hooks.__mockReleaseSessionDetail = () => { this.releaseHeldDetail?.(); this.releaseHeldDetail = null; };
    // Same idea for the session list (a profile switch is "loading" until released) and for
    // `submitPrompt` (stays unaccepted until the socket drops, like an RPC that never got its reply).
    const more = window as unknown as {
      __mockHoldNextSessionPage?: () => void; __mockReleaseSessionPage?: () => void;
      __mockHoldNextSubmit?: () => void; __mockSubmits?: string[];
    };
    more.__mockHoldNextSessionPage = () => { this.holdNextPage = true; };
    more.__mockReleaseSessionPage = () => { this.releaseHeldPage?.(); this.releaseHeldPage = null; };
    more.__mockHoldNextSubmit = () => { this.holdNextSubmit = true; };
    more.__mockSubmits = [];
  }
  async status(): Promise<ServerStatus> {
    return { version: 'mock-0.1.0', gateway_running: true, auth_required: false, active_sessions: 1, profiles: ['default', 'sales-test'] };
  }
  async authProviders() { return []; }
  async runtimeOptions(): Promise<RuntimeOptions> {
    const models = [
      { provider: 'mock', model: 'mock-fast', label: 'Mock Fast' },
      { provider: 'mock', model: 'mock-deep', label: 'Mock Deep' },
    ];
    return { profiles: ['default', 'sales-test'], currentProfile: 'default', models, currentModel: models[0] };
  }
  capability() { return { kind: 'tokenOnly' as const }; }
  async passwordLogin(): Promise<AuthSession> { return { mode: 'password', username: 'mock' }; }
  async sessionPage(_auth?: AuthSession, options: { limit?: number; offset?: number; profile?: string } = {}): Promise<SessionPage> {
    if (this.holdNextPage) {
      this.holdNextPage = false;
      await new Promise<void>((resolve) => { this.releaseHeldPage = resolve; });
    }
    const limit = options.limit ?? 75;
    const offset = options.offset ?? 0;
    const rows = filterSessionsByProfile(sessions, options.profile);
    return { sessions: rows.slice(offset, offset + limit), total: rows.length, limit, offset };
  }
  async sessions(_auth?: AuthSession, _limit?: number, _profile?: string): Promise<HermesSession[]> { return filterSessionsByProfile(sessions, _profile); }
  // Like the real route: profile-scoped, matches title/preview (the real server matches id,
  // message content, then titles), and can return hidden rows the listing never includes.
  async searchSessions(_auth: AuthSession, query: string, options: { profile?: string; limit?: number } = {}): Promise<HermesSession[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    return filterSessionsByProfile(allSessions, options.profile)
      .filter((row) => row.id.toLowerCase().includes(q) || [row.title, row.preview].filter(Boolean).join(' ').toLowerCase().includes(q))
      .slice(0, limit);
  }
  async sessionMessages(_auth: AuthSession, session: HermesSession): Promise<ChatMessage[]> { return starterMessages(session); }
  async sessionTranscript(_auth: AuthSession, session: HermesSession): Promise<{ session: HermesSession; messages: ChatMessage[] }> { return { session, messages: starterMessages(session) }; }
  async sessionDetail(_auth: AuthSession, session: HermesSession): Promise<HermesSession> {
    if (this.holdNextDetail) {
      this.holdNextDetail = false;
      await new Promise<void>((resolve) => { this.releaseHeldDetail = resolve; });
    }
    // Exact id AND profile, like the real endpoint: the same id can exist under two profiles.
    // Hidden rows resolve by id too (the real `GET /api/sessions/{id}` returns hidden=1 rows).
    const found = allSessions.find((item) => item.id === session.id && (!session.profile || normalizeProfileTag(item.profile) === normalizeProfileTag(session.profile)));
    if (!found) throw new HttpError('Session not found.', 404);
    return found;
  }
  async resolveLatestSession(_auth: AuthSession, session: HermesSession): Promise<HermesSession> { return session; }
  // Mirrors the verified REST contract: order=latest pages backward from the newest
  // message, rows come back chronological, and the beginning is only known when
  // returned < limit.
  async sessionHistoryPage(_auth: AuthSession, session: HermesSession, options: { limit?: number; offset?: number } = {}): Promise<HistoryPage> {
    const limit = Math.min(Math.max(options.limit ?? 120, 1), 500);
    const offset = Math.max(options.offset ?? 0, 0);
    const all = session.id === LONG_HISTORY_ID ? longHistoryMessages() : starterMessages(session);
    const end = Math.max(0, all.length - offset);
    const start = Math.max(0, end - limit);
    const page = all.slice(start, end);
    await new Promise((resolve) => window.setTimeout(resolve, 60));
    return { sessionId: session.id, profile: session.profile, messages: page, limit, offset, returned: page.length, reachedBeginning: page.length < limit };
  }
  async connectGateway(_auth: AuthSession, callbacks: GatewayCallbacks): Promise<GatewayHandle> {
    window.setTimeout(() => callbacks.onOpen?.(), 10);
    // Test hook: `window.__mockDropGateway()` simulates the server closing the socket
    // (e.g. iOS backgrounded the page and the gateway's ping timed out).
    (window as unknown as { __mockDropGateway?: () => void }).__mockDropGateway = () => {
      callbacks.onClose?.();
      // A real socket close rejects every RPC still waiting for its reply (after onClose has fired).
      this.rejectHeldSubmit?.(new Error('Gateway connection closed.'));
      this.rejectHeldSubmit = null;
    };
    return {
      createSession: async (selection?: RuntimeSelection) => {
        const modelText = [selection?.provider, selection?.model].filter(Boolean).join('/');
        callbacks.onEvent({ type: 'message.interim', text: `Profile: ${selection?.profile || 'default'} · Model: ${modelText || 'inherit'} · Reasoning: ${selection?.reasoning_effort || 'inherit'}` });
        const id = `mock-${Date.now()}`;
        return { liveId: mockLiveId(id), storedId: id };
      },
      resumeSession: async (sessionId: string): Promise<ResumeResult> => {
        callbacks.onEvent({ type: 'session.info', session_id: sessionId, status: 'ready' });
        const openRequestKeys: string[] = [];
        const result = (running: boolean): ResumeResult => ({ sessionId: mockLiveId(sessionId), storedId: sessionId, running, status: running ? 'streaming' : 'idle', openRequestKeys });
        if (sessionId === 'mock-lisbon-trip') {
          callbacks.onEvent({
            type: 'clarify.request',
            session_id: sessionId,
            payload: {
              request_id: 'mock-clarify-lisbon',
              questions: [
                { qid: 'q0', question: 'Which neighborhood?', choices: ['Alfama', 'Baixa'] },
                { qid: 'q1', question: 'Need breakfast included?', choices: ['Yes', 'productionuscentral1releasecandidatewithnobreakopportunities'] },
              ],
              answers: { q0: 'Alfama' },
            },
          });
        }
        if (sessionId === 'mock-deployment-question') {
          callbacks.onEvent({
            type: 'clarify.request',
            session_id: sessionId,
            payload: {
              request_id: 'mock-clarify-deployment',
              question: 'Which deployment label should Hermes use?',
            },
          });
        }
        if (sessionId === 'mock-campaign-regions') {
          callbacks.onEvent({
            type: 'clarify.request',
            session_id: sessionId,
            payload: {
              request_id: 'mock-clarify-regions',
              question: 'Which regions should launch?',
              choices: ['US', 'EU'],
              multi_select: true,
            },
          });
        }
        if (sessionId === 'mock-cron-digest') {
          callbacks.onEvent({
            type: 'approval.request',
            session_id: sessionId,
            payload: {
              request_id: 'mock-approval-digest',
              description: 'Publish the prepared digest?',
              command: 'hermes send --platform slack --channel morning-brief',
              choices: ['once', 'deny'],
            },
          });
        }
        if (sessionId === 'mock-deny-only-approval') {
          callbacks.onEvent({
            type: 'approval.request',
            session_id: sessionId,
            payload: {
              request_id: 'mock-approval-deny-only',
              description: 'This command can only be denied from this client.',
              choices: ['deny'],
            },
          });
        }
        if (sessionId === 'mock-current-approval') {
          callbacks.onEvent({
            type: 'approval',
            server_request_id: 'srq-mock-current-approval',
            session_id: sessionId,
            request_id: 'mock-current-approval-request',
            description: 'Run the current gateway command?',
            command: 'npm run check:daily',
            choices: ['once', 'deny'],
          });
        }
        if (sessionId === 'mock-interrupted-approval') {
          callbacks.onEvent({
            type: 'approval.request',
            session_id: sessionId,
            payload: { description: 'A command is still waiting.' },
          });
        }
        if (sessionId === 'mock-deployment-credentials') {
          callbacks.onEvent({
            type: 'secret.request',
            session_id: sessionId,
            payload: {
              request_id: 'mock-secret-deploy',
              env_var: 'DEPLOY_TOKEN',
              prompt: 'Enter the deploy token.',
            },
          });
        }
        if (sessionId === 'mock-system-update') {
          callbacks.onEvent({
            type: 'sudo',
            server_request_id: 'srq-mock-sudo-update',
            session_id: sessionId,
          });
        }
        if (sessionId === RUNNING_BUILD_ID) {
          callbacks.onEvent({ type: 'message.start', session_id: mockLiveId(sessionId) });
          callbacks.onEvent({ type: 'message.delta', session_id: mockLiveId(sessionId), payload: { text: 'Still building the release artifact…' } });
          return result(true);
        }
        return result(false);
      },
      queuePrompt: async (_sessionId: string, text: string) => {
        if (text.includes('[[mock-idle]]')) return { status: 'streaming' as const };
        return { status: 'queued' as const };
      },
      steerSession: async (_sessionId: string, text: string) => {
        if (text.includes('[[mock-unsupported]]')) return { status: 'unsupported' as const };
        if (text.includes('[[mock-idle]]')) return { status: 'rejected' as const };
        callbacks.onEvent({ type: 'status.update', payload: { kind: 'process', text: 'Steer received; applying after the current tool call.' } });
        return { status: 'accepted' as const };
      },
      attachFile: async (_sessionId: string, attachment: PreparedAttachment) => {
        if (!attachment.dataUrl.startsWith('data:')) throw new Error('Mock attachment has no captured bytes.');
        return { name: attachment.name, kind: classifyAttachment(attachment.name, attachment.mimeType), text: `[Mock attached file: ${attachment.name}]` };
      },
      respondApproval: async (_sessionId: string, requestId: string) => {
        callbacks.onEvent({ type: 'approval.expire', payload: { request_id: requestId } });
      },
      respondClarify: async (_sessionId: string, requestId: string) => {
        callbacks.onEvent({ type: 'clarify.expire', payload: { request_id: requestId } });
      },
      respondServerRequest: (requestId: string) => {
        callbacks.onEvent({ type: 'request.cancel', payload: { id: requestId, reason: 'answered' } });
      },
      declineServerRequest: () => {},
      serverRequestMethods: ['approval', 'clarify', 'sudo', 'secret'],
      submitPrompt: async (sessionId: string, prompt: string) => {
        (window as unknown as { __mockSubmits?: string[] }).__mockSubmits?.push(prompt);
        if (this.holdNextSubmit) {
          this.holdNextSubmit = false;
          await new Promise<void>((_, reject) => { this.rejectHeldSubmit = reject; });
        }
        callbacks.onEvent({ type: 'message.start', session_id: sessionId });
        const chunks = [`I’ll work on: “${prompt}”.\n\n`, 'Mock mode is wired, so no real Hermes server was contacted. ', 'Connect to your dashboard URL to drive a live agent.'];
        for (const chunk of chunks) {
          await new Promise((resolve) => window.setTimeout(resolve, 220));
          callbacks.onEvent({ type: 'message.delta', session_id: sessionId, payload: { text: chunk } });
        }
        callbacks.onEvent({ type: 'message.complete', session_id: sessionId, payload: { text: '', status: 'complete' } });
      },
      close: () => callbacks.onClose?.(),
    };
  }
}

let longHistoryCache: ChatMessage[] | null = null;
function longHistoryMessages(): ChatMessage[] {
  if (longHistoryCache) return longHistoryCache;
  const items: ChatMessage[] = [];
  for (let index = 1; index <= LONG_HISTORY_TOTAL; index += 1) {
    const role = index % 2 === 1 ? 'user' : 'assistant';
    items.push({ id: `history-${index}`, role, text: role === 'user' ? `Question ${index}: what changed in step ${index}?` : `Answer ${index}: step ${index} is complete.`, state: 'complete' });
  }
  longHistoryCache = items;
  return items;
}

export function starterMessages(session?: HermesSession): ChatMessage[] {
  if (!session) return [];
  if (session.id === 'mock-weekend-reading') {
    return [
      { id: `${session.id}-u`, role: 'user', text: session.preview ?? 'Start a new task.', state: 'complete' },
      { id: `${session.id}-a`, role: 'assistant', text: '### Saved item\n\nLoad this URL on the phone:\n\nhttps://hermes.example.test/?v=23\n\n- Then tap **Refresh transcript**.\n- Keep `inline code` readable.\n\n```text\n📎 filename.pdf\n```', state: 'complete' },
    ];
  }
  return [
    { id: `${session.id}-u`, role: 'user', text: session.preview ?? 'Start a new task.', state: 'complete' },
    { id: `${session.id}-a`, role: 'assistant', text: 'Ready. Send a message to continue this session.', state: 'complete' },
  ];
}
