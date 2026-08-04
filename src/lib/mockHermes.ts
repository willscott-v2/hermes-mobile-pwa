import { AuthSession, ChatMessage, GatewayCallbacks, GatewayHandle, HermesSession, ServerStatus, SessionPage } from './hermesApi';

const sessions: HermesSession[] = [
  { id: 'mock-weekend-reading', title: 'Weekend reading', preview: 'Summarize the three articles I saved about better sleep.', updated_at: new Date().toISOString(), message_count: 6, running: false, source: 'mock' },
  { id: 'mock-lisbon-trip', title: 'Lisbon trip', preview: 'Find 3 well-rated hotels under €150.', updated_at: new Date(Date.now() - 1000 * 60 * 48).toISOString(), message_count: 9, running: true, source: 'mock' },
  { id: 'mock-cron-digest', title: 'Morning news digest', preview: 'Cron job output from this morning.', updated_at: new Date(Date.now() - 1000 * 60 * 60 * 3).toISOString(), message_count: 3, running: false, source: 'cron' },
];

export class MockHermesClient {
  readonly baseUrl = 'mock://hermes';
  async status(): Promise<ServerStatus> {
    return { version: 'mock-0.1.0', gateway_running: true, auth_required: false, active_sessions: 1 };
  }
  async authProviders() { return []; }
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
  async connectGateway(_auth: AuthSession, callbacks: GatewayCallbacks): Promise<GatewayHandle> {
    window.setTimeout(() => callbacks.onOpen?.(), 10);
    return {
      createSession: async () => `mock-${Date.now()}`,
      resumeSession: async (sessionId: string) => {
        callbacks.onEvent({ type: 'session.info', session_id: sessionId, status: 'ready' });
        return sessionId;
      },
      attachFile: async (_sessionId: string, file: File) => ({ name: file.name, kind: file.type.startsWith('image/') ? 'image' : file.type === 'application/pdf' ? 'pdf' : 'file', text: `[Mock attached file: ${file.name}]` }),
      submitPrompt: async (_sessionId: string, prompt: string) => {
        callbacks.onEvent({ type: 'message.start' });
        const chunks = [`I’ll work on: “${prompt}”.\n\n`, 'Mock mode is wired, so no real Hermes server was contacted. ', 'Connect to your dashboard URL to drive a live agent.'];
        for (const chunk of chunks) {
          await new Promise((resolve) => window.setTimeout(resolve, 220));
          callbacks.onEvent({ type: 'message.delta', delta: chunk });
        }
        callbacks.onEvent({ type: 'message.complete' });
      },
      close: () => callbacks.onClose?.(),
    };
  }
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
