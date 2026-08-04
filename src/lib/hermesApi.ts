import { asRecord, JsonRpcEvent, JsonRpcPeer, JsonValue, parseJsonRpcMessage } from './jsonRpc';
import { connectionIssueHint, initialDiagnosticSteps, setDiagnosticStep, type ConnectionIssueCode, type DiagnosticStep } from './connectionDiagnostics';
import { normalizeRuntimeCatalog, type RuntimeCatalog } from './runtimeOptions';

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
}

export interface AuthProvider {
  name: string;
  display_name?: string;
  supports_password?: boolean;
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

export interface AttachmentResult {
  name: string;
  text: string;
  kind: 'image' | 'pdf' | 'file';
}

export interface GatewayHandle {
  createSession(profile?: string): Promise<string>;
  resumeSession(sessionId: string, profile?: string): Promise<string>;
  attachFile(sessionId: string, file: File): Promise<AttachmentResult>;
  submitPrompt(sessionId: string, prompt: string): Promise<void>;
  close(): void;
}

export interface GatewayCallbacks {
  onEvent(event: JsonRpcEvent): void;
  onOpen?: () => void;
  onClose?: () => void;
  onError?: (error: Error) => void;
}

export interface ConnectionDiagnosticInput {
  mode: AuthMode;
  username?: string;
  password?: string;
  token?: string;
}

export interface ConnectionDiagnosticResult {
  ok: boolean;
  normalizedUrl: string;
  capability?: AuthCapability;
  version?: string;
  steps: DiagnosticStep[];
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

function failedDiagnostic(baseUrl: string, steps: DiagnosticStep[], id: DiagnosticStep['id'], issue: ConnectionIssueCode, detail?: string): ConnectionDiagnosticResult {
  return {
    ok: false,
    normalizedUrl: baseUrl,
    steps: setDiagnosticStep(steps, id, { state: 'failed', issue, message: connectionIssueHint(issue), detail: detail ? redactForLog(detail) : undefined }),
  };
}

async function optionalGet<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

function authHeaders(auth?: AuthSession): HeadersInit {
  return auth?.mode === 'token' && auth.token ? { Authorization: `Bearer ${auth.token}` } : {};
}

async function parseError(response: Response): Promise<Error> {
  const text = await response.text().catch(() => '');
  try {
    const json = JSON.parse(text) as { detail?: string; error?: string };
    return new Error(json.detail ?? json.error ?? `HTTP ${response.status}`);
  } catch {
    return new Error(text.trim() || `HTTP ${response.status}`);
  }
}

export class HermesApiClient {
  constructor(public readonly baseUrl: string) {}

  async diagnoseConnection(input: ConnectionDiagnosticInput): Promise<ConnectionDiagnosticResult> {
    let steps = setDiagnosticStep(initialDiagnosticSteps(), 'url', { state: 'passed', message: 'URL parsed.' });
    let status: ServerStatus;
    try {
      steps = setDiagnosticStep(steps, 'status', { state: 'running', message: 'Checking /api/status…' });
      status = await this.status();
      steps = setDiagnosticStep(steps, 'status', { state: 'passed', message: status.version ? `Dashboard responded (${status.version}).` : 'Dashboard responded.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Status check failed.';
      return failedDiagnostic(this.baseUrl, steps, 'status', /doctype|<html|root/i.test(message) ? 'wrong-pwa-url' : 'unreachable', message);
    }

    let capability: AuthCapability;
    try {
      steps = setDiagnosticStep(steps, 'auth', { state: 'running', message: 'Checking auth providers…' });
      const providers = await this.authProviders();
      capability = this.capability(status, providers);
      steps = setDiagnosticStep(steps, 'auth', { state: 'passed', message: capability.kind === 'passwordAvailable' ? `Password provider: ${capability.displayName}` : 'Auth capability discovered.' });
    } catch (error) {
      return failedDiagnostic(this.baseUrl, steps, 'auth', 'unknown', error instanceof Error ? error.message : undefined);
    }

    try {
      if (input.mode === 'password') {
        if (capability.kind !== 'passwordAvailable') return failedDiagnostic(this.baseUrl, steps, 'auth', 'password-provider-missing');
        if (!input.password?.trim()) {
          steps = setDiagnosticStep(steps, 'login', { state: 'skipped', message: 'Password provider found. Enter your password to verify login.' });
          steps = setDiagnosticStep(steps, 'gateway', { state: 'skipped', message: 'Gateway check runs after password login.' });
          return { ok: true, normalizedUrl: this.baseUrl, capability, version: status.version, steps };
        }
        steps = setDiagnosticStep(steps, 'login', { state: 'running', message: 'Checking password login…' });
        await this.passwordLogin(capability.provider, input.username ?? '', input.password ?? '');
        steps = setDiagnosticStep(steps, 'login', { state: 'passed', message: 'Password login accepted. Password was not stored.' });
        steps = setDiagnosticStep(steps, 'gateway', { state: 'running', message: 'Checking WebSocket ticket…' });
        await this.mintWsTicket();
        steps = setDiagnosticStep(steps, 'gateway', { state: 'passed', message: 'Gateway ticket endpoint responded.' });
      } else if (input.mode === 'token') {
        steps = setDiagnosticStep(steps, 'login', { state: 'skipped', message: 'Token mode selected; password login skipped.' });
        steps = setDiagnosticStep(steps, 'gateway', { state: input.token?.trim() ? 'passed' : 'skipped', message: input.token?.trim() ? 'Token supplied for gateway connection.' : 'Gateway check skipped until a token is supplied.' });
      } else {
        steps = setDiagnosticStep(steps, 'login', { state: 'skipped', message: 'Mock mode does not use dashboard login.' });
        steps = setDiagnosticStep(steps, 'gateway', { state: 'skipped', message: 'Mock mode does not use the live gateway.' });
      }
      return { ok: true, normalizedUrl: this.baseUrl, capability, version: status.version, steps };
    } catch (error) {
      const active = steps.find((step) => step.state === 'running')?.id ?? 'login';
      return failedDiagnostic(this.baseUrl, steps, active, active === 'gateway' ? 'gateway-unavailable' : 'auth-failed', error instanceof Error ? error.message : undefined);
    }
  }

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

  capability(status: ServerStatus, providers: AuthProvider[]): AuthCapability {
    if (!status.auth_required) return { kind: 'tokenOnly' };
    const password = providers.find((provider) => provider.supports_password !== false);
    if (password) {
      return { kind: 'passwordAvailable', provider: password.name, displayName: password.display_name ?? password.name };
    }
    return { kind: 'oauthOnly', providers: providers.map((provider) => provider.name) };
  }

  async runtimeCatalog(auth: AuthSession): Promise<RuntimeCatalog> {
    const [profiles, projects, models] = await Promise.all([
      optionalGet(() => this.get<{ profiles?: unknown[] } | unknown[]>('/api/profiles', auth), [] as unknown[]),
      optionalGet(() => this.get<{ projects?: unknown[] } | unknown[]>('/api/projects', auth), [] as unknown[]),
      optionalGet(() => this.get<{ models?: unknown[] } | unknown[]>('/api/models', auth), [] as unknown[]),
    ]);
    return normalizeRuntimeCatalog({
      profiles: Array.isArray(profiles) ? profiles as never[] : (profiles as { profiles?: never[] }).profiles,
      projects: Array.isArray(projects) ? projects as never[] : (projects as { projects?: never[] }).projects,
      models: Array.isArray(models) ? models as never[] : (models as { models?: never[] }).models,
    });
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
    return {
      createSession: async (profile?: string) => {
        const result = asRecord(await peer.request('session.create', profile ? { profile } : {}));
        return String(result.session_id ?? result.session_key ?? result.id ?? '');
      },
      resumeSession: async (sessionId: string, profile?: string) => {
        const result = asRecord(await peer.request('session.resume', { session_id: sessionId, ...(profile ? { profile } : {}) }));
        return String(result.session_id ?? sessionId);
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

type RawHermesMessage = { role?: unknown; content?: unknown; text?: unknown; message?: unknown; tool_calls?: unknown; tool_call_id?: unknown; tool_name?: unknown; function_call?: unknown; name?: unknown; created_at?: unknown; timestamp?: unknown; time?: unknown };

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
  if (hasToolPayload(raw)) {
    const meta = stringifyMessageText(raw.name) || 'tool activity';
    return { id: `history-${index}-tool`, role: 'tool', text: meta, state: 'complete', meta };
  }
  const role = normalizeRole(raw.role);
  const text = stringifyMessageText(raw.content ?? raw.text ?? raw.message);
  if (!text.trim()) return null;
  const meta = timestampToIso(raw.created_at ?? raw.timestamp ?? raw.time);
  return { id: `history-${index}-${role}`, role, text, state: 'complete', meta: meta ? relativeAbsolute(meta) : undefined };
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

export function eventToMessages(event: JsonRpcEvent, existing: ChatMessage[]): ChatMessage[] {
  const type = event.type ?? 'unknown';
  const now = String(Date.now());
  if (type === 'message.delta') {
    const delta = String(event.delta ?? event.text ?? event.content ?? '');
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
    const finalText = String(event.text ?? event.content ?? '').trim();
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
    const interimText = String(event.text ?? event.content ?? '').trim();
    return interimText ? [...existing, { id: `assistant-interim-${now}`, role: 'assistant', text: interimText, state: 'complete', meta: 'interim' }] : existing;
  }
  if (type === 'message.start') {
    return [...existing, { id: `status-${now}`, role: 'status', text: 'Thinking…', state: 'complete' }];
  }
  if (type.includes('tool') || type.includes('status') || type.includes('approval') || type.includes('clarify')) {
    const text = String(event.message ?? event.status ?? event.name ?? type);
    return [...existing, { id: `event-${now}`, role: 'status', text, meta: type }];
  }
  return existing;
}
