import { ArrowLeft, Bot, CheckCircle2, ChevronDown, CircleAlert, Clock3, Lock, MessageCircle, Mic, Paperclip, Plus, Radio, RefreshCw, Search, SendHorizonal, Settings, ShieldCheck, Sparkles, Star, WifiOff, X } from 'lucide-react';
import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { approvalActionAvailability, AttachmentResult, attentionFromEvent, clarifyServerRequestResult, shouldDeclineOnPhone, AttentionRequest, AuthCapability, AuthMode, AuthSession, ChatMessage, eventToMessages, GatewayHandle, HermesApiClient, HermesSession, HistoryPage, HttpError, isAuthError, isNotFoundError, redactForLog, PreparedAttachment, RuntimeModelOption, RuntimeOptions, RuntimeSelection, SessionPage, normalizeServerUrl, VoiceLiveStatus } from './lib/hermesApi';
import { describeSendFailure, prepareAttachment, uploadPrepared } from './lib/attachments';
import { MockHermesClient, starterMessages } from './lib/mockHermes';
import { VoiceControls } from './components/VoiceControls';
import { useVoiceController } from './hooks/useVoiceController';
import { useLiveVoice } from './hooks/useLiveVoice';
import { BOB_PROFILE, canPinAsBobMain, resolveBobMain } from './lib/bobMain';
import { browserAudioEnv } from './lib/browserAudio';
import { BrowserLiveRtcEnv } from './lib/browserLiveRtc';
import { ChainedVoiceBackend } from './lib/chainedVoiceBackend';
import { FakeVoiceBackend } from './lib/fakeVoiceBackend';
import { LiveVoiceControllerDeps, toLiveHistory } from './lib/liveVoiceController';
import { LiveVoiceSession } from './lib/liveVoiceSession';
import { liveStateToVoiceState } from './lib/liveVoiceView';
import type { VoiceBackend } from './lib/voiceBackend';
import type { VoiceAction } from './lib/voiceView';
import { MessageContent } from './components/MessageContent';
import { compactMessagesForMobile } from './lib/mobileText';
import { ConnectionView, deriveConnectionView } from './lib/connectionState';
import { applyHistoryPage, beginHistoryLoad, createHistoryState, failHistoryLoad, historyPresentation, HistoryPresentation, HistoryScope, historyScopeKey, HistoryState } from './lib/history';
import { AttentionState, beginResponse, createAttentionState, markDisconnected, markSendFailed, markSent, reconcileEvent, reconcileResume, requestKey, showAttention } from './lib/attentionState';
import { appStorageKeys, BobMainReference, clearBobMainReference, clearContinueReference, clearRememberedToken, forgetThisDevice, loadActiveProfile, loadBobMainReference, loadContinueReference, loadLoginHint, loadRememberedToken, loadServerUrl, migrateLegacyStorage, saveActiveProfile, saveBobMainReference, saveContinueReference, saveLoginHint, saveRememberedToken, saveServerUrl, scopeFromServerUrl, StorageScope } from './lib/storage';
import { admitSessionsForProfile, historyPageBelongsToScope, isProfileActionStale, resolveActiveProfile, seedNewChatSelection, sessionRowKey } from './lib/profileScope';

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

type BobDialog = { kind: 'setup' } | { kind: 'stale' } | { kind: 'manage' } | { kind: 'error'; message: string };
// Monotonic counters (open generation, profile-load generation) captured to detect later navigation.
type NavigationMarks = { open: number; load: number };

// Mock mode has no real origin; the pin gets a synthetic, clearly fake host so it still persists
// and stays isolated from any real host's pin.
const MOCK_BOB_SCOPE: StorageScope = { origin: 'https://mock.hermes.invalid', basePath: '', profile: BOB_PROFILE };

function bobScopeFor(activeClient: Client | null): StorageScope | null {
  if (!activeClient) return null;
  if (activeClient.baseUrl.startsWith('mock')) return MOCK_BOB_SCOPE;
  return scopeFromServerUrl(activeClient.baseUrl, BOB_PROFILE);
}

function createFakeVoiceBackend(): FakeVoiceBackend {
  const backend = new FakeVoiceBackend();
  backend.auto = { listen: true, transcript: 'Hello Bob, what is on my plate today?', deny: null, speak: true, failSpeech: false, fallbackSpeech: false };
  return backend;
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
  const [activeProfile, setActiveProfile] = useState('default');
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
  const [attachments, setAttachments] = useState<PreparedAttachment[]>([]);
  const [preparing, setPreparing] = useState<{ key: number; names: string[] }[]>([]);
  const [chatStatus, setChatStatus] = useState<ChatStatus>('disconnected');
  const [banner, setBanner] = useState('');
  const [lineageNote, setLineageNote] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const [bobRef, setBobRef] = useState<BobMainReference | null>(null);
  const [bobBusy, setBobBusy] = useState(false);
  const [bobDialog, setBobDialog] = useState<BobDialog | null>(null);
  const gatewayRef = useRef<GatewayHandle | null>(null);
  const liveSessionIdRef = useRef<string>('');
  const [liveSessionId, setLiveSessionIdState] = useState('');
  const historySessionRef = useRef<HermesSession | null>(null);
  const scopeKeyRef = useRef<string>('');
  const openGenerationRef = useRef(0);
  const openedIdRef = useRef('');
  const voiceRef = useRef<ReturnType<typeof useVoiceController> | null>(null);
  const liveVoiceRef = useRef<ReturnType<typeof useLiveVoice> | null>(null);
  const liveMessagesRef = useRef<ChatMessage[]>([]);
  const submitLiveVoiceRef = useRef<(sessionId: string, text: string, voiceContext: string) => Promise<void>>(async () => { throw new Error('Not connected.'); });
  const sessionLoadGenerationRef = useRef(0);
  const activeProfileRef = useRef(activeProfile);
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
  // Bumped whenever prepared attachments are discarded; late preparation results from an older epoch are ignored.
  const attachmentEpochRef = useRef(0);
  const preparingKeyRef = useRef(0);
  // Gateway-accepted uploads per live session, so a retry after a failed prompt.submit does not attach twice.
  const uploadedAttachmentsRef = useRef(new Map<string, AttachmentResult>());

  const autoRestoreStarted = useRef(false);

  historyRef.current = history;
  activeProfileRef.current = activeProfile;

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

  async function resolveContinueTarget(activeClient: Client, authSession: AuthSession, loaded: HermesSession[], profile: string): Promise<ContinueTarget | null> {
    const scope = currentScope({ id: '', profile }, activeClient);
    if (!scope) return null;
    const reference = loadContinueReference(scope);
    if (!reference) return null;
    const inList = loaded.find((session) => session.id === reference.sessionId && admitSessionsForProfile([session], profile).length === 1);
    if (inList) return { session: inList, loaded: true };
    if (!('sessionDetail' in activeClient)) return null;
    try {
      const detail = await activeClient.sessionDetail(authSession, { id: reference.sessionId, profile, title: reference.title });
      if (detail.id !== reference.sessionId || admitSessionsForProfile([detail], profile).length !== 1) return null;
      return { session: { ...detail, profile, title: detail.title ?? reference.title }, loaded: false };
    } catch (error) {
      if (isNotFoundError(error)) clearContinueReference();
      return null;
    }
  }

  function clearAttachments() {
    attachmentEpochRef.current += 1;
    uploadedAttachmentsRef.current.clear();
    setAttachments([]);
    setPreparing([]);
  }

  // Prepared attachments belong to one open chat: leaving it (other session, profile, sessions list,
  // sign-out, forget device) discards them and ignores any read still in flight.
  useEffect(() => { clearAttachments(); }, [activeSession?.id, screen]);

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
        const profile = await configureRuntimeControls(api, restoredAuth);
        const loaded = await loadSessionPage(api, restoredAuth, 0, profile);
        setClient(api);
        setAuth(restoredAuth);
        setAuthExpired(false);
        setSessions(loaded.sessions);
        setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
        setContinueTarget(await resolveContinueTarget(api, restoredAuth, loaded.sessions, profile));
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

  // The transcript area changes height when the voice panel opens/closes or its captions wrap. If the
  // reader was following the tail (e.g. an approval card), keep following it.
  useEffect(() => {
    if (screen !== 'chat' || !messagesRef.current) return;
    const observer = new ResizeObserver(() => {
      if (stickToBottomRef.current && messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
    });
    observer.observe(messagesRef.current);
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
    if (stickToBottomRef.current || document.activeElement === textarea) {
      if (messagesRef.current) messagesRef.current.scrollTop = messagesRef.current.scrollHeight;
      scrollChatToBottom();
    }
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
        const profile = await configureRuntimeControls(activeClient, { mode: 'token', token: 'mock' });
        const loaded = await loadSessionPage(activeClient, { mode: 'token', token: 'mock' }, 0, profile);
        setSessions(loaded.sessions);
        setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
        setContinueTarget(null);

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
      const profile = await configureRuntimeControls(activeClient, session);
      const loaded = await loadSessionPage(activeClient, session, 0, profile);
      saveServerUrl(normalized);
      setClient(activeClient);
      setAuth(session);
      setAuthExpired(false);
      setSessions(loaded.sessions);
      setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
      setContinueTarget(await resolveContinueTarget(activeClient, session, loaded.sessions, profile));
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
    clearAttachments();
    setBobRef(null);
    setBobDialog(null);
    setVoiceOpen(false);
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

  async function loadSessionPage(activeClient: Client, authSession: AuthSession, offset: number, profile: string): Promise<SessionPage> {
    const page = await activeClient.sessionPage(authSession, { limit: 75, offset, profile });
    return { ...page, sessions: admitSessionsForProfile(page.sessions, profile) };
  }

  async function configureRuntimeControls(activeClient: Client, authSession: AuthSession): Promise<string> {
    let options: RuntimeOptions = { profiles: ['default'], currentProfile: 'default', models: [] };
    try {
      if ('runtimeOptions' in activeClient) options = await activeClient.runtimeOptions(authSession);
    } catch {
      // Runtime controls are optional; session list/chat should still work.
    }
    const hostScope = scopeFromServerUrl(activeClient.baseUrl);
    const remembered = hostScope ? loadActiveProfile(hostScope.origin, hostScope.basePath) : null;
    const profile = resolveActiveProfile(options.profiles, options.currentProfile, remembered);
    setRuntimeOptions(options);
    setActiveProfile(profile);
    activeProfileRef.current = profile;
    setRuntimeSelection((current) => {
      const currentModel = current.provider && current.model ? current : options.currentModel;
      return { profile, provider: currentModel?.provider, model: currentModel?.model };
    });
    return profile;
  }

  async function loadMoreSessions() {
    if (!client || !auth || sessionsLoading) return;
    const generation = sessionLoadGenerationRef.current;
    const profile = activeProfileRef.current;
    const nextOffset = sessions.length;
    setSessionsLoading(true);
    setBanner('');
    try {
      const loaded = await loadSessionPage(client, auth, nextOffset, profile);
      if (isProfileActionStale(generation, sessionLoadGenerationRef.current, profile, activeProfileRef.current)) return;
      setSessions((current) => [
        ...current,
        ...loaded.sessions.filter((session) => !current.some((seen) => seen.id === session.id)),
      ]);
      setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
    } catch (error) {
      if (!isProfileActionStale(generation, sessionLoadGenerationRef.current, profile, activeProfileRef.current)) {
        setBanner(handleAuthFailure(error, 'Could not load more sessions.'));
      }
    } finally {
      if (generation === sessionLoadGenerationRef.current) setSessionsLoading(false);
    }
  }

  // `onStarted` reports the generations this switch itself produced (synchronously, before any await),
  // so a caller can tell its own bumps from the user navigating while the switch is still loading.
  async function switchActiveProfile(profile: string, onStarted?: (marks: NavigationMarks) => void) {
    if (!client || !auth || profile === activeProfileRef.current || !runtimeOptions.profiles.includes(profile)) return;
    const generation = sessionLoadGenerationRef.current + 1;
    sessionLoadGenerationRef.current = generation;
    openGenerationRef.current += 1;
    onStarted?.({ open: openGenerationRef.current, load: generation });
    closeGateway();
    activeProfileRef.current = profile;
    setActiveProfile(profile);
    setRuntimeSelection((current) => ({ ...current, ...seedNewChatSelection(profile) }));
    setSessions([]);
    setSessionPage({ limit: 75, offset: 0 });
    setSessionFilter('');
    sessionListScrollRef.current = 0;
    setContinueTarget(null);
    setActiveSession(null);
    setHistory(null);
    historySessionRef.current = null;
    setLiveMessages([]);
    setAttention(createAttentionState(''));
    setComposer('');
    clearAttachments();
    setBanner('Loading conversations…');
    setSessionsLoading(true);
    const hostScope = scopeFromServerUrl(client.baseUrl);
    if (hostScope) saveActiveProfile(hostScope.origin, hostScope.basePath, profile);
    try {
      const loaded = await loadSessionPage(client, auth, 0, profile);
      if (isProfileActionStale(generation, sessionLoadGenerationRef.current, profile, activeProfileRef.current)) return;
      setSessions(loaded.sessions);
      setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
      setContinueTarget(await resolveContinueTarget(client, auth, loaded.sessions, profile));
      if (!isProfileActionStale(generation, sessionLoadGenerationRef.current, profile, activeProfileRef.current)) setBanner('');
    } catch (error) {
      if (!isProfileActionStale(generation, sessionLoadGenerationRef.current, profile, activeProfileRef.current)) {
        setBanner(handleAuthFailure(error, 'Could not load conversations for this profile.'));
      }
    } finally {
      if (generation === sessionLoadGenerationRef.current) setSessionsLoading(false);
    }
  }

  function applyPage(generation: number, page: HistoryPage, scopeKey: string, mode: 'initial' | 'older' | 'refresh') {
    if (generation !== openGenerationRef.current) return;
    setHistory((current) => {
      const target = historySessionRef.current;
      return current && target && historyPageBelongsToScope(page, { sessionId: target.id, profile: target.profile })
        ? applyHistoryPage(current, page, scopeKey, mode)
        : current;
    });
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

  // The live gateway session id: what message frames are tagged with and what voice must match.
  // Mirrored into state so the voice scope follows it (the ref alone would not re-render).
  function setLiveSessionId(id: string) {
    liveSessionIdRef.current = id;
    setLiveSessionIdState(id);
  }

  function closeGateway() {
    gatewayRef.current?.close();
    gatewayRef.current = null;
  }

  function backToSessions() {
    openGenerationRef.current += 1;
    closeGateway();
    clearAttachments();
    setVoiceOpen(false);
    setScreen('sessions');
  }

  // Connect the socket and resume the exact stored session. Shared by the first open and by the
  // single bounded reconnect; `mode` only changes the status copy. Never re-sends prompts.
  async function attachGateway(generation: number, scopeKey: string, target: HermesSession, mode: 'open' | 'reconnect') {
    if (!client || !auth) return;
    const stale = () => generation !== openGenerationRef.current;
    const gateway = await client.connectGateway(auth, {
      onOpen: () => { if (!stale()) setChatStatus((current) => current === 'connecting' ? 'resuming' : current); },
      onClose: () => {
        if (stale()) return;
        setChatStatus('lost');
        setAttention((current) => markDisconnected(current));
        setBanner('Connection lost. Nothing was re-sent.');
        voiceRef.current?.gatewayLost(); // the voice turn belongs to the dropped connection
        liveVoiceRef.current?.gatewayLost();
        // A drop while the page is visible gets one immediate bounded reconnect; a drop while
        // backgrounded (iOS freezes the page, the server's ping times out) reconnects on return.
        if (document.visibilityState === 'visible') void reconnectOnceRef.current('closed');
      },
      onError: (error) => { if (!stale()) { setChatStatus('error'); setBanner(redactForLog(error.message)); voiceRef.current?.gatewayLost(); liveVoiceRef.current?.gatewayLost(); } },
      onEvent: (gatewayEvent) => {
        if (stale()) return;
        const request = attentionFromEvent(gatewayEvent);
        setAttention((current) => {
          const next = request ? showAttention(current, request, scopeKey) : current;
          return reconcileEvent(next, gatewayEvent, scopeKey);
        });
        setLiveMessages((current) => eventToMessages(gatewayEvent, current));
        voiceRef.current?.gatewayEvent(gatewayEvent);
        liveVoiceRef.current?.gatewayEvent(gatewayEvent);
        if (gatewayEvent.type === 'message.start' || gatewayEvent.type === 'message.delta') setChatStatus((current) => current === 'ready' ? 'running' : current);
        if (gatewayEvent.type === 'message.complete') setChatStatus('ready');
      },
    });
    if (stale()) { gateway.close(); return; }
    gatewayRef.current = gateway;
    setChatStatus('resuming');
    const resume = await gateway.resumeSession(target.id, target.profile);
    if (stale()) return;
    setLiveSessionId(resume.sessionId || target.id);
    // Requests that arrived on this fresh connection (during resume) are live by
    // definition; only a response we already sent needs reconciling against open keys.
    setAttention((current) => {
      const liveKey = current.phase === 'waiting' ? requestKey(current.request) : undefined;
      return reconcileResume(current, liveKey ? [...resume.openRequestKeys, liveKey] : resume.openRequestKeys, scopeKey);
    });
    setActiveSession(target);
    setChatStatus(resume.running ? 'running' : 'ready');
    if (mode === 'reconnect') {
      setBanner('');
      void refreshHistory({ quiet: true });
    }
  }

  // Bounded reconnect: at most two attempts per trigger (the network is often not back the
  // instant a phone thaws), a short grace before each, cancelled by navigation (generation),
  // finite socket timeout, never a loop. Auth failure stops here and asks for sign-in.
  const RECONNECT_DELAYS_MS = [1_500, 5_000];
  const reconnectingRef = useRef(false);
  const reconnectOnceRef = useRef<(trigger: 'closed' | 'foreground' | 'manual') => Promise<void>>(async () => {});
  async function reconnectOnce(trigger: 'closed' | 'foreground' | 'manual') {
    if (reconnectingRef.current || !client || !auth || screenRef.current !== 'chat') return;
    const target = historySessionRef.current;
    if (!target || target.id.startsWith('new-')) return;
    const generation = openGenerationRef.current;
    const scopeKey = scopeKeyRef.current;
    reconnectingRef.current = true;
    closeGateway();
    setChatStatus('connecting');
    setBanner(trigger === 'manual' ? 'Reconnecting…' : 'Connection lost. Reconnecting…');
    const delays = trigger === 'manual' ? [0, RECONNECT_DELAYS_MS[1]] : RECONNECT_DELAYS_MS;
    try {
      for (let attempt = 0; attempt < delays.length; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, delays[attempt]));
        if (generation !== openGenerationRef.current || document.visibilityState !== 'visible') return;
        try {
          await attachGateway(generation, scopeKey, target, 'reconnect');
          return;
        } catch (error) {
          if (generation !== openGenerationRef.current) return;
          if (isAuthError(error) || attempt === delays.length - 1) {
            setChatStatus('lost');
            setBanner(`Couldn’t reconnect: ${handleAuthFailure(error, 'network error')}`);
            return;
          }
          setBanner('Still reconnecting…');
        }
      }
    } finally {
      reconnectingRef.current = false;
    }
  }

  reconnectOnceRef.current = reconnectOnce;
  const screenRef = useRef<Screen>(screen);
  screenRef.current = screen;

  useEffect(() => {
    if (screen !== 'chat') return;
    const onVisible = () => {
      if (document.visibilityState === 'visible' && (chatStatus === 'lost' || chatStatus === 'disconnected')) void reconnectOnce('foreground');
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener('pageshow', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener('pageshow', onVisible);
    };
  }, [screen, chatStatus, client, auth]);

  async function openSession(session: HermesSession, options: { openVoice?: boolean } = {}) {
    if (!client || !auth) return;
    if (admitSessionsForProfile([session], activeProfileRef.current).length !== 1) {
      setBanner('Switch to this conversation’s profile before opening it.');
      return;
    }
    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    sessionListScrollRef.current = sessionListRef.current?.scrollTop ?? 0;
    closeGateway();
    historySessionRef.current = session;
    setLiveSessionId(session.id);
    openedIdRef.current = session.id;
    setVoiceOpen(Boolean(options.openVoice));
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
      await attachGateway(generation, scopeKey, historySession, 'open');
      if (stale()) return;
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
    const session: HermesSession = { id: `new-${Date.now()}`, title: 'New chat', preview: 'Fresh Hermes session', updated_at: new Date().toISOString(), profile: runtimeSelection.profile ?? activeProfileRef.current };
    const generation = openGenerationRef.current + 1;
    openGenerationRef.current = generation;
    closeGateway();
    setLiveSessionId(session.id);
    openedIdRef.current = session.id;
    setVoiceOpen(false);
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
        onClose: () => { if (!stale()) { setChatStatus('lost'); setAttention((current) => markDisconnected(current)); voiceRef.current?.gatewayLost(); liveVoiceRef.current?.gatewayLost(); } },
        onError: (error) => { if (!stale()) { setChatStatus('error'); setBanner(redactForLog(error.message)); voiceRef.current?.gatewayLost(); liveVoiceRef.current?.gatewayLost(); } },
        onEvent: (gatewayEvent) => {
          if (stale()) return;
          const request = attentionFromEvent(gatewayEvent);
          setAttention((current) => reconcileEvent(request ? showAttention(current, request, scopeKeyRef.current) : current, gatewayEvent, scopeKeyRef.current));
          setLiveMessages((current) => eventToMessages(gatewayEvent, current));
          voiceRef.current?.gatewayEvent(gatewayEvent);
          liveVoiceRef.current?.gatewayEvent(gatewayEvent);
          if (gatewayEvent.type === 'message.complete') setChatStatus('ready');
        },
      });
      if (stale()) { gateway.close(); return; }
      gatewayRef.current = gateway;
      const selectedRuntime = selectedRuntimePayload({ ...runtimeSelection, profile: activeProfileRef.current }, reasoningChoice);
      const createdIds = await gateway.createSession(selectedRuntime);
      if (stale()) return;
      const id = createdIds.storedId;
      openedIdRef.current = id;
      const created = { ...session, id, profile: selectedRuntime.profile };
      historySessionRef.current = created;
      setLiveSessionId(createdIds.liveId || id);
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
  const canEngageRunning = chatStatus === 'running' && !composerBlockedByAttention && attachments.length === 0 && preparing.length === 0;

  // ---- Voice: a mode of the open ordinary chat. The text session stays authoritative. ----
  const voiceBackend = useMemo<VoiceBackend | null>(() => {
    if (!client || !auth) return null;
    if (!('audioSocketUrl' in client)) return createFakeVoiceBackend();
    return new ChainedVoiceBackend({
      audio: browserAudioEnv(),
      socketUrl: (kind, profile) => client.audioSocketUrl(kind, auth, profile),
      transcribeBatch: (profile, wav, signal) => client.transcribeAudio(auth, profile, wav, signal),
    });
  }, [client, auth]);

  useEffect(() => {
    if (!(voiceBackend instanceof FakeVoiceBackend)) return undefined;
    (window as unknown as { __fakeVoice?: FakeVoiceBackend }).__fakeVoice = voiceBackend;
    return () => { delete (window as unknown as { __fakeVoice?: FakeVoiceBackend }).__fakeVoice; };
  }, [voiceBackend]);

  // ---- Live voice (GPT-Live): chosen only when the gateway says it is available for this profile.
  // Anything else (older gateway, chained mode, no OpenAI key, mock client) stays on chained voice.
  const [liveVoiceStatus, setLiveVoiceStatus] = useState<VoiceLiveStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLiveVoiceStatus(null);
    if (!client || !auth || !('voiceLiveStatus' in client)) return undefined;
    client.voiceLiveStatus(auth, activeProfile).then(
      (status) => { if (!cancelled) setLiveVoiceStatus(status); },
      (error) => { if (!cancelled && isAuthError(error)) setBanner(handleAuthFailure(error, 'Session expired.')); },
    );
    return () => { cancelled = true; };
  }, [client, auth, activeProfile]);
  const liveEngine = liveVoiceStatus?.available === true && liveVoiceStatus.mode === 'gpt-live';
  liveMessagesRef.current = liveMessages;

  const liveRtcEnv = useMemo(() => (liveEngine ? new BrowserLiveRtcEnv() : null), [liveEngine]);
  const liveVoiceDeps = useMemo<Omit<LiveVoiceControllerDeps, 'onState'> | null>(() => {
    if (!client || !auth || !liveRtcEnv || !('voiceLiveSession' in client)) return null;
    return {
      createSession: (handlers) => new LiveVoiceSession(liveRtcEnv, handlers),
      exchange: (scope, sdp) => client.voiceLiveSession(auth, scope.profile, sdp, toLiveHistory(liveMessagesRef.current)),
      submit: (sessionId, text, voiceContext) => submitLiveVoiceRef.current(sessionId, text, voiceContext),
      steer: async (sessionId, text) => {
        const gateway = gatewayRef.current;
        if (!gateway) throw new Error('Not connected.');
        return gateway.steerSession(sessionId, text, activeProfileRef.current);
      },
      interrupt: async (sessionId) => {
        const gateway = gatewayRef.current;
        if (!gateway?.interruptSession) return { status: 'unknown' as const };
        return gateway.interruptSession(sessionId, activeProfileRef.current);
      },
    };
  }, [client, auth, liveRtcEnv]);

  // The scope's sessionId is the live gateway id (what message frames are tagged with), not the
  // durable history key, so voice can match frames exactly.
  const voiceScope = screen === 'chat' && activeSession && !activeSession.id.startsWith('new-') && liveSessionId
    ? { profile: activeSession.profile?.trim() || activeProfile, sessionId: liveSessionId }
    : null;
  const voiceBlockedReason = !voiceScope
    ? 'Voice is available once the chat is ready.'
    : composerBlockedByAttention
      ? 'Answer the pending request above first.'
      : chatStatus === 'running' && !liveEngine // live voice keeps talking while Bob works (steer/queue routing)
        ? 'Hermes is working. Voice is available when this turn finishes.'
        : chatStatus === 'lost' || chatStatus === 'disconnected'
          ? 'Reconnect to use voice.'
          : chatStatus !== 'ready' && !(liveEngine && chatStatus === 'running')
            ? 'Voice is available once the chat is ready.'
            : '';

  // Same submit path as the text composer: the live session through GatewayHandle.submitPrompt, with
  // the same busy/attention gating, so the turn lands in ordinary history and stays resumable.
  async function submitVoicePrompt(text: string): Promise<void> {
    const gateway = gatewayRef.current;
    if (!activeSession || !gateway) throw new Error('Not connected. Nothing was sent.');
    if (voiceBlockedReason || !canSendNow) throw new Error(`${voiceBlockedReason || 'Hermes is not ready.'} Nothing was sent.`);
    const generation = openGenerationRef.current;
    const sessionId = liveSessionIdRef.current || activeSession.id;
    setChatStatus('running');
    setLiveMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text, state: 'complete' }]);
    setBanner('');
    stickToBottomRef.current = true;
    try {
      await gateway.submitPrompt(sessionId, text);
    } catch (error) {
      if (generation === openGenerationRef.current) {
        setChatStatus('error');
        setBanner(`Not sent: ${error instanceof Error ? error.message : 'Prompt submit failed.'}`);
      }
      throw error;
    }
  }

  // A live-voice delegation: same prompt.submit path and local user bubble as the composer, tagged
  // `surface: 'voice-live'` with the bounded spoken context, on the pinned live session only.
  async function submitLiveVoiceDelegation(sessionId: string, text: string, voiceContext: string): Promise<void> {
    const gateway = gatewayRef.current;
    if (!activeSession || !gateway) throw new Error('Not connected. Nothing was sent.');
    if (composerBlockedByAttention) throw new Error('Answer the pending request first. Nothing was sent.');
    if (sessionId !== (liveSessionIdRef.current || activeSession.id)) throw new Error('Voice is bound to a different chat. Nothing was sent.');
    const generation = openGenerationRef.current;
    setChatStatus('running');
    setLiveMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text, state: 'complete', meta: 'voice' }]);
    setBanner('');
    stickToBottomRef.current = true;
    try {
      await gateway.submitPrompt(sessionId, text, { surface: 'voice-live', voiceContext });
    } catch (error) {
      if (generation === openGenerationRef.current) {
        setChatStatus('error');
        setBanner(`Not sent: ${error instanceof Error ? error.message : 'Prompt submit failed.'}`);
      }
      throw error;
    }
  }
  submitLiveVoiceRef.current = submitLiveVoiceDelegation;

  const voice = useVoiceController({
    backend: voiceBackend,
    submitText: submitVoicePrompt,
    onSubmitFailed: (text) => setComposer((current) => current || text),
  });
  voiceRef.current = voice;
  const liveVoice = useLiveVoice({ deps: liveVoiceDeps });
  liveVoiceRef.current = liveVoice;

  useEffect(() => {
    voice.scopeChanged(voiceScope);
    liveVoice.scopeChanged(voiceScope);
  }, [voiceScope?.profile, voiceScope?.sessionId, voice.scopeChanged, liveVoice.scopeChanged]);

  function onVoiceAction(action: VoiceAction) {
    if (liveEngine) {
      if (action === 'start') {
        liveRtcEnv?.unlock(); // inside the tap
        if (voiceScope) liveVoice.start(voiceScope);
      } else if (action === 'interrupt') {
        liveVoice.stopSpeaking();
      } else {
        liveVoice.stop();
      }
      return;
    }
    if (action === 'start') {
      if (voiceScope) voice.start(voiceScope);
    } else if (action === 'stop') {
      voice.stop();
    } else {
      voice.interrupt();
    }
  }

  function toggleVoice() {
    if (voiceOpen) {
      voice.reset();
      liveVoice.reset();
      setVoiceOpen(false);
      return;
    }
    setVoiceOpen(true);
  }

  // ---- Bob main: an explicitly pinned default-profile session; never guessed, never created. ----
  useEffect(() => {
    const scope = bobScopeFor(client);
    setBobRef(scope ? loadBobMainReference(scope) : null);
  }, [client]);

  const inDefaultChat = screen === 'chat' && canPinAsBobMain(activeSession) && (activeSession?.profile?.trim() || activeProfile) === BOB_PROFILE;
  const isCurrentBob = Boolean(bobRef && activeSession && (bobRef.sessionId === activeSession.id || bobRef.sessionId === openedIdRef.current));

  function toggleBobMain() {
    const scope = bobScopeFor(client);
    if (!scope || !activeSession) return;
    if (isCurrentBob) {
      clearBobMainReference(scope);
      setBobRef(null);
      setBanner('Bob main pin removed.');
      return;
    }
    const sessionId = openedIdRef.current && !openedIdRef.current.startsWith('new-') ? openedIdRef.current : activeSession.id;
    if (saveBobMainReference(scope, { sessionId, title: activeSession.title })) {
      setBobRef(loadBobMainReference(scope));
      setBanner('Bob main set to this chat. Talk to Bob on Conversations opens it.');
    }
  }

  function clearBobMain() {
    const scope = bobScopeFor(client);
    if (scope) clearBobMainReference(scope);
    setBobRef(null);
    setBobDialog(null);
  }

  async function chooseBobChat() {
    setBobDialog(null);
    if (activeProfileRef.current !== BOB_PROFILE) await switchActiveProfile(BOB_PROFILE);
  }

  async function talkToBob() {
    if (!client || !auth || bobBusy) return;
    const scope = bobScopeFor(client);
    const reference = scope ? loadBobMainReference(scope) : null;
    if (!reference) {
      setBobDialog({ kind: 'setup' });
      return;
    }
    voice.unlockAudio(); // still inside the tap: the only moment mobile Safari lets audio start
    liveRtcEnv?.unlock();
    setBobBusy(true);
    setBanner('');
    // The intent is exactly this tap: any open-generation, profile-load-generation or screen change after
    // it (including while the profile switch below is still loading) is the user navigating, so it is dropped.
    const startScreen = screenRef.current;
    let marks: NavigationMarks = { open: openGenerationRef.current, load: sessionLoadGenerationRef.current };
    const superseded = () => marks.open !== openGenerationRef.current || marks.load !== sessionLoadGenerationRef.current || startScreen !== screenRef.current;
    try {
      if (activeProfileRef.current !== BOB_PROFILE) {
        let switching = false;
        await switchActiveProfile(BOB_PROFILE, (own) => { marks = own; switching = true; });
        if (switching && superseded()) return;
        if (!switching || activeProfileRef.current !== BOB_PROFILE) {
          setBobDialog({ kind: 'error', message: 'Could not switch to the default profile, so Bob was not opened.' });
          return;
        }
      }
      const resolution = await resolveBobMain(reference, (target) => client.sessionDetail(auth, target));
      if (superseded() || activeProfileRef.current !== BOB_PROFILE) return;
      if (resolution.kind === 'ok') {
        await openSession(resolution.session, { openVoice: true });
      } else if (resolution.kind === 'stale' || resolution.kind === 'none') {
        setBobDialog({ kind: 'stale' });
      } else if (resolution.authExpired) {
        setBanner(handleAuthFailure(new HttpError(resolution.message, 401), resolution.message));
      } else {
        setBobDialog({ kind: 'error', message: resolution.message });
      }
    } finally {
      setBobBusy(false);
    }
  }

  async function submitPrompt(event: FormEvent) {
    event.preventDefault();
    const text = composer.trim();
    if ((!text && attachments.length === 0) || !activeSession || !gatewayRef.current || !canSendNow || preparing.length > 0) return;
    const items = attachments;
    const generation = openGenerationRef.current;
    const gateway = gatewayRef.current;
    let uploadedCount = 0;
    setComposer('');
    setAttachments([]);
    setChatStatus('running');
    try {
      const sessionId = liveSessionIdRef.current || activeSession.id;
      const attachmentRefs = await uploadPrepared(sessionId, items, uploadedAttachmentsRef.current, (id, item) => gateway.attachFile(id, item), (item) => setBanner(`Uploading ${item.name}…`));
      uploadedCount = attachmentRefs.length;
      if (generation !== openGenerationRef.current) return;
      const visibleText = [text, ...items.map((item) => `📎 ${item.name}`)].filter(Boolean).join('\n');
      setLiveMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text: visibleText, state: 'complete' }]);
      setBanner('');
      stickToBottomRef.current = true;
      const promptText = [text, ...attachmentRefs.map((file) => file.text)].filter(Boolean).join('\n\n') || 'Please review the attached file(s).';
      await gateway.submitPrompt(sessionId, promptText);
      uploadedAttachmentsRef.current.clear();
    } catch (error) {
      if (generation !== openGenerationRef.current) return;
      const failure = describeSendFailure(error, { attachmentCount: items.length, uploadedCount });
      setChatStatus('error');
      setBanner(failure.banner);
      setComposer(text);
      setAttachments(items);
      setLiveMessages((current) => [...current, { id: `err-${Date.now()}`, role: 'status', text: failure.status, state: 'error' }]);
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

  // Snapshot every picked file's bytes right here, while the OS still serves the handle (iOS can
  // revoke it shortly after selection). Only fully read files become chips; Send waits for the reads.
  function onFilesSelected(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    const epoch = attachmentEpochRef.current;
    const key = ++preparingKeyRef.current;
    const reads = selected.map((file) => prepareAttachment(file));
    if (fileInputRef.current) fileInputRef.current.value = '';
    setPreparing((current) => [...current, { key, names: selected.map((file) => file.name) }]);
    void Promise.allSettled(reads).then((settled) => {
      if (epoch !== attachmentEpochRef.current) return;
      const ready: PreparedAttachment[] = [];
      const problems: string[] = [];
      settled.forEach((outcome, index) => {
        if (outcome.status === 'fulfilled') ready.push(outcome.value);
        else problems.push(outcome.reason instanceof Error && outcome.reason.name === 'AttachmentPrepareError' ? outcome.reason.message : `Could not attach ${selected[index].name.split(/[\\/]/).pop()}.`);
      });
      setPreparing((current) => current.filter((entry) => entry.key !== key));
      if (ready.length) setAttachments((current) => [...current, ...ready]);
      if (problems.length) setBanner(problems.join(' '));
    });
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
            <div className="bob-shortcut">
              <button type="button" className="bob-talk" onClick={() => void talkToBob()} disabled={bobBusy} aria-label={bobBusy ? 'Opening Bob…' : bobRef ? 'Talk to Bob' : 'Set up Talk to Bob'}>
                <span className="bob-talk-icon" aria-hidden="true"><Mic size={22} /></span>
                <span className="bob-talk-copy">
                  <strong>{bobBusy ? 'Opening Bob…' : bobRef ? 'Talk to Bob' : 'Set up Talk to Bob'}</strong>
                  <small>{bobRef ? (bobRef.title || 'Your pinned main chat') : 'Pin your main chat once'}</small>
                </span>
              </button>
              {bobRef && <button type="button" className="icon-btn bob-settings" aria-label="Bob main settings" onClick={() => setBobDialog({ kind: 'manage' })}><Settings size={18} /></button>}
            </div>
            <div className="profile-switcher">
              <CustomSelect
                label="Active profile"
                value={activeProfile}
                options={(runtimeOptions.profiles.length ? runtimeOptions.profiles : ['default']).map((profile) => ({ value: profile, label: profile }))}
                onChange={(profile) => { void switchActiveProfile(profile); }}
              />
            </div>
            <div className="search-wrap"><Search size={18} /><input placeholder="Search loaded sessions" value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} /></div>
            <button className="new-chat" onClick={() => { setRuntimeSelection((current) => ({ ...current, ...seedNewChatSelection(activeProfileRef.current) })); setNewChatSheetOpen(true); }}><Plus size={20} /> New chat</button>
            <div className="session-list" ref={sessionListRef}>
              {continueTarget && !sessionFilter && (
                <button className="session-row continue-row" onClick={() => openSession(continueTarget.session)} aria-label={`Continue ${continueTarget.session.title || 'last conversation'}`}>
                  <div className="session-dot"><RefreshCw size={15} /></div>
                  <div className="session-copy"><small className="continue-label">Continue</small><strong>{continueTarget.session.title || continueTarget.session.preview || 'Last conversation'}</strong><span>{[continueTarget.session.profile, continueTarget.loaded ? 'in recent list' : 'older than the loaded list'].filter(Boolean).join(' · ')}</span></div>
                  <time>{relativeTime(continueTarget.session.updated_at)}</time>
                </button>
              )}
              {filteredSessions.map((session) => <button key={sessionRowKey(session.id, session.profile)} className="session-row" onClick={() => openSession(session)}><div className="session-dot">{session.running ? <Radio size={15} /> : <MessageCircle size={15} />}</div><div className="session-copy"><strong>{session.title || session.preview || 'Untitled session'}</strong><span>{session.preview || session.source || session.id}</span><small>{[session.message_count ? `${session.message_count} messages` : '', session.profile, session.workspace, session.source].filter(Boolean).join(' · ')}</small></div><time>{relativeTime(session.updated_at)}</time></button>)}
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
              <button type="button" className={`voice-toggle ${voiceOpen ? 'on' : ''}`} aria-pressed={voiceOpen} aria-label={voiceOpen ? 'Close voice' : 'Open voice'} onClick={toggleVoice}><Mic size={15} /> Voice</button>
              {inDefaultChat && <button type="button" className={`bob-pin ${isCurrentBob ? 'on' : ''}`} aria-pressed={isCurrentBob} aria-label={isCurrentBob ? 'Remove Bob main pin' : 'Set as Bob main'} onClick={toggleBobMain}><Star size={15} /> {isCurrentBob ? 'Bob main' : 'Set as Bob main'}</button>}
            </div>
            <div className="messages" ref={messagesRef} onScroll={onMessagesScroll}>
              {lineageNote && <div className="history-state" role="status">{lineageNote}</div>}
              {presentation === 'loading' && <div className="history-state" role="status" data-history="loading">Loading previous messages…</div>}
              {presentation === 'error' && <div className="history-state bad" role="alert" data-history="error">Couldn’t load previous messages: {history?.error} <button type="button" onClick={() => void refreshHistory()}>Retry</button></div>}
              {presentation === 'complete' && history && history.messages.length > 0 && <div className="history-state subtle" data-history="complete">Beginning of conversation</div>}
              {presentation === 'partial' && history?.error && <div className="history-state bad" role="alert" data-history="partial-error">{history.error}</div>}
              {presentation === 'empty' && visibleMessages.length === 0 && <div className="empty-chat" data-history="empty"><Sparkles size={28} /><strong>Nothing here yet</strong><span>This conversation has no messages. Send a prompt to start.</span></div>}
              {visibleMessages.map((message, index) => <MessageRow key={message.id} message={message} grouped={index > 0 && (message.role === 'user' || message.role === 'assistant') && visibleMessages[index - 1].role === message.role} />)}
              {attentionActive && attention.request && <AttentionCard request={attention.request} submitting={attention.phase === 'submitting'} locked={attention.phase !== 'waiting'} note={attention.note} onApproval={respondToApproval} onClarify={respondToClarify} />}
              {!attentionActive && attention.note && (attention.phase === 'resolved' || attention.phase === 'cancelled' || attention.phase === 'disconnected') && <div className={`history-state ${attention.phase === 'disconnected' ? 'bad' : 'subtle'}`} role="status" data-attention={attention.phase}>{attention.note}</div>}
              <div ref={messagesEndRef} />
            </div>
            {voiceOpen && (liveEngine
              ? <VoiceControls state={liveStateToVoiceState(liveVoice.state)} capability={{ supported: true }} canStart={voiceBlockedReason === ''} blockedReason={voiceBlockedReason} live onAction={onVoiceAction} />
              : <VoiceControls state={voice.state} capability={voice.capability} canStart={voiceBlockedReason === ''} blockedReason={voiceBlockedReason} onAction={onVoiceAction} />)}
            <form ref={composerRef} className={`composer ${chatStatus === 'running' ? 'running' : ''}`} onSubmit={submitPrompt}>
              {composerBlockedByAttention && <div className="composer-hint" role="status">Answer the pending request above first. Ordinary messages don’t resolve it.</div>}
              {chatStatus === 'running' && !composerBlockedByAttention && <div className="composer-hint" role="status">Hermes is working. Queue runs after this turn; Steer nudges the current turn.{attachments.length ? ' Remove attachments to use these.' : ''}</div>}
              {(chatStatus === 'lost' || chatStatus === 'disconnected') && <div className="composer-hint bad" role="status">Connection lost; your draft stays here. <button type="button" className="link-btn" onClick={() => void reconnectOnce('manual')}>Reconnect</button></div>}
              {(attachments.length > 0 || preparing.length > 0) && <div className="attachment-tray">{attachments.map((file) => <span className="attachment-chip" key={file.id}><span className="attachment-name">📎 {file.name}</span><button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((item) => item.id !== file.id))}><X size={13} /></button></span>)}{preparing.length > 0 && <span className="attachment-status" role="status"><span className="attachment-name">Preparing {preparing.flatMap((entry) => entry.names).length === 1 ? preparing[0].names[0] : `${preparing.flatMap((entry) => entry.names).length} files`}…</span></span>}</div>}
              <button type="button" className="attach" aria-label="Attach file or screenshot" onClick={() => fileInputRef.current?.click()}><Paperclip size={20} /></button>
              <input ref={fileInputRef} className="file-input" type="file" multiple accept="image/*,application/pdf,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx" onChange={(event) => onFilesSelected(event.target.files)} />
              <textarea ref={composerInputRef} value={composer} onChange={(event) => setComposer(event.target.value)} onFocus={scrollChatAfterKeyboardSettles} placeholder={chatStatus === 'running' ? 'Queue or steer…' : 'Message Hermes…'} rows={1} />
              {chatStatus === 'running'
                ? <div className="running-actions">
                    <button type="button" className="queue" aria-label="Queue for after this turn" disabled={!composer.trim() || !canEngageRunning} onClick={() => engageRunning('queue')}>Queue</button>
                    <button type="button" className="steer" aria-label="Steer the current turn" disabled={!composer.trim() || !canEngageRunning} onClick={() => engageRunning('steer')}>Steer</button>
                  </div>
                : <button className="send" aria-label="Send message" disabled={(!composer.trim() && attachments.length === 0) || !canSendNow || preparing.length > 0}><SendHorizonal size={20} /></button>}
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
            <p className="sheet-copy">Pick the model and reasoning for this chat. The active Conversations profile remains in scope.</p>
            <div className="runtime-controls" aria-label="New chat runtime controls">
              <CustomSelect
                label="Profile"
                value={activeProfile}
                options={[{ value: activeProfile, label: activeProfile }]}
                onChange={() => undefined}
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

      {bobDialog && (
        <div className="sheet-backdrop" role="presentation">
          <section className="new-chat-sheet" role="dialog" aria-modal="true" aria-labelledby="bob-dialog-title">
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-header">
              <div>
                <div className="eyebrow">Voice shortcut</div>
                <h2 id="bob-dialog-title">Talk to Bob</h2>
              </div>
              <button type="button" className="icon-btn" aria-label="Close dialog" onClick={() => setBobDialog(null)}><X size={18} /></button>
            </div>
            {bobDialog.kind === 'setup' && <p className="sheet-copy">Talk to Bob opens one pinned conversation in the default profile and lets you speak to it. Open your main Bob chat, then tap <strong>Set as Bob main</strong> at the top of that chat. Nothing is guessed from titles, and no separate voice chat is created.</p>}
            {bobDialog.kind === 'stale' && <p className="sheet-copy">Your pinned Bob chat is no longer available on this host in the default profile. Clear the pin, or choose another chat and set it as Bob main.</p>}
            {bobDialog.kind === 'manage' && <p className="sheet-copy">Bob main is pinned to <strong>{bobRef?.title || 'an untitled chat'}</strong> in the default profile. Clear it, or choose another chat and set it as Bob main.</p>}
            {bobDialog.kind === 'error' && <p className="sheet-copy">{bobDialog.message} Your pin was kept.</p>}
            <div className="sheet-actions">
              {bobDialog.kind === 'setup' && <button type="button" className="secondary" onClick={() => setBobDialog(null)}>Cancel</button>}
              {(bobDialog.kind === 'stale' || bobDialog.kind === 'manage') && <button type="button" className="secondary" onClick={clearBobMain}>Clear Bob main</button>}
              {bobDialog.kind === 'error' && <button type="button" className="secondary" onClick={() => { setBobDialog(null); void talkToBob(); }}>Try again</button>}
              {bobDialog.kind === 'error'
                ? <button type="button" className="primary" onClick={() => setBobDialog(null)}>Close</button>
                : <button type="button" className="primary" onClick={() => void chooseBobChat()}>{bobDialog.kind === 'setup' ? 'Choose a chat' : 'Choose another chat'}</button>}
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

function MessageRow({ message, grouped }: { message: ChatMessage; grouped?: boolean }) {
  return <article className={`message-row ${message.role} ${message.state ?? ''} ${grouped ? 'grouped' : ''}`}><div className="message-meta">{message.role}{message.meta ? ` · ${message.meta}` : ''}</div><MessageContent text={message.text} /></article>;
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
