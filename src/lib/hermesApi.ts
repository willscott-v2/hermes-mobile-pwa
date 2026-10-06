import { asRecord, JsonRpcError, JsonRpcEvent, JsonRpcPeer, JsonValue, parseJsonRpcMessage } from './jsonRpc';

export type AuthMode = 'password' | 'token' | 'mock';

export interface AuthSession {
  mode: Exclude<AuthMode, 'mock'>;
  token?: string;
  username?: string;
}

export interface ServerStatus {
  version?: string;
  gateway_running?: boolean;
  gateway_state?: string;
  active_sessions?: number;
  auth_required?: boolean;
  auth_providers?: string[];
  profiles?: string[];
}

export interface AuthProvider {
  name: string;
  display_name?: string;
  supports_password?: boolean;
}

interface ModelOptionsProvider {
  name?: string;
  slug?: string;
  models?: string[];
  authenticated?: boolean;
}

interface ModelOptionsResponse {
  provider?: string;
  model?: string;
  providers?: ModelOptionsProvider[];
}

export type AuthCapability =
  | { kind: 'tokenOnly' }
  | { kind: 'passwordAvailable'; provider: string; displayName: string }
  | { kind: 'oauthOnly'; providers: string[] };

export interface HermesSession {
  id: string;
  title?: string;
  preview?: string;
  workspace?: string;
  profile?: string;
  message_count?: number;
  updated_at?: string;
  created_at?: string;
  started_at?: string | number;
  last_active?: string | number;
  running?: boolean;
  archived?: boolean;
  source?: string;
}

export interface SessionPage {
  sessions: HermesSession[];
  total?: number;
  limit: number;
  offset: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool' | 'status';
  text: string;
  state?: 'streaming' | 'complete' | 'error';
  meta?: string;
}

export interface HistoryPage {
  sessionId: string;
  profile?: string;
  messages: ChatMessage[];
  limit: number;
  offset: number;
  returned: number;
  reachedBeginning: boolean;
}

export interface AttentionRequest {
  kind: 'approval' | 'clarify' | 'sudo' | 'secret';
  requestId?: string;
  serverRequestId?: string;
  questionId?: string;
  title: string;
  detail: string;
  choices?: string[];
  multiSelect?: boolean;
  freeText?: boolean;
}

export interface AttachmentResult {
  name: string;
  text: string;
  kind: 'image' | 'pdf' | 'file';
}

export interface RuntimeModelOption {
  provider: string;
  model: string;
  label: string;
}

export interface RuntimeOptions {
  profiles: string[];
  currentProfile: string;
  models: RuntimeModelOption[];
  currentModel?: RuntimeModelOption;
}

export interface RuntimeSelection {
  profile?: string;
  provider?: string;
  model?: string;
  reasoning_effort?: string;
}

export interface ResumeResult {
  sessionId: string;        // live gateway id for prompt.submit / steer / queue
  storedId: string;         // durable session key (`session_key` / `resumed`) for history and references
  running: boolean;         // gateway-reported turn state at resume time
  status?: string;
  openRequestKeys: string[]; // keys (request_id / server request id) of requests still open
}

export interface CreatedSession {
  liveId: string;    // gateway handle for prompt.submit / steer / queue
  storedId: string;  // durable session key the REST API and Continue reference use
}

export interface GatewayHandle {
  createSession(selection?: RuntimeSelection): Promise<CreatedSession>;
  resumeSession(sessionId: string, profile?: string): Promise<ResumeResult>;
  attachFile(sessionId: string, file: File): Promise<AttachmentResult>;
  submitPrompt(sessionId: string, prompt: string): Promise<void>;
  queuePrompt(sessionId: string, text: string): Promise<QueueOutcome>;
  steerSession(sessionId: string, text: string, profile?: string): Promise<SteerOutcome>;
  respondApproval(sessionId: string, requestId: string, choice: 'once' | 'deny'): Promise<void>;
  respondClarify(sessionId: string, requestId: string, answer: string, questionId?: string): Promise<void>;
  respondServerRequest(requestId: string, result: Record<string, JsonValue>): void;
  declineServerRequest(requestId: string): void; // "not shown on this surface" (4404): fail-closed hand-back
  serverRequestMethods: string[];                // advertised by client.capabilities; empty when the gateway predates it
  close(): void;
}

// Mirrors tui_gateway/server_requests.py NOT_SHOWN_CODE: an answering client that cannot show a
// request declines it so the gateway does not stall the agent waiting for this surface.
export const SERVER_REQUEST_NOT_SHOWN_CODE = 4404;

export function shouldDeclineOnPhone(request: AttentionRequest): boolean {
  if (!request.serverRequestId) return false;
  if (request.kind === 'sudo' || request.kind === 'secret') return true;
  if (request.kind === 'clarify') return request.multiSelect === true || !request.questionId || (!request.choices?.length && request.freeText !== true);
  if (request.kind === 'approval') {
    const { approveOnce, deny } = approvalActionAvailability(request);
    return !approveOnce && !deny;
  }
  return false;
}

export interface GatewayCallbacks {
  onEvent(event: JsonRpcEvent): void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

export function normalizeServerUrl(input: string): string | null {
  const trimmed = input.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').replace(/\/+$/, '');
  if (!trimmed) return null;
  const withScheme = trimmed.includes('://') ? trimmed : `http://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) return null;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return null;
  }
}

export function endpointUrl(baseUrl: string, route: string): URL {
  const base = new URL(baseUrl);
  const prefix = base.pathname.replace(/\/+$/, '');
  const suffix = route.startsWith('/') ? route : `/${route}`;
  base.pathname = `${prefix}${suffix}`.replace(/\/+/g, '/');
  base.search = '';
  base.hash = '';
  return base;
}

export function wsUrl(baseUrl: string, params: Record<string, string>): string {
  const url = endpointUrl(baseUrl, '/api/ws');
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url.toString();
}

export function redactForLog(value: string): string {
  return value
    .replace(/(token=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(ticket=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(password|token|secret)(["'\s:=]+)([^"'\s,}]+)/gi, '$1$2[redacted]');
}

function authHeaders(auth?: AuthSession): HeadersInit {
  return auth?.mode === 'token' && auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
}

export class HttpError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'HttpError';
  }
}

export function isAuthError(error: unknown): boolean {
  return error instanceof HttpError && (error.status === 401 || error.status === 403);
}

export function isNotFoundError(error: unknown): boolean {
  return error instanceof HttpError && error.status === 404;
}

async function parseError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { detail?: string; error?: string };
    return new HttpError(json.detail ?? json.error ?? `HTTP ${response.status}`, response.status);
  } catch {
    return new HttpError(text.trim() || `HTTP ${response.status}`, response.status);
  }
}

export class HermesApiClient {
  constructor(public readonly baseUrl: string) {}

  async status(): Promise<ServerStatus> {
    return this.get<ServerStatus>('/api/status');
  }

  async authProviders(): Promise<AuthProvider[]> {
    try {
      const response = await this.get<{ providers?: AuthProvider[] } | AuthProvider[]>('/api/auth/providers');
      return Array.isArray(response) ? response : response.providers ?? [];
    } catch {
      return [];
    }
  }

  async runtimeOptions(auth?: AuthSession): Promise<RuntimeOptions> {
    const status = await this.status();
    const profiles = status.profiles?.length ? status.profiles : ['default'];
    let payload: ModelOptionsResponse | null = null;
    try {
      const url = endpointUrl(this.baseUrl, '/api/model/options');
      url.searchParams.set('include_unconfigured', '0');
      payload = await this.get<ModelOptionsResponse>(url, auth);
    } catch {
      payload = null;
    }
    const models = (payload?.providers ?? [])
      .filter((provider) => provider.authenticated !== false && (provider.slug || provider.name))
      .flatMap((provider) => {
        const providerId = String(provider.slug || provider.name);
        return (provider.models ?? []).map((model) => ({
          provider: providerId,
          model,
          label: `${provider.name || provider.slug}: ${model}`,
        }));
      });
    const currentModel = models.find((item) => item.provider === payload?.provider && item.model === payload?.model)
      ?? (payload?.provider && payload?.model ? { provider: payload.provider, model: payload.model, label: `${payload.provider}: ${payload.model}` } : undefined)
      ?? models[0];
    return { profiles, currentProfile: profiles[0] ?? 'default', models, currentModel };
  }

  capability(status: ServerStatus, providers: AuthProvider[]): AuthCapability {
    if (!status.auth_required) return { kind: 'tokenOnly' };
    const password = providers.find((provider) => provider.supports_password !== false);
    if (password) {
      return { kind: 'passwordAvailable', provider: password.name, displayName: password.display_name ?? password.name };
    }
    return { kind: 'oauthOnly', providers: providers.map((provider) => provider.name) };
  }

  async passwordLogin(provider: string, username: string, password: string): Promise<AuthSession> {
    const response = await fetch(endpointUrl(this.baseUrl, '/auth/password-login'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, username, password }),
    });
    if (!response.ok) throw await parseError(response);
    return { mode: 'password', username };
  }

  async sessionPage(auth: AuthSession, options: { limit?: number; offset?: number } = {}): Promise<SessionPage> {
    const limit = options.limit ?? 75;
    const offset = options.offset ?? 0;
    const url = endpointUrl(this.baseUrl, '/api/sessions');
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('order', 'recent');
    url.searchParams.set('min_messages', '1');
    const response = await this.get<{ sessions?: HermesSession[]; results?: HermesSession[]; total?: number; limit?: number; offset?: number }>(url, auth);
    return {
      sessions: (response.sessions ?? response.results ?? []).map(normalizeSession),
      total: response.total,
      limit: response.limit ?? limit,
      offset: response.offset ?? offset,
    };
  }

  async sessions(auth: AuthSession, limit = 75): Promise<HermesSession[]> {
    return (await this.sessionPage(auth, { limit, offset: 0 })).sessions;
  }

  async sessionMessages(auth: AuthSession, session: HermesSession, limit = 120): Promise<ChatMessage[]> {
    return (await this.sessionTranscript(auth, session, limit)).messages;
  }

  async sessionTranscript(auth: AuthSession, session: HermesSession, limit = 120): Promise<{ session: HermesSession; messages: ChatMessage[] }> {
    const requested = Math.min(Math.max(limit, 1), 500);
    const resolved = await this.resolveLatestSession(auth, session).catch(() => session);
    const detail = await this.sessionDetail(auth, resolved).catch(() => resolved);
    const url = endpointUrl(this.baseUrl, `/api/sessions/${encodeURIComponent(detail.id)}/messages`);
    const knownCount = typeof detail.message_count === 'number' ? detail.message_count : undefined;
    url.searchParams.set('limit', String(requested));
    url.searchParams.set('offset', String(knownCount && knownCount > requested ? knownCount - requested : 0));
    if (detail.profile) url.searchParams.set('profile', detail.profile);
    let response = await this.get<{ session_id?: string; messages?: RawHermesMessage[]; pagination?: { returned?: number } }>(url, auth);
    // A compressed/resumed session can make a cached parent message_count stale.
    // If the calculated tail offset returns nothing, retry from the start rather
    // than leaving the mobile transcript stuck on old cached messages.
    if ((response.messages ?? []).length === 0 && knownCount && knownCount > requested) {
      url.searchParams.set('offset', '0');
      response = await this.get<{ session_id?: string; messages?: RawHermesMessage[]; pagination?: { returned?: number } }>(url, auth);
    }
    const normalized = normalizeHistoryMessages(response.messages ?? []);
    const responseSessionId = response.session_id ? String(response.session_id) : detail.id;
    return { session: { ...detail, id: responseSessionId }, messages: normalized.slice(-requested) };
  }

  async sessionHistoryPage(auth: AuthSession, session: HermesSession, options: { limit?: number; offset?: number } = {}): Promise<HistoryPage> {
    const limit = Math.min(Math.max(options.limit ?? 120, 1), 500);
    const offset = Math.max(options.offset ?? 0, 0);
    const url = endpointUrl(this.baseUrl, `/api/sessions/${encodeURIComponent(session.id)}/messages`);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('offset', String(offset));
    url.searchParams.set('order', 'latest');
    if (session.profile) url.searchParams.set('profile', session.profile);
    const response = await this.get<{ session_id?: unknown; profile?: unknown; messages?: RawHermesMessage[]; pagination?: { returned?: unknown } }>(url, auth);
    const rawMessages = response.messages ?? [];
    const returned = typeof response.pagination?.returned === 'number' ? response.pagination.returned : rawMessages.length;
    return {
      sessionId: response.session_id ? String(response.session_id) : session.id,
      profile: typeof response.profile === 'string' ? response.profile : session.profile,
      messages: normalizeHistoryMessages(rawMessages),
      limit,
      offset,
      returned,
      reachedBeginning: returned < limit,
    };
  }

  async sessionDetail(auth: AuthSession, session: HermesSession): Promise<HermesSession> {
    const url = endpointUrl(this.baseUrl, `/api/sessions/${encodeURIComponent(session.id)}`);
    if (session.profile) url.searchParams.set('profile', session.profile);
    return normalizeSession(await this.get<HermesSession>(url, auth));
  }

  async resolveLatestSession(auth: AuthSession, session: HermesSession): Promise<HermesSession> {
    const url = endpointUrl(this.baseUrl, `/api/sessions/${encodeURIComponent(session.id)}/latest-descendant`);
    if (session.profile) url.searchParams.set('profile', session.profile);
    const response = await this.get<{ session_id?: string }>(url, auth);
    return { ...session, id: String(response.session_id ?? session.id) };
  }

  async mintWsTicket(): Promise<string> {
    const response = await fetch(endpointUrl(this.baseUrl, '/api/auth/ws-ticket'), {
      method: 'POST',
      credentials: 'include',
    });
    if (!response.ok) throw await parseError(response);
    const json = (await response.json()) as { ticket?: string };
    if (!json.ticket) throw new Error('Hermes did not return a WebSocket ticket.');
    return json.ticket;
  }

  async connectGateway(auth: AuthSession, callbacks: GatewayCallbacks): Promise<GatewayHandle> {
    const params: Record<string, string> = {};
    if (auth.mode === 'token') {
      if (!auth.token) throw new Error('Missing token.');
      params.token = auth.token;
    } else {
      params.ticket = await this.mintWsTicket();
    }
    const socket = new WebSocket(wsUrl(this.baseUrl, params));
    const peer = new JsonRpcPeer(socket, 120_000);
    socket.addEventListener('open', () => callbacks.onOpen?.());
    socket.addEventListener('close', () => {
      peer.rejectAll(new Error('Gateway disconnected.'));
      callbacks.onClose?.();
    });
    socket.addEventListener('error', () => callbacks.onError?.(new Error('Gateway socket error.')));
    socket.addEventListener('message', (message) => {
      for (const frame of parseJsonRpcMessage(String(message.data))) {
        const event = peer.handleFrame(frame);
        if (event) callbacks.onEvent(event);
      }
    });
    await waitForOpen(socket);
    // Verified contract: the gateway only delivers approval/clarify/sudo/secret requests to clients
    // that advertised answering them; without this call every request fails fast as undeliverable.
    let serverRequestMethods: string[] = [];
    try {
      const capabilities = asRecord(await peer.request('client.capabilities', { server_requests: true }, { timeoutMs: 10_000 }));
      serverRequestMethods = Array.isArray(capabilities.server_requests)
        ? capabilities.server_requests.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      serverRequestMethods = [];
    }
    return {
      serverRequestMethods,
      createSession: async (selection?: RuntimeSelection) => {
        const result = asRecord(await peer.request('session.create', {
          ...(selection?.profile ? { profile: selection.profile } : {}),
          ...(selection?.provider ? { provider: selection.provider } : {}),
          ...(selection?.model ? { model: selection.model } : {}),
          ...(selection?.reasoning_effort ? { reasoning_effort: selection.reasoning_effort } : {}),
        }));
        const liveId = String(result.session_id ?? result.session_key ?? result.id ?? '');
        const storedId = String(result.stored_session_id ?? result.session_key ?? liveId);
        return { liveId, storedId };
      },
      resumeSession: async (sessionId: string, profile?: string) => {
        const result = asRecord(await peer.request('session.resume', { session_id: sessionId, ...(profile ? { profile } : {}) }));
        const pending = pendingAttentionEvents(result);
        for (const event of pending) callbacks.onEvent(event);
        return resumeResultFromPayload(result, sessionId, pending);
      },
      attachFile: async (sessionId: string, file: File) => {
        const dataUrl = await fileToDataUrl(file);
        const common = { session_id: sessionId, filename: file.name, name: file.name };
        if (file.type.startsWith('image/')) {
          const result = asRecord(await peer.request('image.attach_bytes', { ...common, content_base64: dataUrl }));
          return { name: file.name, kind: 'image', text: String(result.text ?? `[User attached image: ${file.name}]`) };
        }
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const result = asRecord(await peer.request('pdf.attach', { ...common, content_base64: dataUrl }));
          return { name: file.name, kind: 'pdf', text: String(result.text ?? `[User attached PDF: ${file.name}]`) };
        }
        const result = asRecord(await peer.request('file.attach', { session_id: sessionId, name: file.name, path: file.name, data_url: dataUrl }));
        const ref = String(result.ref_text ?? result.text ?? '');
        return { name: file.name, kind: 'file', text: ref ? `[User attached file: ${file.name}]\n${ref}` : `[User attached file: ${file.name}]` };
      },
      submitPrompt: async (sessionId: string, prompt: string) => {
        await peer.request('prompt.submit', { session_id: sessionId, text: prompt }, { timeoutMs: 10 * 60_000 });
      },
      queuePrompt: async (sessionId: string, text: string) => queueOutcomeFromResult(await peer.request('prompt.submit', queuePromptParams(sessionId, text), { timeoutMs: 60_000 })),
      steerSession: async (sessionId: string, text: string, profile?: string) => {
        try {
          return steerOutcomeFromResult(await peer.request('session.steer', steerParams(sessionId, text, profile)));
        } catch (error) {
          const outcome = steerOutcomeFromError(error);
          if (outcome) return outcome;
          throw error;
        }
      },
      respondApproval: async (sessionId: string, requestId: string, choice: 'once' | 'deny') => {
        await peer.request('approval.respond', approvalResponseParams(sessionId, requestId, choice));
      },
      respondClarify: async (sessionId: string, requestId: string, answer: string, questionId?: string) => {
        await peer.request('clarify.respond', clarifyResponseParams(sessionId, requestId, answer, questionId));
      },
      respondServerRequest: (requestId: string, result: Record<string, JsonValue>) => {
        peer.respond(requestId, result);
      },
      declineServerRequest: (requestId: string) => {
        peer.respondError(requestId, SERVER_REQUEST_NOT_SHOWN_CODE, 'This request cannot be answered from the phone; use the full dashboard.');
      },
      close: () => socket.close(1000, 'client closing'),
    };
  }

  private async get<T>(pathOrUrl: string | URL, auth?: AuthSession): Promise<T> {
    const url = typeof pathOrUrl === 'string' ? endpointUrl(this.baseUrl, pathOrUrl) : pathOrUrl;
    const response = await fetch(url, { credentials: 'include', headers: authHeaders(auth) });
    if (!response.ok) throw await parseError(response);
    return (await response.json()) as T;
  }
}

type RawHermesMessage = { id?: unknown; role?: unknown; content?: unknown; text?: unknown; message?: unknown; tool_calls?: unknown; tool_call_id?: unknown; tool_name?: unknown; display_kind?: unknown; display_content?: unknown; session_id?: unknown; function_call?: unknown; name?: unknown; created_at?: unknown; timestamp?: unknown; time?: unknown };

export function normalizeHistoryMessages(rawMessages: RawHermesMessage[]): ChatMessage[] {
  const normalized = rawMessages.map(normalizeMessage).filter((message): message is ChatMessage => Boolean(message));
  return compactToolRuns(normalized);
}

function compactToolRuns(messages: ChatMessage[]): ChatMessage[] {
  const compacted: ChatMessage[] = [];
  for (const message of messages) {
    if (shouldHideHistoryMessage(message)) continue;
    compacted.push(message);
  }
  return compacted;
}

function shouldHideHistoryMessage(message: ChatMessage): boolean {
  if (message.role === 'tool') return true;
  const meta = (message.meta ?? '').toLowerCase();
  const text = message.text.trim();
  if (!text) return false;
  const toolish = meta.includes('tool') || isToolArtifactText(text);
  return toolish;
}

function isToolArtifactText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  if (/^\[This response was interrupted by a user correction\.\]/i.test(trimmed)) return true;
  if (/^<untrusted_tool_result\b/i.test(trimmed)) return true;
  if (/^\[CONTEXT COMPACTION\s+[—-]\s+REFERENCE ONLY\]/i.test(trimmed)) return true;
  if (/^\[(terminal|browser[_\.]|read_file|search_files|execute_code|patch|write_file|process|tool|function)\]/im.test(trimmed)) return true;
  if (/\b(prompt\.submit|session\.resume|tool_calls?|tool_use|tool_result|function_call|jsonrpc|rpc|session_id)\b/i.test(trimmed) && /[{}]/.test(trimmed)) return true;
  if (/["'](output|exit_code|stderr|stdout|success|method|params|session_id|tool_call_id|function|arguments|content_base64)["']\s*:/i.test(trimmed)) return true;
  if (/```(?:json|text)?[\s\S]*?["'](method|params|session_id|output|exit_code|tool_call_id)["']\s*:/i.test(trimmed)) return true;
  return false;
}

function normalizeMessage(raw: RawHermesMessage, index: number): ChatMessage | null {
  if (raw.display_kind === 'hidden') return null;
  const stableId = stableHistoryId(raw.id);
  if (hasToolPayload(raw)) {
    const meta = stringifyMessageText(raw.name) || 'tool activity';
    return { id: stableId ?? `history-${index}-tool`, role: 'tool', text: meta, state: 'complete', meta };
  }
  const displayContent = raw.display_content;
  const rawText = typeof displayContent === 'string' && displayContent.length > 0 ? displayContent : raw.content ?? raw.text ?? raw.message;
  const role = normalizeRole(raw.role);
  const text = stringifyMessageText(rawText);
  if (!text.trim()) return null;
  const meta = timestampToIso(raw.created_at ?? raw.timestamp ?? raw.time);
  return { id: stableId ?? `history-${index}-${role}`, role, text, state: 'complete', meta: meta ? relativeAbsolute(meta) : undefined };
}

function stableHistoryId(rawId: unknown): string | null {
  if (typeof rawId === 'number' && Number.isFinite(rawId)) return `history-${rawId}`;
  if (typeof rawId === 'string' && rawId.trim()) return `history-${rawId}`;
  return null;
}

function hasToolPayload(raw: RawHermesMessage): boolean {
  if (raw.tool_name || raw.tool_call_id) return true;
  if (Array.isArray(raw.tool_calls)) return raw.tool_calls.length > 0;
  if (typeof raw.tool_calls === 'string') {
    const value = raw.tool_calls.trim();
    return Boolean(value && value !== '[]' && value !== 'null');
  }
  return Boolean(raw.tool_calls || raw.function_call);
}

function normalizeRole(role: unknown): ChatMessage['role'] {
  if (role === 'user' || role === 'assistant') return role;
  const value = String(role ?? '').toLowerCase();
  if (value.includes('tool') || value.includes('function')) return 'tool';
  return 'status';
}

function normalizeSession(raw: HermesSession): HermesSession {
  const updated = raw.updated_at ?? timestampToIso(raw.last_active) ?? timestampToIso(raw.started_at);
  const created = raw.created_at ?? timestampToIso(raw.started_at);
  return {
    ...raw,
    id: String(raw.id ?? ''),
    title: raw.title || undefined,
    preview: raw.preview || undefined,
    updated_at: updated,
    created_at: created,
  };
}

function stringifyMessageText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value.map((part) => {
      if (typeof part === 'string') return part;
      if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text ?? '');
      return '';
    }).filter(Boolean).join('');
  }
  if (value && typeof value === 'object' && 'text' in value) return String((value as { text?: unknown }).text ?? '');
  return '';
}

function timestampToIso(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const numeric = Number(value);
    if (!Number.isNaN(numeric) && value.trim()) return timestampToIso(numeric);
    const ms = Date.parse(value);
    return Number.isNaN(ms) ? undefined : new Date(ms).toISOString();
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined;
  return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
}

function relativeAbsolute(iso: string): string {
  return new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file.'));
    reader.readAsDataURL(file);
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Gateway connection timed out.')), 15_000);
    socket.addEventListener('open', () => { window.clearTimeout(timeout); resolve(); }, { once: true });
    socket.addEventListener('error', () => { window.clearTimeout(timeout); reject(new Error('Gateway socket error.')); }, { once: true });
  });
}

export function approvalResponseParams(sessionId: string, requestId: string, choice: 'once' | 'deny'): Record<string, JsonValue> {
  return { session_id: sessionId, request_id: requestId, choice, all: false };
}

// Verified contract (tui_gateway/contracts/server_requests.py ClarifyResult): the server-request
// response is `{ answers: { [qid]: answer } }`; a response without `answers` is treated as cancel-all.
export function clarifyServerRequestResult(questionId: string, answer: string): Record<string, JsonValue> {
  return { answers: { [questionId]: answer } };
}

export function clarifyResponseParams(sessionId: string, requestId: string, answer: string, questionId?: string): Record<string, JsonValue> {
  return { session_id: sessionId, request_id: requestId, ...(questionId ? { question_id: questionId } : {}), answer };
}

export type QueueOutcome = { status: 'queued' | 'streaming' | 'unknown'; raw?: string };
export type SteerOutcome = { status: 'accepted' | 'rejected' | 'unsupported' | 'queued-for-next-turn' | 'unknown'; raw?: string };

export function queuePromptParams(sessionId: string, text: string): Record<string, JsonValue> {
  return { session_id: sessionId, text, queued: true };
}

export function steerParams(sessionId: string, text: string, profile?: string): Record<string, JsonValue> {
  return { session_id: sessionId, text, ...(profile ? { profile } : {}) };
}

export function queueOutcomeFromResult(result: JsonValue): QueueOutcome {
  const status = String(asRecord(result).status ?? '');
  if (status === 'queued') return { status: 'queued' };
  if (status === 'streaming') return { status: 'streaming' };
  return { status: 'unknown', raw: status };
}

export function steerOutcomeFromResult(result: JsonValue): SteerOutcome {
  const status = String(asRecord(result).status ?? '');
  if (status === 'queued') return { status: 'accepted' };
  if (status === 'rejected') return { status: 'rejected' };
  return { status: 'unknown', raw: status };
}

export function steerOutcomeFromError(error: unknown): SteerOutcome | null {
  if (error instanceof JsonRpcError && error.code === 4010) return { status: 'unsupported' };
  return null;
}

export function approvalActionAvailability(request: AttentionRequest): { approveOnce: boolean; deny: boolean } {
  const choices = request.kind === 'approval' && (request.requestId || request.serverRequestId) ? request.choices ?? [] : [];
  return { approveOnce: choices.includes('once'), deny: choices.includes('deny') };
}

export function updateAttentionFromEvent(current: AttentionRequest | null, event: JsonRpcEvent): AttentionRequest | null {
  const next = attentionFromEvent(event);
  if (next) return next;
  if (!current) return current;
  const payload = asRecord(event.payload ?? {});
  if (event.type === 'request.cancel') return payload.id === current.serverRequestId ? null : current;
  if (!event.type?.endsWith('.expire')) return current;
  return payload.request_id === current.requestId ? null : current;
}

export function resumeResultFromPayload(result: Record<string, JsonValue>, requestedId: string, pending: JsonRpcEvent[]): ResumeResult {
  const keys = pending
    .map((event) => attentionFromEvent(event))
    .map((request) => request?.requestId ?? request?.serverRequestId)
    .filter((key): key is string => typeof key === 'string' && key.length > 0);
  return {
    sessionId: String(result.session_id ?? requestedId),
    storedId: String(result.session_key ?? result.resumed ?? requestedId),
    running: result.running === true,
    status: typeof result.status === 'string' ? result.status : undefined,
    openRequestKeys: keys,
  };
}

export function pendingAttentionEvents(result: Record<string, JsonValue>): JsonRpcEvent[] {
  const events: JsonRpcEvent[] = [];
  const pendingApproval = asRecord(result.pending_approval ?? {});
  if (Object.keys(pendingApproval).length) events.push({ type: 'approval.request', payload: pendingApproval });
  const pendingClarify = asRecord(result.pending_clarify ?? {});
  if (Object.keys(pendingClarify).length) events.push({ type: 'clarify.request', payload: pendingClarify });
  const openRequests = Array.isArray(result.open_requests) ? result.open_requests : [];
  for (const rawRequest of openRequests) {
    const request = asRecord(rawRequest);
    const method = typeof request.method === 'string' ? request.method : '';
    const id = typeof request.id === 'string' ? request.id : '';
    if (!id || !['approval', 'clarify', 'sudo', 'secret'].includes(method)) continue;
    events.push({ ...asRecord(request.params ?? {}), type: method, server_request_id: id });
  }
  return events;
}

export function attentionFromEvent(event: JsonRpcEvent): AttentionRequest | null {
  const type = event.type ?? '';
  const directKind = ['approval', 'clarify', 'sudo', 'secret'].includes(type) && typeof event.server_request_id === 'string';
  if (!directKind && !['approval.request', 'clarify.request', 'sudo.request', 'secret.request'].includes(type)) return null;
  const payload = directKind
    ? Object.entries(event).reduce<Record<string, JsonValue>>((record, [key, value]) => {
        if (value !== undefined) record[key] = value;
        return record;
      }, {})
    : asRecord(event.payload ?? {});
  const requestId = !directKind && typeof payload.request_id === 'string' ? payload.request_id : undefined;
  const serverRequestId = directKind ? String(event.server_request_id) : undefined;
  const choices = Array.isArray(payload.choices) ? payload.choices.filter((choice): choice is string => typeof choice === 'string') : undefined;
  if (type === 'clarify.request' || type === 'clarify') {
    const question = typeof payload.question === 'string' ? payload.question.trim() : '';
    const batchAnswers = asRecord(payload.answers ?? {});
    const batchQuestions = Array.isArray(payload.questions)
      ? payload.questions.map((item) => asRecord(item)).map((item) => {
          const text = typeof item.question === 'string' ? item.question.trim() : '';
          const qid = typeof item.qid === 'string' ? item.qid : '';
          const answer = qid && typeof batchAnswers[qid] === 'string' ? String(batchAnswers[qid]) : '';
          const itemChoices = Array.isArray(item.choices)
            ? item.choices.filter((choice): choice is string => typeof choice === 'string')
            : [];
          return {
            qid,
            answered: Boolean(answer),
            choices: itemChoices,
            multiSelect: item.multi_select === true,
            detail: text ? `${text}${answer ? ` (answered: ${answer})` : itemChoices.length ? ` (${itemChoices.join(' / ')})` : ''}` : '',
          };
        }).filter((item) => item.detail)
      : [];
    const unanswered = batchQuestions.filter((item) => !item.answered);
    const actionableQuestion = unanswered.length === 1 ? unanswered[0] : undefined;
    return {
      kind: 'clarify',
      requestId,
      serverRequestId,
      ...(actionableQuestion?.qid ? { questionId: actionableQuestion.qid } : {}),
      title: unanswered.length > 1 ? `Hermes needs ${unanswered.length} answers` : 'Hermes needs an answer',
      detail: question || batchQuestions.map((item) => item.detail).join(' · ') || 'A clarification is waiting in Hermes.',
      ...(actionableQuestion?.choices.length ? { choices: actionableQuestion.choices } : !batchQuestions.length && choices?.length ? { choices } : {}),
      ...(actionableQuestion?.multiSelect || (!batchQuestions.length && payload.multi_select === true) ? { multiSelect: true } : {}),
      ...((actionableQuestion && !actionableQuestion.choices.length && !actionableQuestion.multiSelect) || (!batchQuestions.length && Boolean(question) && !choices?.length && payload.multi_select !== true) ? { freeText: true } : {}),
    };
  }
  if (type === 'approval.request' || type === 'approval') {
    const description = typeof payload.description === 'string' ? payload.description.trim() : '';
    const command = typeof payload.command === 'string' ? payload.command.trim() : '';
    return {
      kind: 'approval',
      requestId,
      serverRequestId,
      title: 'Approval needed',
      detail: [description || 'A command is waiting for approval.', command ? `Command: ${command}` : ''].filter(Boolean).join(' · '),
      ...(choices?.length ? { choices } : {}),
    };
  }
  if (type === 'sudo.request' || type === 'sudo') return { kind: 'sudo', requestId, serverRequestId, title: 'Sudo password needed', detail: 'Open the full Hermes dashboard to enter it securely.' };
  return {
    kind: 'secret',
    requestId,
    serverRequestId,
    title: 'Secret needed',
    detail: typeof payload.prompt === 'string' && payload.prompt.trim() ? payload.prompt.trim() : 'Open the full Hermes dashboard to enter it securely.',
  };
}

// The installed gateway wraps every event payload under `payload` (tui_gateway/server.py
// `_event_frame`); older/legacy frames carried fields at the top level. Read both.
function eventText(event: JsonRpcEvent, keys: string[]): string {
  const payload = asRecord(event.payload ?? {});
  for (const key of keys) {
    const nested = payload[key];
    if (typeof nested === 'string') return nested;
  }
  for (const key of keys) {
    const flat = event[key];
    if (typeof flat === 'string') return flat;
  }
  return '';
}

const HIDDEN_STATUS_KINDS = new Set(['heartbeat']);

export function eventToMessages(event: JsonRpcEvent, existing: ChatMessage[]): ChatMessage[] {
  const type = event.type ?? 'unknown';
  const now = String(Date.now());
  if (type === 'message.delta') {
    const delta = eventText(event, ['text', 'delta', 'content']);
    let lastIndex = -1;
    for (let index = existing.length - 1; index >= 0; index -= 1) {
      const message = existing[index];
      if (message.role === 'assistant' && message.state === 'streaming') {
        lastIndex = index;
        break;
      }
    }
    if (lastIndex >= 0) {
      return existing.map((message, index) => index === lastIndex ? { ...message, text: message.text + delta } : message);
    }
    return [...existing, { id: `assistant-${now}`, role: 'assistant', text: delta, state: 'streaming' }];
  }
  if (type === 'message.complete') {
    const finalText = eventText(event, ['text', 'content']).trim();
    const withoutThinking = existing.filter((message) => !(message.role === 'status' && message.text === 'Thinking…'));
    let replacedStreaming = false;
    const completed = withoutThinking.map((message) => {
      if (message.role !== 'assistant' || message.state !== 'streaming') return message;
      replacedStreaming = true;
      return { ...message, text: finalText || message.text, state: 'complete' as const };
    });
    if (!replacedStreaming && finalText) {
      return [...completed, { id: `assistant-${now}`, role: 'assistant', text: finalText, state: 'complete' }];
    }
    return completed;
  }
  if (type === 'message.interim') {
    const interimText = eventText(event, ['text', 'content']).trim();
    return interimText ? [...existing, { id: `assistant-interim-${now}`, role: 'assistant', text: interimText, state: 'complete', meta: 'interim' }] : existing;
  }
  if (type === 'message.start') {
    return [...existing, { id: `status-${now}`, role: 'status', text: 'Thinking…', state: 'complete' }];
  }
  if (attentionFromEvent(event)) return existing;
  if (type === 'status.update') {
    const kind = eventText(event, ['kind']);
    const text = eventText(event, ['text']).trim();
    if (!text || HIDDEN_STATUS_KINDS.has(kind)) return existing;
    return [...existing, { id: `event-${now}`, role: 'status', text, meta: kind || type }];
  }
  if (type.includes('tool') || type.includes('status')) {
    const text = eventText(event, ['text', 'message', 'status', 'name']) || type;
    return [...existing, { id: `event-${now}`, role: 'status', text, meta: type }];
  }
  return existing;
}
