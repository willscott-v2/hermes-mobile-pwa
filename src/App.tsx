import { ArrowLeft, Bot, CheckCircle2, ChevronDown, CircleAlert, Clock3, Lock, MessageCircle, Paperclip, Plus, Radio, RefreshCw, Search, SendHorizonal, ShieldCheck, Sparkles, WifiOff, X } from 'lucide-react';
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { approvalActionAvailability, attentionFromEvent, clarifyServerRequestResult, shouldDeclineOnPhone, AttentionRequest, AuthCapability, AuthMode, AuthSession, ChatMessage, eventToMessages, GatewayHandle, HermesApiClient, HermesSession, HistoryPage, HttpError, isAuthError, isNotFoundError, RuntimeModelOption, RuntimeOptions, RuntimeSelection, SessionPage, normalizeServerUrl } from './lib/hermesApi';
import { MockHermesClient, starterMessages } from './lib/mockHermes';
import { formatMessageTextForMobile } from './lib/mobileText';
import { ConnectionView, deriveConnectionView } from './lib/connectionState';
import { applyHistoryPage, beginHistoryLoad, createHistoryState, failHistoryLoad, historyPresentation, HistoryPresentation, HistoryScope, historyScopeKey, HistoryState } from './lib/history';
import { AttentionState, beginResponse, createAttentionState, markDisconnected, markSendFailed, markSent, reconcileEvent, reconcileResume, requestKey, showAttention } from './lib/attentionState';
import { appStorageKeys, clearContinueReference, clearRememberedToken, forgetThisDevice, loadContinueReference, loadLoginHint, loadRememberedToken, loadServerUrl, migrateLegacyStorage, saveContinueReference, saveLoginHint, saveRememberedToken, saveServerUrl, scopeFromServerUrl, StorageScope } from './lib/storage';

type Client = HermesApiClient | MockHermesClient;
type Screen = 'connect' | 'sessions' | 'chat';
type ConnStatus = 'idle' | 'checking' | 'ready' | 'connecting' | 'error';

const authModeOptions: Array<{ value: AuthMode; label: string }> = [
  { value: 'password', label: 'Password' },
  { value: 'token', label: 'Token (experimental)' },
  { value: 'mock', label: 'Mock demo' },
];

const reasoningOptions = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'minimal', label: 'Minimal' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'xhigh', label: 'XHigh' },
] as const;

type ReasoningChoice = typeof reasoningOptions[number]['value'];

interface ConnectionState {
  rawUrl: string;
  mode: AuthMode;
  username: string;
  password: string;
  token: string;
  rememberToken: boolean;
  status: ConnStatus;
  message: string;
  capability?: AuthCapability;
  version?: string;
}

function defaultServerUrl(): string {
  const proxied = (window.location.protocol === 'http:' || window.location.protocol === 'https:') ? `${window.location.origin}/hermes` : '';
  const saved = loadServerUrl();
  if (saved) {
    try {
      const url = new URL(saved);
      if (proxied && url.hostname === window.location.hostname && url.origin !== window.location.origin) return proxied;
      if (proxied && url.origin === window.location.origin && (url.pathname === '/' || url.pathname === '')) return proxied;
    } catch {
      // Fall through to the saved value so the form can show what needs fixing.
    }
    return saved;
  }
  return proxied;
}

const initialLoginHint = loadLoginHint();

if (typeof window !== 'undefined') {
  // One-way, versioned: drops the legacy global session cache / last-session id
  // so private previews are never rehydrated under a different host or profile.
  migrateLegacyStorage();
}

const HISTORY_PAGE_SIZE = 120;
const NEAR_BOTTOM_PX = 120;

const initialConnection: ConnectionState = {
  rawUrl: defaultServerUrl(),
  mode: initialLoginHint.mode ?? 'password',
  username: initialLoginHint.username ?? '',
  password: '',
  token: loadRememberedToken(),
  rememberToken: Boolean(loadRememberedToken()),
  status: 'idle',
  message: 'Enter your private Hermes dashboard URL.',
};

type ChatStatus = 'disconnected' | 'connecting' | 'resuming' | 'ready' | 'running' | 'lost' | 'error';

interface ContinueTarget {
  session: HermesSession;
  loaded: boolean; // true when the session is present in the loaded list page
}

export function App() {
  const [screen, setScreen] = useState<Screen>('connect');
  const [connection, setConnection] = useState(initialConnection);
  const [client, setClient] = useState<Client | null>(null);
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [authExpired, setAuthExpired] = useState(false);
  const [hasLocalData, setHasLocalData] = useState(() => typeof window !== 'undefined' && appStorageKeys().some((key) => key !== 'hermes-mobile-pwa.schema-version'));
  const [sessions, setSessions] = useState<HermesSession[]>([]);
  const [runtimeOptions, setRuntimeOptions] = useState<RuntimeOptions>({ profiles: ['default'], currentProfile: 'default', models: [] });
  const [runtimeSelection, setRuntimeSelection] = useState<RuntimeSelection>({ profile: 'default' });
  const [reasoningChoice, setReasoningChoice] = useState<ReasoningChoice>('inherit');
  const [newChatSheetOpen, setNewChatSheetOpen] = useState(false);
  const [sessionPage, setSessionPage] = useState<Pick<SessionPage, 'total' | 'limit' | 'offset'>>({ limit: 75, offset: 0 });
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionFilter, setSessionFilter] = useState('');
  const [continueTarget, setContinueTarget] = useState<ContinueTarget | null>(null);
  const [activeSession, setActiveSession] = useState<HermesSession | null>(null);
  const [history, setHistory] = useState<HistoryState | null>(null);
  const [liveMessages, setLiveMessages] = useState<ChatMessage[]>([]);
  const [attention, setAttention] = useState<AttentionState>(() => createAttentionState(''));
  const [composer, setComposer] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [chatStatus, setChatStatus] = useState<ChatStatus>('disconnected');
  const [banner, setBanner] = useState('');
  const [lineageNote, setLineageNote] = useState('');
  const gatewayRef = useRef<GatewayHandle | null>(null);
  const liveSessionIdRef = useRef<string>('');
  const historySessionRef = useRef<HermesSession | null>(null);
  const scopeKeyRef = useRef<string>('');
  const openGenerationRef = useRef(0);
  const historyRef = useRef<HistoryState | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);
  const pendingPrependRef = useRef<{ height: number; top: number } | null>(null);
  const sessionListRef = useRef<HTMLDivElement | null>(null);
  const sessionListScrollRef = useRef(0);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const autoRestoreStarted = useRef(false);

  historyRef.current = history;

  function currentScope(session: HermesSession | null, activeClient: Client | null): StorageScope | null {
    if (!activeClient || !('sessionHistoryPage' in activeClient) || activeClient.baseUrl.startsWith('mock')) return null;
    return scopeFromServerUrl(activeClient.baseUrl, session?.profile);
  }

  function historyScopeFor(session: HermesSession, activeClient: Client): HistoryScope {
    return { baseUrl: activeClient.baseUrl, profile: session.profile, sessionId: session.id };
  }

  function handleAuthFailure(error: unknown, fallback: string): string {
    if (isAuthError(error)) {
      setAuthExpired(true);
      setAuth(null);
      setScreen('connect');
      setConnection((state) => ({ ...state, status: 'idle', message: 'Your dashboard login expired. Sign in again to continue.' }));
      return 'Sign in again to continue.';
    }
    return error instanceof Error ? error.message : fallback;
  }

  async function resolveContinueTarget(activeClient: Client, authSession: AuthSession, loaded: HermesSession[]): Promise<ContinueTarget | null> {
    const profiles = Array.from(new Set<string | undefined>([undefined, ...loaded.map((session) => session.profile)]));
    for (const profile of profiles) {
      const scope = currentScope(profile ? { id: '', profile } : null, activeClient);
      if (!scope) return null;
      const reference = loadContinueReference(scope);
      if (!reference) continue;
      const inList = loaded.find((session) => session.id === reference.sessionId && (session.profile ?? '') === (profile ?? ''));
      if (inList) return { session: inList, loaded: true };
      if (!('sessionDetail' in activeClient)) return null;
      try {
        const detail = await activeClient.sessionDetail(authSession, { id: reference.sessionId, profile, title: reference.title });
        return { session: { ...detail, title: detail.title ?? reference.title }, loaded: false };
      } catch (error) {
        if (isNotFoundError(error)) clearContinueReference();
        return null;
      }
    }
    return null;
  }

  useEffect(() => {
    if (autoRestoreStarted.current) return;
    autoRestoreStarted.current = true;
    if (connection.mode === 'mock') return;
    const normalized = normalizeServerUrl(connection.rawUrl);
    if (!normalized) return;
    const api = new HermesApiClient(normalized);
    const savedToken = loadRememberedToken();
    const restoredAuth: AuthSession = savedToken ? { mode: 'token', token: savedToken } : { mode: 'password' };
    setConnection((state) => ({ ...state, status: 'checking', message: 'Restoring saved dashboard session…' }));
    void (async () => {
      try {
        const [status, providers] = await Promise.all([api.status(), api.authProviders()]);
        const capability = api.capability(status, providers);
        const loaded = await loadSessionPage(api, restoredAuth, 0);
        setClient(api);
        setAuth(restoredAuth);
        setAuthExpired(false);
        setSessions(loaded.sessions);
        setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
        setContinueTarget(await resolveContinueTarget(api, restoredAuth, loaded.sessions));
        void loadRuntimeControls(api, restoredAuth);
        setConnection((state) => ({
          ...state,
          rawUrl: normalized,
          mode: restoredAuth.mode === 'token' ? 'token' : 'password',
          status: 'ready',
          version: status.version,
          capability,
          message: 'Restored previous login. Password was not stored.',
        }));
        setScreen('sessions');
      } catch (error) {
        const reachable = error instanceof HttpError;
        setConnection((state) => ({
          ...state,
          status: reachable ? 'ready' : 'idle',
          message: savedToken
            ? 'Saved login expired. Sign in again to continue.'
            : reachable
              ? 'Server reachable. Sign in to continue.'
              : 'Couldn’t restore dashboard session. Sign in to continue.',
        }));
      }
    })();
  }, []);

  const filteredSessions = useMemo(() => {
    const q = sessionFilter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) => [session.title, session.preview, session.workspace, session.source].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [sessions, sessionFilter]);

  const modelSelectOptions = useMemo(() => {
    const models = runtimeOptions.models.length ? runtimeOptions.models : fallbackModelOptions(runtimeSelection);
    return models.map((model) => ({ value: runtimeModelKey(model), label: shortModelLabel(model) }));
  }, [runtimeOptions.models, runtimeSelection.provider, runtimeSelection.model]);

  const selectedModelKey = runtimeSelection.provider && runtimeSelection.model ? `${runtimeSelection.provider}\u0000${runtimeSelection.model}` : (modelSelectOptions[0]?.value ?? 'inherit');

  const visibleMessages = useMemo(() => {
    const historyMessages = history?.messages ?? [];
    return compactMessagesForMobile([...historyMessages, ...dedupeLiveAgainstHistory(liveMessages, historyMessages)]);
  }, [history, liveMessages]);

  const presentation: HistoryPresentation | null = history ? historyPresentation(history) : null;
  const attentionActive = attention.phase === 'waiting' || attention.phase === 'submitting' || attention.phase === 'sent-unconfirmed' || attention.phase === 'unsupported';
  const connectionView = screen === 'chat'
    ? deriveConnectionView({
        error: chatStatus === 'error',
        authExpired,
        socketLost: chatStatus === 'lost' || chatStatus === 'disconnected',
        attention: attention.phase === 'waiting' || attention.phase === 'unsupported',
        running: chatStatus === 'running',
        resumed: chatStatus === 'ready' || chatStatus === 'running',
        resuming: chatStatus === 'connecting' || chatStatus === 'resuming',
        socketOpen: chatStatus === 'ready' || chatStatus === 'running',
        authenticated: Boolean(auth),
        reachable: Boolean(client),
      })
    : deriveConnectionView({
        error: connection.status === 'error',
        authExpired: authExpired && screen === 'connect',
        checking: connection.status === 'checking' || connection.status === 'connecting',
        reachable: connection.status === 'ready' || Boolean(client),
        authenticated: Boolean(auth) && screen === 'sessions',
      });

  useEffect(() => {
    const setViewportVars = () => {
      const viewport = window.visualViewport;
      const keyboardInset = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
      const viewportHeight = viewport?.height ?? window.innerHeight;
      const hasKeyboard = keyboardInset > 80 || (viewport ? viewport.height < window.innerHeight * 0.78 : false);
      const composerHeight = composerRef.current?.getBoundingClientRect().height ?? 72;
      document.documentElement.style.setProperty('--visual-viewport-height', `${viewportHeight}px`);
      document.documentElement.style.setProperty('--keyboard-inset-bottom', `${keyboardInset}px`);
      document.documentElement.style.setProperty('--composer-height', `${Math.ceil(composerHeight)}px`);
      document.documentElement.style.setProperty('--composer-bottom-buffer', hasKeyboard ? '8px' : '18px');
      document.documentElement.style.setProperty('--composer-safe-area-bottom', hasKeyboard ? '0px' : 'env(safe-area-inset-bottom)');
    };
    setViewportVars();
    window.visualViewport?.addEventListener('resize', setViewportVars);
    window.visualViewport?.addEventListener('scroll', setViewportVars);
    window.addEventListener('resize', setViewportVars);
    window.addEventListener('orientationchange', setViewportVars);
    return () => {
      window.visualViewport?.removeEventListener('resize', setViewportVars);
      window.visualViewport?.removeEventListener('scroll', setViewportVars);
      window.removeEventListener('resize', setViewportVars);
      window.removeEventListener('orientationchange', setViewportVars);
    };
  }, []);

  useEffect(() => {
    if (screen !== 'chat' || !composerRef.current) return;
    const updateComposerHeight = () => {
      const composerHeight = composerRef.current?.getBoundingClientRect().height ?? 72;
      document.documentElement.style.setProperty('--composer-height', `${Math.ceil(composerHeight)}px`);
    };
    updateComposerHeight();
    const observer = new ResizeObserver(updateComposerHeight);
    observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, [screen]);

  useEffect(() => {
    if (screen !== 'chat') return;
    const textarea = composerInputRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
    const composerHeight = composerRef.current?.getBoundingClientRect().height ?? 72;
    document.documentElement.style.setProperty('--composer-height', `${Math.ceil(composerHeight)}px`);
  }, [screen, composer, attachments.length]);

  function scrollChatToBottom() {
    window.requestAnimationFrame(() => {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
      messagesEndRef.current?.scrollIntoView({ block: 'end' });
    });
  }

  function scrollChatAfterKeyboardSettles() {
    if (!stickToBottomRef.current) return;
    scrollChatToBottom();
    window.setTimeout(scrollChatToBottom, 80);
    window.setTimeout(scrollChatToBottom, 300);
  }

  function onMessagesScroll() {
    const element = messagesRef.current;
    if (!element) return;
    stickToBottomRef.current = element.scrollHeight - element.scrollTop - element.clientHeight <= NEAR_BOTTOM_PX;
  }

  // Prepending an older page must keep the reader's anchor: restore the previous
  // distance from the top after the DOM grows. Otherwise follow the tail only when
  // the user was already near the bottom.
  useLayoutEffect(() => {
    if (screen !== 'chat') return;
    const element = messagesRef.current;
    const pending = pendingPrependRef.current;
    if (element && pending) {
      pendingPrependRef.current = null;
      element.scrollTop = pending.top + (element.scrollHeight - pending.height);
      return;
    }
    if (stickToBottomRef.current) scrollChatToBottom();
  }, [screen, visibleMessages.length, chatStatus, attention.phase]);

  useEffect(() => {
    if (screen !== 'sessions') return;
    const element = sessionListRef.current;
    if (element) element.scrollTop = sessionListScrollRef.current;
  }, [screen]);

  useEffect(() => {
    if (screen !== 'chat' || !client || !auth || !activeSession || chatStatus === 'running' || chatStatus === 'connecting' || chatStatus === 'resuming') return;
    const refresh = () => { void refreshHistory({ quiet: true }); };
    const interval = window.setInterval(refresh, 8_000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [screen, client, auth, activeSession?.id, chatStatus]);

  async function checkServer() {
    if (connection.mode === 'mock') {
      const mock = new MockHermesClient();
      const status = await mock.status();
      setClient(mock);
      setAuth({ mode: 'token', token: 'mock' });
      setConnection((state) => ({ ...state, status: 'ready', version: status.version, message: 'Mock mode ready. No network calls will be made.' }));
      return;
    }
    const normalized = normalizeServerUrl(connection.rawUrl);
    if (!normalized) {
      setConnection((state) => ({ ...state, status: 'error', message: 'Use an http:// or https:// Hermes dashboard URL.' }));
      return;
    }
    setConnection((state) => ({ ...state, status: 'checking', message: 'Checking Hermes dashboard…' }));
    try {
      const api = new HermesApiClient(normalized);
      const status = await api.status();
      const providers = await api.authProviders();
      const capability = api.capability(status, providers);
      saveServerUrl(normalized);
      setClient(api);
      setConnection((state) => ({
        ...state,
        rawUrl: normalized,
        status: 'ready',
        version: status.version,
        capability,
        mode: capability.kind === 'passwordAvailable' ? 'password' : 'token',
        message: status.auth_required ? 'Server reachable. Sign in to continue.' : 'Server reachable. Token mode is available; use a trusted private network only.',
      }));
    } catch (error) {
      const message = error instanceof HttpError
        ? `Hermes answered with an error (${error.status}). Retry or check the dashboard service.`
        : 'Couldn’t reach Bob’s House. Check internet and Tailscale, then retry.';
      setConnection((state) => ({ ...state, status: 'error', message }));
    }
  }

  async function connect(event: FormEvent) {
    event.preventDefault();
    let activeClient = client;
    setConnection((state) => ({ ...state, status: 'connecting', message: 'Signing in…' }));
    try {
      if (connection.mode === 'mock') {
        activeClient = new MockHermesClient();
        setClient(activeClient);
        setAuth({ mode: 'token', token: 'mock' });
        const loaded = await loadSessionPage(activeClient, { mode: 'token', token: 'mock' }, 0);
        setSessions(loaded.sessions);
        setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
        setContinueTarget(null);
        void loadRuntimeControls(activeClient, { mode: 'token', token: 'mock' });
        saveLoginHint({ mode: 'mock' });
        setConnection((state) => ({ ...state, status: 'ready', message: 'Mock mode connected. No real Hermes server was contacted.' }));
        setScreen('sessions');
        return;
      }
      const normalized = normalizeServerUrl(connection.rawUrl);
      if (!normalized) throw new Error('Invalid Hermes dashboard URL.');
      if (!activeClient || activeClient.baseUrl !== normalized) activeClient = new HermesApiClient(normalized);
      let session: AuthSession;
      if (connection.mode === 'password') {
        const provider = connection.capability?.kind === 'passwordAvailable' ? connection.capability.provider : 'basic';
        session = await activeClient.passwordLogin(provider, connection.username, connection.password);
        clearRememberedToken();
        saveLoginHint({ mode: 'password', username: connection.username });
      } else {
        if (!connection.token.trim()) throw new Error('Token is required for experimental token mode. Normal Hermes dashboards should use password mode; API_SERVER_KEY does not work here.');
        session = { mode: 'token', token: connection.token.trim() };
        if (connection.rememberToken) saveRememberedToken(session.token!);
        else clearRememberedToken();
        saveLoginHint({ mode: 'token', username: connection.username });
      }
      const loaded = await loadSessionPage(activeClient, session, 0);
      saveServerUrl(normalized);
      setClient(activeClient);
      setAuth(session);
      setAuthExpired(false);
      setSessions(loaded.sessions);
      setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
      setContinueTarget(await resolveContinueTarget(activeClient, session, loaded.sessions));
      void loadRuntimeControls(activeClient, session);
      setConnection((state) => ({ ...state, password: '', status: 'ready', message: 'Connected.' }));
      setHasLocalData(true);
      setScreen('sessions');
    } catch (error) {
      setConnection((state) => ({ ...state, status: 'error', message: error instanceof Error ? error.message : 'Sign-in failed.' }));
    }
  }

  function forgetDevice() {
    const removed = forgetThisDevice();
    setHasLocalData(false);
    gatewayRef.current?.close();
    setClient(null);
    setAuth(null);
    setSessions([]);
    setContinueTarget(null);
    setActiveSession(null);
    setHistory(null);
    setLiveMessages([]);
    setConnection((state) => ({
      ...state,
      username: '',
      password: '',
      token: '',
      rememberToken: false,
      status: 'idle',
      message: `Forgot this device: removed ${removed.length} local item${removed.length === 1 ? '' : 's'}. The dashboard cookie, if any, is not revoked here.`,
    }));
    setScreen('connect');
  }

  async function loadSessionPage(activeClient: Client, authSession: AuthSession, offset: number): Promise<SessionPage> {
    return activeClient.sessionPage(authSession, { limit: 75, offset });
  }

  async function loadRuntimeControls(activeClient: Client, authSession: AuthSession) {
    if (!('runtimeOptions' in activeClient)) return;
    try {
      const options = await activeClient.runtimeOptions(authSession);
      setRuntimeOptions(options);
      setRuntimeSelection((current) => {
        const currentModel = current.provider && current.model ? current : options.currentModel;
        return {
          profile: current.profile && options.profiles.includes(current.profile) ? current.profile : options.currentProfile,
          provider: currentModel?.provider,
          model: currentModel?.model,
        };
      });
    } catch {
      // Runtime controls are optional; session list/chat should still work.
    }
  }

  async function loadMoreSessions() {
    if (!client || !auth || sessionsLoading) return;
    const nextOffset = sessions.length;
    setSessionsLoading(true);
    setBanner('');
    try {
      const loaded = await loadSessionPage(client, auth, nextOffset);
      setSessions((current) => [...current, ...loaded.sessions.filter((session) => !current.some((seen) => seen.id === session.id))]);
      setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
    } catch (error) {
      setBanner(handleAuthFailure(error, 'Could not load more sessions.'));
    } finally {
      setSessionsLoading(false);
    }
  }

  function applyPage(generation: number, page: HistoryPage, scopeKey: string, mode: 'initial' | 'older' | 'refresh') {
    if (generation !== openGenerationRef.current) return;
    setHistory((current) => current ? applyHistoryPage(current, page, scopeKey, mode) : current);
    if (mode === 'refresh') {
      setLiveMessages((current) => dedupeLiveAgainstHistory(current, page.messages));
    }
  }

  async function refreshHistory(options: { quiet?: boolean } = {}) {
    if (!client || !auth || !activeSession || !('sessionHistoryPage' in client)) return;
    const current = historyRef.current;
    const historySession = historySessionRef.current ?? activeSession;
    if (!current || current.load !== 'idle') return;
    const generation = openGenerationRef.current;
    const scopeKey = current.scopeKey;
    if (!options.quiet) setBanner('Refreshing transcript…');
    setHistory((state) => state ? beginHistoryLoad(state, 'refreshing') : state);
    try {
      const page = await client.sessionHistoryPage(auth, historySession, { limit: HISTORY_PAGE_SIZE, offset: 0 });
      applyPage(generation, page, scopeKey, 'refresh');
      if (!options.quiet) setBanner('');
    } catch (error) {
      if (generation !== openGenerationRef.current) return;
      const message = handleAuthFailure(error, 'Could not refresh transcript.');
      setHistory((state) => state ? failHistoryLoad(state, message) : state);
      if (!options.quiet) setBanner(message);
    }
  }

  async function loadOlderMessages() {
    if (!client || !auth || !activeSession || !('sessionHistoryPage' in client)) return;
    const current = historyRef.current;
    const historySession = historySessionRef.current ?? activeSession;
    if (!current || current.load !== 'idle' || current.reachedBeginning) return;
    const generation = openGenerationRef.current;
    const scopeKey = current.scopeKey;
    const element = messagesRef.current;
    setHistory((state) => state ? beginHistoryLoad(state, 'older') : state);
    try {
      const page = await client.sessionHistoryPage(auth, historySession, { limit: HISTORY_PAGE_SIZE, offset: current.loadedRawCount });
      if (element) pendingPrependRef.current = { height: element.scrollHeight, top: element.scrollTop };
      stickToBottomRef.current = false;
      applyPage(generation, page, scopeKey, 'older');
    } catch (error) {
      if (generation !== openGenerationRef.current) return;
      setHistory((state) => state ? failHistoryLoad(state, handleAuthFailure(error, 'Could not load older messages.')) : state);
    }
  }

  function closeGateway() {
    gatewayRef.current?.close();
    gatewayRef.current = null;
  }

  function backToSessions() {
    openGenerationRef.current += 1;
    closeGateway();
    setScreen('sessions');
  }

  async function openSession(session: HermesSession) {
    if (!client || !auth) return;
    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    sessionListScrollRef.current = sessionListRef.current?.scrollTop ?? 0;
    closeGateway();
    historySessionRef.current = session;
    liveSessionIdRef.current = session.id;
    const scope = historyScopeFor(session, client);
    const scopeKey = historyScopeKey(scope);
    scopeKeyRef.current = scopeKey;
    setActiveSession(session);
    setHistory(beginHistoryLoad(createHistoryState(scope), 'initial'));
    setLiveMessages([]);
    setAttention(createAttentionState(scopeKey));
    setLineageNote('');
    setScreen('chat');
    setChatStatus('connecting');
    setBanner('');
    stickToBottomRef.current = true;
    const stale = () => generation !== openGenerationRef.current;
    try {
      let historySession = session;
      if ('sessionHistoryPage' in client) {
        const resolved = await client.resolveLatestSession(auth, session).catch(() => session);
        const detail = await client.sessionDetail(auth, resolved).catch((error: unknown) => {
          if (isNotFoundError(error) && resolved.id === session.id) throw error;
          return resolved;
        });
        if (stale()) return;
        historySession = { ...session, ...detail, title: session.title ?? detail.title };
        historySessionRef.current = historySession;
        if (historySession.id !== session.id) setLineageNote('This conversation continued in a newer segment; showing the full lineage.');
        try {
          const page = await client.sessionHistoryPage(auth, historySession, { limit: HISTORY_PAGE_SIZE, offset: 0 });
          applyPage(generation, page, scopeKey, 'initial');
        } catch (error) {
          if (stale()) return;
          setHistory((state) => state ? failHistoryLoad(state, handleAuthFailure(error, 'Could not load previous messages.')) : state);
        }
      } else {
        setHistory((state) => state ? { ...applyHistoryPage(state, { sessionId: session.id, messages: starterMessages(session), limit: HISTORY_PAGE_SIZE, offset: 0, returned: 0, reachedBeginning: true }, scopeKey, 'initial') } : state);
      }
      if (stale()) return;
      const gateway = await client.connectGateway(auth, {
        onOpen: () => { if (!stale()) setChatStatus((current) => current === 'connecting' ? 'resuming' : current); },
        onClose: () => {
          if (stale()) return;
          setChatStatus('lost');
          setAttention((current) => markDisconnected(current));
          setBanner('Connection lost. Reopen the session to reconnect; nothing was re-sent.');
        },
        onError: (error) => { if (!stale()) { setChatStatus('error'); setBanner(error.message); } },
        onEvent: (gatewayEvent) => {
          if (stale()) return;
          const request = attentionFromEvent(gatewayEvent);
          setAttention((current) => {
            const next = request ? showAttention(current, request, scopeKey) : current;
            return reconcileEvent(next, gatewayEvent, scopeKey);
          });
          setLiveMessages((current) => eventToMessages(gatewayEvent, current));
          if (gatewayEvent.type === 'message.start' || gatewayEvent.type === 'message.delta') setChatStatus((current) => current === 'ready' ? 'running' : current);
          if (gatewayEvent.type === 'message.complete') setChatStatus('ready');
        },
      });
      if (stale()) { gateway.close(); return; }
      gatewayRef.current = gateway;
      setChatStatus('resuming');
      const resumeTarget = historySessionRef.current ?? session;
      const resume = await gateway.resumeSession(resumeTarget.id, resumeTarget.profile);
      if (stale()) return;
      liveSessionIdRef.current = resume.sessionId || resumeTarget.id;
      // Requests that arrived on this fresh connection (during resume) are live by
      // definition; only a response we already sent needs reconciling against open keys.
      setAttention((current) => {
        const liveKey = current.phase === 'waiting' ? requestKey(current.request) : undefined;
        return reconcileResume(current, liveKey ? [...resume.openRequestKeys, liveKey] : resume.openRequestKeys, scopeKey);
      });
      setActiveSession(resumeTarget);
      setChatStatus(resume.running ? 'running' : 'ready');
      const storageScope = currentScope(session, client);
      if (storageScope) {
        saveContinueReference(storageScope, { sessionId: session.id, title: session.title });
        setContinueTarget({ session, loaded: true });
      }
    } catch (error) {
      if (stale()) return;
      if (isNotFoundError(error)) {
        clearContinueReference();
        setContinueTarget(null);
        setSessions((current) => current.filter((item) => item.id !== session.id));
        setScreen('sessions');
        setBanner('That conversation is no longer available on this host and profile.');
        return;
      }
      setChatStatus('error');
      setBanner(handleAuthFailure(error, 'Could not open session.'));
    }
  }

  async function startConfiguredChat() {
    setNewChatSheetOpen(false);
    await newChat();
  }

  async function newChat() {
    const session: HermesSession = { id: `new-${Date.now()}`, title: 'New chat', preview: 'Fresh Hermes session', updated_at: new Date().toISOString() };
    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    closeGateway();
    liveSessionIdRef.current = session.id;
    setActiveSession(session);
    setHistory(null);
    setLiveMessages([]);
    setAttention(createAttentionState(''));
    setLineageNote('');
    setScreen('chat');
    setChatStatus('connecting');
    if (!client || !auth) return;
    const stale = () => generation !== openGenerationRef.current;
    try {
      const gateway = await client.connectGateway(auth, {
        onOpen: () => { if (!stale()) setChatStatus('ready'); },
        onClose: () => { if (!stale()) { setChatStatus('lost'); setAttention((current) => markDisconnected(current)); } },
        onError: (error) => { if (!stale()) { setChatStatus('error'); setBanner(error.message); } },
        onEvent: (gatewayEvent) => {
          if (stale()) return;
          const request = attentionFromEvent(gatewayEvent);
          setAttention((current) => reconcileEvent(request ? showAttention(current, request, scopeKeyRef.current) : current, gatewayEvent, scopeKeyRef.current));
          setLiveMessages((current) => eventToMessages(gatewayEvent, current));
          if (gatewayEvent.type === 'message.complete') setChatStatus('ready');
        },
      });
      if (stale()) { gateway.close(); return; }
      gatewayRef.current = gateway;
      const selectedRuntime = selectedRuntimePayload(runtimeSelection, reasoningChoice);
      const createdIds = await gateway.createSession(selectedRuntime);
      if (stale()) return;
      const id = createdIds.storedId;
      const created = { ...session, id, profile: selectedRuntime.profile };
      historySessionRef.current = created;
      liveSessionIdRef.current = createdIds.liveId || id;
      const scope = historyScopeFor(created, client);
      scopeKeyRef.current = historyScopeKey(scope);
      setAttention(createAttentionState(scopeKeyRef.current));
      setHistory(applyHistoryPage(createHistoryState(scope), { sessionId: id, messages: [], limit: HISTORY_PAGE_SIZE, offset: 0, returned: 0, reachedBeginning: true }, historyScopeKey(scope), 'initial'));
      setActiveSession(created);
      setSessions((current) => [created, ...current]);
      setSessionPage((current) => ({ ...current, total: typeof current.total === 'number' ? current.total + 1 : current.total }));
      const storageScope = currentScope(created, client);
      if (storageScope) {
        saveContinueReference(storageScope, { sessionId: id, title: created.title });
        setContinueTarget({ session: created, loaded: true });
      }
      setChatStatus('ready');
    } catch (error) {
      if (stale()) return;
      setChatStatus('error');
      setBanner(error instanceof Error ? error.message : 'Could not create chat.');
    }
  }

  async function respondToApproval(choice: 'once' | 'deny') {
    const request = attention.request;
    const key = requestKey(request);
    if (!request || !key || request.kind !== 'approval' || !activeSession || !gatewayRef.current) return;
    const scopeKey = scopeKeyRef.current;
    const started = beginResponse(attention, key, scopeKey);
    if (!started) return;
    setAttention(started);
    const gateway = gatewayRef.current;
    try {
      const sessionId = liveSessionIdRef.current || activeSession.id;
      if (request.serverRequestId) {
        gateway.respondServerRequest(request.serverRequestId, { choice });
        setAttention((current) => markSent(current, key, Date.now()));
      } else {
        await gateway.respondApproval(sessionId, request.requestId!, choice);
        setAttention((current) => current.responseKey === key ? { ...current, phase: 'resolved', request: null, note: choice === 'once' ? 'Approved once.' : 'Denied.' } : current);
      }
    } catch (error) {
      setAttention((current) => markSendFailed(current, key, error instanceof Error ? error.message : 'Could not respond to approval.'));
    }
  }

  async function respondToClarify(answer: string) {
    const request = attention.request;
    const key = requestKey(request);
    if (!request || !key || request.kind !== 'clarify' || !activeSession || !gatewayRef.current) return;
    const scopeKey = scopeKeyRef.current;
    const started = beginResponse(attention, key, scopeKey);
    if (!started) return;
    setAttention(started);
    const gateway = gatewayRef.current;
    try {
      const sessionId = liveSessionIdRef.current || activeSession.id;
      if (request.serverRequestId) {
        if (!request.questionId) throw new Error('This question has no answer slot; use the full dashboard.');
        gateway.respondServerRequest(request.serverRequestId, clarifyServerRequestResult(request.questionId, answer));
        setAttention((current) => markSent(current, key, Date.now()));
      } else {
        await gateway.respondClarify(sessionId, request.requestId!, answer, request.questionId);
        setAttention((current) => current.responseKey === key ? { ...current, phase: 'resolved', request: null, note: 'Answer sent.' } : current);
      }
    } catch (error) {
      setAttention((current) => markSendFailed(current, key, error instanceof Error ? error.message : 'Could not send clarification.'));
    }
  }

  // Requests this surface cannot render are handed back immediately (4404 "not shown here") so the
  // agent is not left waiting on the phone; the card stays visible with manual instructions.
  const declinedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const request = attention.request;
    if (!request?.serverRequestId || !gatewayRef.current) return;
    if (!shouldDeclineOnPhone(request) || declinedRef.current.has(request.serverRequestId)) return;
    declinedRef.current.add(request.serverRequestId);
    gatewayRef.current.declineServerRequest(request.serverRequestId);
    setAttention((current) => current.request?.serverRequestId === request.serverRequestId
      ? { ...current, phase: 'unsupported', note: 'Handed back to Hermes: answer this in the full dashboard.' }
      : current);
  }, [attention.request?.serverRequestId]);

  const composerBlockedByAttention = attention.phase === 'waiting' || attention.phase === 'submitting';
  const canSendNow = chatStatus === 'ready' && !composerBlockedByAttention;
  const canEngageRunning = chatStatus === 'running' && !composerBlockedByAttention && attachments.length === 0;

  async function submitPrompt(event: FormEvent) {
    event.preventDefault();
    const text = composer.trim();
    if ((!text && attachments.length === 0) || !activeSession || !gatewayRef.current || !canSendNow) return;
    const files = attachments;
    const generation = openGenerationRef.current;
    const gateway = gatewayRef.current;
    setComposer('');
    setAttachments([]);
    setChatStatus('running');
    try {
      const sessionId = liveSessionIdRef.current || activeSession.id;
      const attachmentRefs = [];
      for (const file of files) {
        setBanner(`Uploading ${file.name}…`);
        attachmentRefs.push(await gateway.attachFile(sessionId, file));
      }
      if (generation !== openGenerationRef.current) return;
      const visibleText = [text, ...files.map((file) => `📎 ${file.name}`)].filter(Boolean).join('\n');
      setLiveMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text: visibleText, state: 'complete' }]);
      setBanner('');
      stickToBottomRef.current = true;
      const promptText = [text, ...attachmentRefs.map((file) => file.text)].filter(Boolean).join('\n\n') || 'Please review the attached file(s).';
      await gateway.submitPrompt(sessionId, promptText);
    } catch (error) {
      if (generation !== openGenerationRef.current) return;
      setChatStatus('error');
      const message = error instanceof Error ? error.message : 'Prompt submit failed.';
      setBanner(files.length ? `Attachment/send failed: ${message}` : `Not sent: ${message}`);
      setComposer(text);
      setAttachments(files);
      setLiveMessages((current) => [...current, { id: `err-${Date.now()}`, role: 'status', text: files.length ? 'Attachment upload failed. File(s) restored in the composer; nothing was sent.' : 'Prompt was not sent. Your draft is restored.', state: 'error' }]);
    }
  }

  // Verified running-turn inputs. Queue runs after the current turn; Steer injects into
  // the current turn. A bare prompt.submit is never used while running because the
  // gateway's busy mode on this host would interrupt the live turn.
  async function engageRunning(mode: 'queue' | 'steer') {
    const text = composer.trim();
    if (!text || !activeSession || !gatewayRef.current || !canEngageRunning) return;
    const gateway = gatewayRef.current;
    const generation = openGenerationRef.current;
    const sessionId = liveSessionIdRef.current || activeSession.id;
    setBanner(mode === 'queue' ? 'Queueing for after this turn…' : 'Sending steer…');
    try {
      if (mode === 'queue') {
        const outcome = await gateway.queuePrompt(sessionId, text);
        if (generation !== openGenerationRef.current) return;
        if (outcome.status === 'queued' || outcome.status === 'streaming') {
          setComposer('');
          setLiveMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text, state: 'complete', meta: outcome.status === 'queued' ? 'queued for after this turn' : 'sent' }]);
          setBanner(outcome.status === 'queued' ? 'Queued. Hermes will run it after the current turn.' : 'The turn had just finished, so this was sent as a normal message.');
          stickToBottomRef.current = true;
        } else {
          setBanner(`Hermes returned an unexpected status (${outcome.raw || 'unknown'}). Your draft is kept; nothing was confirmed.`);
        }
        return;
      }
      const outcome = await gateway.steerSession(sessionId, text, historySessionRef.current?.profile);
      if (generation !== openGenerationRef.current) return;
      if (outcome.status === 'accepted') {
        setComposer('');
        setLiveMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text, state: 'complete', meta: 'steer' }]);
        setBanner('Steer accepted. Hermes applies it during the current turn.');
        stickToBottomRef.current = true;
      } else if (outcome.status === 'rejected') {
        setChatStatus('ready');
        setBanner('The turn already finished. Send it as a normal message instead.');
      } else if (outcome.status === 'unsupported') {
        setBanner('This agent does not support steering. Use Queue instead; your draft is kept.');
      } else {
        setBanner(`Hermes returned an unexpected status (${outcome.raw || 'unknown'}). Your draft is kept; nothing was confirmed.`);
      }
    } catch (error) {
      if (generation !== openGenerationRef.current) return;
      setBanner(`Not sent: ${error instanceof Error ? error.message : 'request failed'}. Your draft is kept.`);
    }
  }

  function onFilesSelected(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    setAttachments((current) => [...current, ...selected]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const canLoadMore = !sessionFilter && typeof sessionPage.total === 'number' && sessions.length < sessionPage.total;
  const hostLabel = client && !client.baseUrl.startsWith('mock') ? hostLabelFor(client.baseUrl) : client ? 'Mock demo' : '';

  return (
    <div className="app-shell">
      <header className="topbar">
        {screen === 'chat' ? <button className="icon-btn" onClick={backToSessions} aria-label="Back to sessions"><ArrowLeft size={20} /></button> : <div className="brand-mark"><img src="/icons/icon.svg" alt="Hermes Mobile" /></div>}
        <div>
          <div className="eyebrow">{screen === 'chat' && activeSession?.profile ? `${hostLabel || 'Hermes'} · ${activeSession.profile}` : hostLabel || 'Hermes Mobile'}</div>
          <h1>{screen === 'connect' ? 'Connect' : screen === 'sessions' ? 'Sessions' : activeSession?.title ?? 'Chat'}</h1>
        </div>
        <StatusPill view={connectionView} />
      </header>

      <main className="main-panel">
        {screen === 'connect' && (
          <section className="connect-card">
            <div className="hero-orb"><Bot size={44} /></div>
            <h2>Your agent, pocket-sized.</h2>
            <p>Connect to a private Hermes dashboard and drive real sessions from a phone-friendly UI.</p>
            <form onSubmit={connect} className="stack">
              <CustomSelect
                label="Mode"
                value={connection.mode}
                options={authModeOptions}
                onChange={(mode) => setConnection((state) => ({ ...state, mode }))}
              />
              {connection.mode !== 'mock' && <label><span>Hermes URL</span><input inputMode="url" placeholder="http://mac.tailnet:9119" value={connection.rawUrl} onChange={(event) => setConnection((state) => ({ ...state, rawUrl: event.target.value, status: 'idle' }))} /></label>}
              {connection.mode === 'password' && <div className="grid2"><label><span>Username</span><input autoComplete="username" value={connection.username} onChange={(event) => setConnection((state) => ({ ...state, username: event.target.value }))} /></label><label><span>Password</span><input type="password" autoComplete="current-password" value={connection.password} onChange={(event) => setConnection((state) => ({ ...state, password: event.target.value }))} /></label></div>}
              {connection.mode === 'token' && <><label><span>Dashboard bearer token</span><input type="password" autoComplete="off" value={connection.token} onChange={(event) => setConnection((state) => ({ ...state, token: event.target.value }))} /></label><div className="security-note"><CircleAlert size={16} /> Experimental: API_SERVER_KEY does not work here. Use only with a dashboard token provider for these routes.</div><label className="check-row"><input type="checkbox" checked={connection.rememberToken} onChange={(event) => setConnection((state) => ({ ...state, rememberToken: event.target.checked }))} /> Remember token on this device</label></>}
              <div className="button-row">
                <button type="button" className="secondary" onClick={checkServer}>{connection.mode === 'mock' ? 'Enable mock' : connection.status === 'error' ? 'Retry' : 'Check server'}</button>
                <button type="submit" className="primary">Connect</button>
              </div>
            </form>
            <InfoBanner status={connection.status} message={connection.message} />
            <div className="security-note"><ShieldCheck size={16} /> Passwords are never persisted. Use Tailscale/VPN; do not expose Hermes publicly.</div>
            {hasLocalData && <button type="button" className="forget-device" onClick={forgetDevice}>Forget this device</button>}
          </section>
        )}

        {screen === 'sessions' && (
          <section className="sessions-screen">
            <div className="session-summary"><strong>{sessions.length}</strong><span>{typeof sessionPage.total === 'number' ? ` of ${sessionPage.total} conversations loaded` : ' conversations loaded'}</span></div>
            {banner && <div className="inline-banner"><WifiOff size={16} /> {banner}</div>}
            <div className="search-wrap"><Search size={18} /><input placeholder="Search loaded sessions" value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} /></div>
            <button className="new-chat" onClick={() => setNewChatSheetOpen(true)}><Plus size={20} /> New chat</button>
            <div className="session-list" ref={sessionListRef}>
              {continueTarget && !sessionFilter && (
                <button className="session-row continue-row" onClick={() => openSession(continueTarget.session)} aria-label={`Continue ${continueTarget.session.title || 'last conversation'}`}>
                  <div className="session-dot"><RefreshCw size={15} /></div>
                  <div className="session-copy"><small className="continue-label">Continue</small><strong>{continueTarget.session.title || continueTarget.session.preview || 'Last conversation'}</strong><span>{[continueTarget.session.profile, continueTarget.loaded ? 'in recent list' : 'older than the loaded list'].filter(Boolean).join(' · ')}</span></div>
                  <time>{relativeTime(continueTarget.session.updated_at)}</time>
                </button>
              )}
              {filteredSessions.map((session) => <button key={`${session.profile ?? ''}:${session.id}`} className="session-row" onClick={() => openSession(session)}><div className="session-dot">{session.running ? <Radio size={15} /> : <MessageCircle size={15} />}</div><div className="session-copy"><strong>{session.title || session.preview || 'Untitled session'}</strong><span>{session.preview || session.source || session.id}</span><small>{[session.message_count ? `${session.message_count} messages` : '', session.profile, session.workspace, session.source].filter(Boolean).join(' · ')}</small></div><time>{relativeTime(session.updated_at)}</time></button>)}
              {canLoadMore && <button className="load-more" onClick={loadMoreSessions} disabled={sessionsLoading}>{sessionsLoading ? 'Loading…' : `Load more (${Math.min(75, (sessionPage.total ?? sessions.length) - sessions.length)} more)`}</button>}
            </div>
          </section>
        )}

        {screen === 'chat' && (
          <section className="chat-screen">
            {banner && <div className="inline-banner"><WifiOff size={16} /> {banner}</div>}
            <div className="chat-tools">
              {history && !history.reachedBeginning && presentation !== 'loading' && presentation !== 'error' && (
                <button type="button" className="load-older" onClick={loadOlderMessages} disabled={history.load !== 'idle'}>{history.load === 'older' ? 'Loading older…' : 'Load older messages'}</button>
              )}
              <button type="button" className="refresh-chat" onClick={() => refreshHistory()} disabled={!history || history.load !== 'idle'}><RefreshCw size={15} /> Refresh transcript</button>
            </div>
            <div className="messages" ref={messagesRef} onScroll={onMessagesScroll}>
              {lineageNote && <div className="history-state" role="status">{lineageNote}</div>}
              {presentation === 'loading' && <div className="history-state" role="status" data-history="loading">Loading previous messages…</div>}
              {presentation === 'error' && <div className="history-state bad" role="alert" data-history="error">Couldn’t load previous messages: {history?.error} <button type="button" onClick={() => void refreshHistory()}>Retry</button></div>}
              {presentation === 'complete' && history && history.messages.length > 0 && <div className="history-state subtle" data-history="complete">Beginning of conversation</div>}
              {presentation === 'partial' && history?.error && <div className="history-state bad" role="alert" data-history="partial-error">{history.error}</div>}
              {presentation === 'empty' && visibleMessages.length === 0 && <div className="empty-chat" data-history="empty"><Sparkles size={28} /><strong>Nothing here yet</strong><span>This conversation has no messages. Send a prompt to start.</span></div>}
              {visibleMessages.map((message) => <MessageRow key={message.id} message={message} />)}
              {attentionActive && attention.request && <AttentionCard request={attention.request} submitting={attention.phase === 'submitting'} locked={attention.phase !== 'waiting'} note={attention.note} onApproval={respondToApproval} onClarify={respondToClarify} />}
              {!attentionActive && attention.note && (attention.phase === 'resolved' || attention.phase === 'cancelled' || attention.phase === 'disconnected') && <div className={`history-state ${attention.phase === 'disconnected' ? 'bad' : 'subtle'}`} role="status" data-attention={attention.phase}>{attention.note}</div>}
              <div ref={messagesEndRef} />
            </div>
            <form ref={composerRef} className={`composer ${chatStatus === 'running' ? 'running' : ''}`} onSubmit={submitPrompt}>
              {composerBlockedByAttention && <div className="composer-hint" role="status">Answer the pending request above first. Ordinary messages don’t resolve it.</div>}
              {chatStatus === 'running' && !composerBlockedByAttention && <div className="composer-hint" role="status">Hermes is working. Queue runs after this turn; Steer nudges the current turn.{attachments.length ? ' Remove attachments to use these.' : ''}</div>}
              {(chatStatus === 'lost' || chatStatus === 'disconnected') && <div className="composer-hint bad" role="status">Connection lost. Go back and reopen the session; your draft stays here.</div>}
              {attachments.length > 0 && <div className="attachment-tray">{attachments.map((file, index) => <span className="attachment-chip" key={`${file.name}-${file.size}-${index}`}><span className="attachment-name">📎 {file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={13} /></button></span>)}</div>}
              <button type="button" className="attach" aria-label="Attach file or screenshot" onClick={() => fileInputRef.current?.click()}><Paperclip size={20} /></button>
              <input ref={fileInputRef} className="file-input" type="file" multiple accept="image/*,application/pdf,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx" onChange={(event) => onFilesSelected(event.target.files)} />
              <textarea ref={composerInputRef} value={composer} onChange={(event) => setComposer(event.target.value)} onFocus={scrollChatAfterKeyboardSettles} placeholder={chatStatus === 'running' ? 'Queue or steer…' : 'Message Hermes…'} rows={1} />
              {chatStatus === 'running'
                ? <div className="running-actions">
                    <button type="button" className="queue" aria-label="Queue for after this turn" disabled={!composer.trim() || !canEngageRunning} onClick={() => engageRunning('queue')}>Queue</button>
                    <button type="button" className="steer" aria-label="Steer the current turn" disabled={!composer.trim() || !canEngageRunning} onClick={() => engageRunning('steer')}>Steer</button>
                  </div>
                : <button className="send" aria-label="Send message" disabled={(!composer.trim() && attachments.length === 0) || !canSendNow}><SendHorizonal size={20} /></button>}
            </form>
          </section>
        )}
      </main>

      {newChatSheetOpen && (
        <div className="sheet-backdrop" role="presentation">
          <section className="new-chat-sheet" role="dialog" aria-modal="true" aria-labelledby="new-chat-title">
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-header">
              <div>
                <div className="eyebrow">Configure once</div>
                <h2 id="new-chat-title">New chat</h2>
              </div>
              <button type="button" className="icon-btn" aria-label="Cancel new chat" onClick={() => setNewChatSheetOpen(false)}><X size={18} /></button>
            </div>
            <p className="sheet-copy">Pick the runtime for this chat. These choices do not change your global Hermes defaults.</p>
            <div className="runtime-controls" aria-label="New chat runtime controls">
              <CustomSelect
                label="Profile"
                value={runtimeSelection.profile || runtimeOptions.currentProfile || 'default'}
                options={(runtimeOptions.profiles.length ? runtimeOptions.profiles : ['default']).map((profile) => ({ value: profile, label: profile }))}
                onChange={(profile) => setRuntimeSelection((state) => ({ ...state, profile }))}
              />
              {modelSelectOptions.length > 0 && <CustomSelect
                label="Model"
                value={selectedModelKey}
                options={modelSelectOptions}
                onChange={(key) => setRuntimeSelection((state) => ({ ...state, ...modelFromKey(key) }))}
              />}
              <CustomSelect
                label="Reasoning"
                value={reasoningChoice}
                options={[...reasoningOptions]}
                onChange={setReasoningChoice}
              />
            </div>
            <div className="sheet-actions">
              <button type="button" className="secondary" onClick={() => setNewChatSheetOpen(false)}>Cancel</button>
              <button type="button" className="primary" onClick={startConfiguredChat}>Start chat</button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function dedupeLiveAgainstHistory(live: ChatMessage[], historyMessages: ChatMessage[]): ChatMessage[] {
  if (!live.length || !historyMessages.length) return live;
  const seen = new Set(historyMessages.map((message) => `${message.role}\u0000${message.text.trim()}`));
  return live.filter((message) => message.state === 'streaming' || message.role === 'status' || !seen.has(`${message.role}\u0000${message.text.trim()}`));
}

function hostLabelFor(baseUrl: string): string {
  try {
    const url = new URL(baseUrl);
    if (/^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return url.host;
    return url.hostname.split('.')[0] || url.host;
  } catch {
    return '';
  }
}

function compactMessagesForMobile(messages: ChatMessage[]): ChatMessage[] {
  const compacted: ChatMessage[] = [];
  for (const message of messages) {
    if (isToolLikeMessage(message)) continue;
    if (message.role === 'status' && message.text === 'Thinking…' && compacted.some((seen) => seen.role === 'assistant' && seen.state === 'streaming')) {
      continue;
    }
    compacted.push(message);
  }
  return compacted;
}

function isToolLikeMessage(message: ChatMessage): boolean {
  if (message.role === 'tool') return true;
  const text = message.text.trim();
  if (!text) return false;
  const meta = (message.meta ?? '').toLowerCase();
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

function StatusPill({ view }: { view: ConnectionView }) {
  const icon = view.tone === 'ok' ? <CheckCircle2 size={14} /> : view.tone === 'bad' || view.tone === 'attention' ? <CircleAlert size={14} /> : view.tone === 'busy' ? <Radio size={14} /> : <Clock3 size={14} />;
  return <div className={`status-pill tone-${view.tone}`} data-phase={view.phase} aria-live="polite">{icon}{view.label}</div>;
}

function InfoBanner({ status, message }: { status: ConnStatus; message: string }) {
  return <div className={`info-banner ${status === 'error' ? 'bad' : status === 'ready' ? 'ok' : ''}`}><Lock size={15} /> {message}</div>;
}

function runtimeModelKey(model: RuntimeModelOption): string {
  return `${model.provider}\u0000${model.model}`;
}

function modelFromKey(key: string): Pick<RuntimeSelection, 'provider' | 'model'> {
  const [provider, model] = key.split('\u0000');
  return { provider, model };
}

function shortModelLabel(model: RuntimeModelOption): string {
  const compact = model.model.replace(/^models\//, '').replace(/^openai\//, '').replace(/^anthropic\//, '');
  if (model.provider === 'mock') return model.label;
  return `${model.provider}: ${compact}`;
}

function fallbackModelOptions(selection: RuntimeSelection): RuntimeModelOption[] {
  return selection.provider && selection.model ? [{ provider: selection.provider, model: selection.model, label: `${selection.provider}: ${selection.model}` }] : [];
}

function selectedRuntimePayload(selection: RuntimeSelection, reasoning: ReasoningChoice): RuntimeSelection {
  return {
    ...(selection.profile ? { profile: selection.profile } : {}),
    ...(selection.provider ? { provider: selection.provider } : {}),
    ...(selection.model ? { model: selection.model } : {}),
    ...(reasoning !== 'inherit' ? { reasoning_effort: reasoning } : {}),
  };
}

function CustomSelect<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void }) {
  const [open, setOpen] = useState(false);
  const selectedIndex = Math.max(0, options.findIndex((option) => option.value === value));
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const selected = options[selectedIndex] ?? options[0];
  const listboxId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-select-options`;
  const activeOptionId = `${listboxId}-option-${activeIndex}`;
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setActiveIndex(selectedIndex);
  }, [selectedIndex]);

  useEffect(() => {
    if (!open) return;
    setActiveIndex(selectedIndex);
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node | null)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [open, selectedIndex]);

  function chooseOption(index: number) {
    const option = options[index];
    if (!option) return;
    onChange(option.value);
    setOpen(false);
  }

  function moveActive(delta: number) {
    if (options.length === 0) return;
    setActiveIndex((current) => (current + delta + options.length) % options.length);
  }

  return (
    <div className="select-field" ref={rootRef}>
      <span className="field-label" id={`${listboxId}-label`}>{label}</span>
      <button
        type="button"
        className="select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-labelledby={`${listboxId}-label ${listboxId}-value`}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown') {
            event.preventDefault();
            if (!open) setOpen(true);
            else moveActive(1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            if (!open) setOpen(true);
            else moveActive(-1);
          } else if (event.key === 'Home' && open) {
            event.preventDefault();
            setActiveIndex(0);
          } else if (event.key === 'End' && open) {
            event.preventDefault();
            setActiveIndex(options.length - 1);
          } else if ((event.key === 'Enter' || event.key === ' ') && open) {
            event.preventDefault();
            chooseOption(activeIndex);
          } else if (event.key === 'Escape') {
            setOpen(false);
          }
        }}
        onBlur={(event) => {
          if (!event.currentTarget.parentElement?.contains(event.relatedTarget as Node | null)) setOpen(false);
        }}
      >
        <span id={`${listboxId}-value`}>{selected.label}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {open && (
        <div className="select-options" role="listbox" id={listboxId} aria-labelledby={`${listboxId}-label`} tabIndex={-1}>
          {options.map((option, index) => (
            <button
              type="button"
              role="option"
              id={`${listboxId}-option-${index}`}
              aria-selected={option.value === value}
              className={`select-option ${index === activeIndex ? 'active' : ''}`}
              key={option.value}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => chooseOption(index)}
            >
              <span>{option.label}</span>
              {option.value === value && <CheckCircle2 size={16} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AttentionCard({ request, submitting, locked, note, onApproval, onClarify }: { request: AttentionRequest; submitting: boolean; locked: boolean; note?: string; onApproval: (choice: 'once' | 'deny') => void; onClarify: (answer: string) => void }) {
  const [answer, setAnswer] = useState('');
  const approvalActions = approvalActionAvailability(request);
  const canRespondToApproval = approvalActions.approveOnce || approvalActions.deny;
  const hasResponseHandle = Boolean(request.requestId || request.serverRequestId);
  const canRespondToClarify = request.kind === 'clarify' && hasResponseHandle && Boolean(request.choices?.length) && !request.multiSelect;
  const canRespondToFreeText = request.kind === 'clarify' && hasResponseHandle && request.freeText === true;
  // `locked` covers submitting and sent-unconfirmed: a second tap can never produce a second response.
  submitting = submitting || locked;

  useEffect(() => setAnswer(''), [request.requestId, request.detail]);
  return (
    <aside className={`attention-card ${request.kind}`} aria-live="polite" data-locked={locked ? 'true' : 'false'}>
      <div className="attention-card-heading">
        <CircleAlert size={18} aria-hidden="true" />
        <h3>{request.title}</h3>
      </div>
      <p>{request.detail}</p>
      {note && <p className="attention-note" role="status">{note}</p>}
      {request.kind === 'clarify' && request.choices?.length && !canRespondToClarify ? <div className="attention-choices" aria-label="Available choices">{request.choices.map((choice) => <span key={choice}>{choice}</span>)}</div> : null}
      {canRespondToApproval
        ? <div className={'attention-actions ' + (approvalActions.approveOnce && approvalActions.deny ? '' : 'single')}>
            {approvalActions.deny && <button type="button" className="secondary" disabled={submitting} onClick={() => onApproval('deny')}>Deny</button>}
            {approvalActions.approveOnce && <button type="button" className="primary" disabled={submitting} onClick={() => onApproval('once')}>{locked ? 'Sent' : submitting ? 'Sending…' : 'Approve once'}</button>}
          </div>
        : canRespondToClarify
          ? <div className="attention-choice-actions" aria-label="Answer choices">{request.choices?.map((choice) => <button key={choice} type="button" disabled={submitting} onClick={() => onClarify(choice)}>{choice}</button>)}</div>
          : canRespondToFreeText
            ? <form className="attention-answer" onSubmit={(event) => { event.preventDefault(); if (answer.trim()) onClarify(answer.trim()); }}>
                <input aria-label="Answer Hermes" placeholder="Type a short answer…" value={answer} onChange={(event) => setAnswer(event.target.value)} />
                <button type="submit" disabled={submitting || !answer.trim()}>{locked ? 'Sent' : submitting ? 'Sending…' : 'Send answer'}</button>
              </form>
            : request.kind === 'sudo' || request.kind === 'secret'
            ? <><small className="attention-privacy"><Lock size={14} aria-hidden="true" /> Sensitive values stay out of this PWA.</small><button type="button" disabled>Enter in full dashboard</button></>
            : request.multiSelect
              ? <button type="button" disabled>Choose multiple answers in full dashboard</button>
              : <button type="button" disabled>Response actions unavailable here</button>}
    </aside>
  );
}

function MessageRow({ message }: { message: ChatMessage }) {
  const text = formatMessageTextForMobile(message.role === 'tool' ? summarizeToolText(message.text) : message.text);
  return <article className={`message-row ${message.role} ${message.state ?? ''}`}><div className="message-meta">{message.role}{message.meta ? ` · ${message.meta}` : ''}</div><p>{renderMessageContent(text)}</p></article>;
}

function renderMessageContent(text: string) {
  const urlPattern = /(https?:\/\/[^\s<>()]+[^\s<>().,;:!?])/g;
  const urlOnlyPattern = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?]$/;
  const parts = text.split(urlPattern);
  return parts.map((part, index) => urlOnlyPattern.test(part)
    ? <a key={`${part}-${index}`} href={part} target="_blank" rel="noreferrer">{part}</a>
    : part);
}

function summarizeToolText(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith('{')) return text;
  try {
    const parsed = JSON.parse(trimmed) as { output?: unknown; exit_code?: unknown; error?: unknown; status?: unknown };
    const output = typeof parsed.output === 'string' ? parsed.output.trim() : '';
    const error = typeof parsed.error === 'string' ? parsed.error.trim() : '';
    const status = typeof parsed.status === 'string' ? parsed.status : '';
    const exit = typeof parsed.exit_code === 'number' ? `exit ${parsed.exit_code}` : status;
    const body = output || error || trimmed;
    const firstLines = body.split('\n').filter(Boolean).slice(0, 4).join('\n');
    const suffix = body.length > firstLines.length ? '\n…' : '';
    return [exit, `${firstLines}${suffix}`].filter(Boolean).join(' · ');
  } catch {
    return text;
  }
}

function relativeTime(value?: string) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  if (Number.isNaN(diff)) return '';
  const minutes = Math.max(1, Math.round(diff / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}
