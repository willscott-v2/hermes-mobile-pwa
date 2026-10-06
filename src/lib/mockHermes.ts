import { AuthSession, ChatMessage, GatewayCallbacks, GatewayHandle, HermesSession, HistoryPage, ResumeResult, RuntimeOptions, RuntimeSelection, ServerStatus, SessionPage } from './hermesApi';

const LONG_HISTORY_TOTAL = 300;
const LONG_HISTORY_ID = 'mock-long-history';
const RUNNING_BUILD_ID = 'mock-running-build';

const sessions: HermesSession[] = [
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
];

export class MockHermesClient {
  readonly baseUrl = 'mock://hermes';
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
  async sessionPage(_auth?: AuthSession, options: { limit?: number; offset?: number } = {}): Promise<SessionPage> {
    const limit = options.limit ?? 75;
    const offset = options.offset ?? 0;
    return { sessions: sessions.slice(offset, offset + limit), total: sessions.length, limit, offset };
  }
  async sessions(_auth?: AuthSession, _limit?: number): Promise<HermesSession[]> { return sessions; }
  async sessionMessages(_auth: AuthSession, session: HermesSession): Promise<ChatMessage[]> { return starterMessages(session); }
  async sessionTranscript(_auth: AuthSession, session: HermesSession): Promise<{ session: HermesSession; messages: ChatMessage[] }> { return { session, messages: starterMessages(session) }; }
  async sessionDetail(_auth: AuthSession, session: HermesSession): Promise<HermesSession> {
    const found = sessions.find((item) => item.id === session.id);
    if (!found) throw new Error('Session not found.');
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
    return {
      createSession: async (selection?: RuntimeSelection) => {
        const modelText = [selection?.provider, selection?.model].filter(Boolean).join('/');
        callbacks.onEvent({ type: 'message.interim', text: `Profile: ${selection?.profile || 'default'} · Model: ${modelText || 'inherit'} · Reasoning: ${selection?.reasoning_effort || 'inherit'}` });
        const id = `mock-${Date.now()}`;
        return { liveId: id, storedId: id };
      },
      resumeSession: async (sessionId: string): Promise<ResumeResult> => {
        callbacks.onEvent({ type: 'session.info', session_id: sessionId, status: 'ready' });
        const openRequestKeys: string[] = [];
        const result = (running: boolean): ResumeResult => ({ sessionId, storedId: sessionId, running, status: running ? 'streaming' : 'idle', openRequestKeys });
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
          callbacks.onEvent({ type: 'message.start' });
          callbacks.onEvent({ type: 'message.delta', payload: { text: 'Still building the release artifact…' } });
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
      attachFile: async (_sessionId: string, file: File) => ({ name: file.name, kind: file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'file', text: `[Mock attached file: ${file.name}]` }),
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
      submitPrompt: async (_sessionId: string, prompt: string) => {
        callbacks.onEvent({ type: 'message.start' });
        const chunks = [`I’ll work on: “${prompt}”.\n\n`, 'Mock mode is wired, so no real Hermes server was contacted. ', 'Connect to your dashboard URL to drive a live agent.'];
        for (const chunk of chunks) {
          await new Promise((resolve) => window.setTimeout(resolve, 220));
          callbacks.onEvent({ type: 'message.delta', payload: { text: chunk } });
        }
        callbacks.onEvent({ type: 'message.complete', payload: { text: '', status: 'complete' } });
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
      { id: `${session.id}-a`, role: 'assistant', text: 'Load this URL on the phone:\n\nhttps://hermes.example.test/?v=23\n\nThen tap **Refresh transcript**.\n- The ` ```text ` fence markers should disappear.\n```text\n📎 filename.pdf\n```', state: 'complete' },
    ];
  }
  return [
    { id: `${session.id}-u`, role: 'user', text: session.preview ?? 'Start a new task.', state: 'complete' },
    { id: `${session.id}-a`, role: 'assistant', text: 'Ready. Send a message to continue this session.', state: 'complete' },
  ];
}
