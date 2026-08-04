import { ArrowLeft, Bot, CheckCircle2, CircleAlert, Clock3, Lock, MessageCircle, Paperclip, Plus, Radio, RefreshCw, Search, SendHorizonal, ShieldCheck, Sparkles, WifiOff, X } from 'lucide-react';
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AuthCapability, AuthMode, AuthSession, ChatMessage, eventToMessages, GatewayHandle, HermesApiClient, HermesSession, SessionPage, normalizeServerUrl } from './lib/hermesApi';
import { MockHermesClient, starterMessages } from './lib/mockHermes';
import { formatMessageTextForMobile } from './lib/mobileText';
import { initialDiagnosticSteps, setDiagnosticStep, type DiagnosticStep } from './lib/connectionDiagnostics';
import { EMPTY_RUNTIME_CATALOG, type RuntimeCatalog, type RuntimeSelection } from './lib/runtimeOptions';
import { clearRememberedToken, loadConnectionProfiles, loadLastSessionId, loadLoginHint, loadRememberedToken, loadRuntimeSelection, loadServerUrl, loadSessionCache, saveConnectionProfile, saveLastSessionId, saveLoginHint, saveRememberedToken, saveRuntimeSelection, saveServerUrl, saveSessionCache, type ConnectionProfile } from './lib/storage';

type Client = HermesApiClient | MockHermesClient;
type Screen = 'connect' | 'sessions' | 'chat';
type ConnStatus = 'idle' | 'checking' | 'ready' | 'connecting' | 'error';

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

export function App() {
  const [screen, setScreen] = useState<Screen>('connect');
  const [connection, setConnection] = useState(initialConnection);
  const [client, setClient] = useState<Client | null>(null);
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [sessions, setSessions] = useState<HermesSession[]>(() => prioritizeLastSession(loadSessionCache()));
  const [sessionPage, setSessionPage] = useState<Pick<SessionPage, 'total' | 'limit' | 'offset'>>({ limit: 75, offset: 0 });
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionFilter, setSessionFilter] = useState('');
  const [activeSession, setActiveSession] = useState<HermesSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composer, setComposer] = useState('');
  const [attachments, setAttachments] = useState<File[]>([]);
  const [chatStatus, setChatStatus] = useState<'disconnected' | 'connecting' | 'ready' | 'running' | 'error'>('disconnected');
  const [banner, setBanner] = useState('');
  const [diagnosticSteps, setDiagnosticSteps] = useState<DiagnosticStep[]>(() => initialDiagnosticSteps());
  const [connectionProfiles, setConnectionProfiles] = useState<ConnectionProfile[]>(() => loadConnectionProfiles());
  const [runtimeCatalog, setRuntimeCatalog] = useState<RuntimeCatalog>(EMPTY_RUNTIME_CATALOG);
  const [runtimeSelection, setRuntimeSelection] = useState<RuntimeSelection>({});
  const gatewayRef = useRef<GatewayHandle | null>(null);
  const liveSessionIdRef = useRef<string>('');
  const historySessionRef = useRef<HermesSession | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLFormElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const autoRestoreStarted = useRef(false);

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
        saveSessionCache(loaded.sessions);
        const lastSessionId = loadLastSessionId();
        const lastSession = lastSessionId ? loaded.sessions.find((session) => session.id === lastSessionId) : undefined;
        setClient(api);
        setAuth(restoredAuth);
        setSessions(lastSession ? [lastSession, ...loaded.sessions.filter((session) => session.id !== lastSession.id)] : loaded.sessions);
        setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
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
      } catch {
        setConnection((state) => ({
          ...state,
          status: 'idle',
          message: 'Saved login expired or was not found. Sign in again; the app will remember this device without storing your password.',
        }));
      }
    })();
  }, []);

  const filteredSessions = useMemo(() => {
    const q = sessionFilter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((session) => [session.title, session.preview, session.workspace, session.source].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [sessions, sessionFilter]);

  const visibleMessages = useMemo(() => compactMessagesForMobile(messages), [messages]);

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

  function scrollChatToBottom() {
    window.requestAnimationFrame(() => messagesEndRef.current?.scrollIntoView({ block: 'end' }));
  }

  useEffect(() => {
    if (screen !== 'chat') return;
    scrollChatToBottom();
  }, [screen, visibleMessages.length, chatStatus]);

  useEffect(() => {
    if (screen !== 'chat' || !client || !auth || !activeSession || chatStatus === 'running' || chatStatus === 'connecting') return;
    const refresh = () => { void refreshActiveSessionMessages({ quiet: true }); };
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
      setDiagnosticSteps([
        { id: 'url', state: 'passed', message: 'Mock mode selected.' },
        { id: 'status', state: 'passed', message: 'Mock dashboard ready.' },
        { id: 'auth', state: 'skipped', message: 'Mock mode does not use real auth.' },
        { id: 'login', state: 'skipped', message: 'Mock mode does not store credentials.' },
        { id: 'gateway', state: 'skipped', message: 'Mock mode simulates streaming.' },
      ]);
      setRuntimeCatalog(await mock.runtimeCatalog());
      setConnection((state) => ({ ...state, status: 'ready', version: status.version, message: 'Mock mode ready. No network calls will be made.' }));
      return;
    }
    const normalized = normalizeServerUrl(connection.rawUrl);
    if (!normalized) {
      setDiagnosticSteps(setDiagnosticStep(initialDiagnosticSteps(), 'url', { state: 'failed', message: 'Enter an http:// or https:// URL.' }));
      setConnection((state) => ({ ...state, status: 'error', message: 'Use an http:// or https:// Hermes dashboard URL.' }));
      return;
    }
    setConnection((state) => ({ ...state, status: 'checking', message: 'Checking Hermes dashboard…' }));
    try {
      const api = new HermesApiClient(normalized);
      const result = await api.diagnoseConnection({ mode: connection.mode, username: connection.username, password: connection.password, token: connection.token });
      setDiagnosticSteps(result.steps);
      if (!result.ok) throw new Error(result.steps.find((step) => step.state === 'failed')?.message ?? 'Could not reach Hermes.');
      saveServerUrl(normalized);
      const saved = saveConnectionProfile({ name: '', url: normalized, mode: connection.mode, username: connection.username });
      setConnectionProfiles([saved, ...loadConnectionProfiles().filter((profile) => profile.id !== saved.id)]);
      const runtime = loadRuntimeSelection(normalized);
      setRuntimeSelection(runtime);
      setClient(api);
      setConnection((state) => ({
        ...state,
        rawUrl: normalized,
        status: 'ready',
        version: result.version,
        capability: result.capability,
        mode: result.capability?.kind === 'passwordAvailable' ? 'password' : 'token',
        message: result.capability?.kind === 'passwordAvailable' ? 'Password auth is available. Sign in to continue.' : 'Token mode is available. Use a trusted private network only.',
      }));
    } catch (error) {
      setConnection((state) => ({ ...state, status: 'error', message: error instanceof Error ? error.message : 'Could not reach Hermes.' }));
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
        saveSessionCache(loaded.sessions);
        setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
        saveLoginHint({ mode: 'mock' });
        setRuntimeCatalog(await activeClient.runtimeCatalog());
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
      if ('runtimeCatalog' in activeClient) {
        const catalog = await activeClient.runtimeCatalog(session).catch(() => EMPTY_RUNTIME_CATALOG);
        setRuntimeCatalog(catalog);
      }
      saveConnectionProfile({ name: '', url: normalized, mode: connection.mode, username: connection.username });
      setConnectionProfiles(loadConnectionProfiles());
      saveRuntimeSelection(normalized, runtimeSelection);
      setClient(activeClient);
      setAuth(session);
      setSessions(loaded.sessions);
      saveSessionCache(loaded.sessions);
      setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
      setConnection((state) => ({ ...state, password: '', status: 'ready', message: 'Connected.' }));
      setScreen('sessions');
    } catch (error) {
      setConnection((state) => ({ ...state, status: 'error', message: error instanceof Error ? error.message : 'Sign-in failed.' }));
    }
  }

  async function loadSessionPage(activeClient: Client, authSession: AuthSession, offset: number): Promise<SessionPage> {
    return activeClient.sessionPage(authSession, { limit: 75, offset });
  }

  async function loadMoreSessions() {
    if (!client || !auth || sessionsLoading) return;
    const nextOffset = sessions.length;
    setSessionsLoading(true);
    setBanner('');
    try {
      const loaded = await loadSessionPage(client, auth, nextOffset);
      setSessions((current) => {
        const next = [...current, ...loaded.sessions.filter((session) => !current.some((seen) => seen.id === session.id))];
        saveSessionCache(next);
        return next;
      });
      setSessionPage({ total: loaded.total, limit: loaded.limit, offset: loaded.offset });
    } catch (error) {
      setBanner(error instanceof Error ? error.message : 'Could not load more sessions.');
    } finally {
      setSessionsLoading(false);
    }
  }

  async function refreshActiveSessionMessages(options: { quiet?: boolean } = {}) {
    if (!client || !auth || !activeSession || !('sessionMessages' in client)) return;
    const historySession = historySessionRef.current ?? activeSession;
    if (!options.quiet) setBanner('Refreshing transcript…');
    try {
      const transcript = await client.sessionTranscript(auth, historySession, 220);
      historySessionRef.current = transcript.session;
      setActiveSession((current) => current ? { ...current, ...transcript.session } : transcript.session);
      if (transcript.messages.length) setMessages(transcript.messages);
      if (!options.quiet) setBanner('');
    } catch (error) {
      if (!options.quiet) setBanner(error instanceof Error ? error.message : 'Could not refresh transcript.');
    }
  }

  async function openSession(session: HermesSession) {
    if (!client || !auth) return;
    historySessionRef.current = session;
    saveLastSessionId(session.id);
    liveSessionIdRef.current = session.id;
    setActiveSession(session);
    setMessages(starterMessages(session));
    setScreen('chat');
    setChatStatus('connecting');
    setBanner('Connecting to live gateway…');
    gatewayRef.current?.close();
    try {
      if ('sessionTranscript' in client) {
        const transcript = await client.sessionTranscript(auth, session, 160);
        historySessionRef.current = transcript.session;
        if (transcript.messages.length) setMessages(transcript.messages);
      }
      const gateway = await client.connectGateway(auth, {
        onOpen: () => setChatStatus('ready'),
        onClose: () => { setChatStatus('disconnected'); setBanner('Gateway disconnected. Reopen the session to reconnect.'); },
        onError: (error) => { setChatStatus('error'); setBanner(error.message); },
        onEvent: (gatewayEvent) => {
          setMessages((current) => eventToMessages(gatewayEvent, current));
          if (gatewayEvent.type === 'message.complete') setChatStatus('ready');
        },
      });
      gatewayRef.current = gateway;
      const resumeTarget = historySessionRef.current ?? session;
      const liveSessionId = await gateway.resumeSession(resumeTarget.id, resumeTarget.profile);
      liveSessionIdRef.current = liveSessionId || resumeTarget.id;
      setActiveSession(resumeTarget);
      setBanner('');
      setChatStatus('ready');
    } catch (error) {
      setChatStatus('error');
      setBanner(error instanceof Error ? error.message : 'Could not open session.');
    }
  }

  async function newChat() {
    const session: HermesSession = { id: `new-${Date.now()}`, title: 'New chat', preview: 'Fresh Hermes session', updated_at: new Date().toISOString() };
    liveSessionIdRef.current = session.id;
    setActiveSession(session);
    setMessages([]);
    setScreen('chat');
    setChatStatus('connecting');
    gatewayRef.current?.close();
    if (!client || !auth) return;
    try {
      const gateway = await client.connectGateway(auth, {
        onOpen: () => setChatStatus('ready'),
        onClose: () => setChatStatus('disconnected'),
        onError: (error) => { setChatStatus('error'); setBanner(error.message); },
        onEvent: (gatewayEvent) => {
          setMessages((current) => eventToMessages(gatewayEvent, current));
          if (gatewayEvent.type === 'message.complete') setChatStatus('ready');
        },
      });
      gatewayRef.current = gateway;
      const id = await gateway.createSession();
      const created = { ...session, id };
      historySessionRef.current = created;
      liveSessionIdRef.current = id;
      saveLastSessionId(id);
      setActiveSession(created);
      setSessions((current) => {
        const next = [created, ...current];
        saveSessionCache(next);
        return next;
      });
      setSessionPage((current) => ({ ...current, total: typeof current.total === 'number' ? current.total + 1 : current.total }));
      setChatStatus('ready');
    } catch (error) {
      setChatStatus('error');
      setBanner(error instanceof Error ? error.message : 'Could not create chat.');
    }
  }

  async function submitPrompt(event: FormEvent) {
    event.preventDefault();
    const text = composer.trim();
    if ((!text && attachments.length === 0) || !activeSession || !gatewayRef.current || chatStatus === 'running' || chatStatus === 'connecting') return;
    const files = attachments;
    setComposer('');
    setAttachments([]);
    setChatStatus('running');
    try {
      const sessionId = liveSessionIdRef.current || activeSession.id;
      const attachmentRefs = [];
      for (const file of files) {
        setBanner(`Uploading ${file.name}…`);
        attachmentRefs.push(await gatewayRef.current.attachFile(sessionId, file));
      }
      const visibleText = [text, ...files.map((file) => `📎 ${file.name}`)].filter(Boolean).join('\n');
      setMessages((current) => [...current, { id: `user-${Date.now()}`, role: 'user', text: visibleText, state: 'complete' }]);
      setBanner('');
      const promptText = [text, ...attachmentRefs.map((file) => file.text)].filter(Boolean).join('\n\n') || 'Please review the attached file(s).';
      await gatewayRef.current.submitPrompt(sessionId, promptText);
    } catch (error) {
      setChatStatus('error');
      const message = error instanceof Error ? error.message : 'Prompt submit failed.';
      setBanner(files.length ? `Attachment/send failed: ${message}` : message);
      setComposer(text);
      setAttachments(files);
      setMessages((current) => [...current, { id: `err-${Date.now()}`, role: 'status', text: files.length ? 'Attachment upload failed. File(s) restored in the composer.' : 'Prompt submit failed.', state: 'error' }]);
    }
  }

  function onFilesSelected(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files);
    setAttachments((current) => [...current, ...selected]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  const canLoadMore = !sessionFilter && typeof sessionPage.total === 'number' && sessions.length < sessionPage.total;

  return (
    <div className="app-shell">
      <header className="topbar">
        {screen === 'chat' ? <button className="icon-btn" onClick={() => { gatewayRef.current?.close(); setScreen('sessions'); }} aria-label="Back to sessions"><ArrowLeft size={20} /></button> : <div className="brand-mark"><img src="/icons/icon.svg" alt="Hermes Mobile" /></div>}
        <div>
          <div className="eyebrow">Hermes Mobile</div>
          <h1>{screen === 'connect' ? 'Connect' : screen === 'sessions' ? 'Sessions' : activeSession?.title ?? 'Chat'}</h1>
        </div>
        <StatusPill status={screen === 'chat' ? chatStatus : connection.status} />
      </header>

      <main className="main-panel">
        {screen === 'connect' && (
          <section className="connect-card">
            <div className="hero-orb"><Bot size={44} /></div>
            <h2>Your agent, pocket-sized.</h2>
            <p>Connect to a private Hermes dashboard and drive real sessions from a phone-friendly UI.</p>
            <div className="onboarding-panel">
              <strong>Choose how to connect</strong>
              <div className="onboarding-options">
                <span>Mock demo</span>
                <span>Private dashboard</span>
                <span>Custom proxy</span>
              </div>
              <small>Use the same-origin <code>/hermes</code> proxy on Tailnet when possible. Hermex-style native clients may expect different API routes.</small>
            </div>
            {connectionProfiles.length > 0 && (
              <label>
                <span>Saved server</span>
                <select value="" onChange={(event) => {
                  const profile = connectionProfiles.find((item) => item.id === event.target.value);
                  if (profile) setConnection((state) => ({ ...state, rawUrl: profile.url, mode: profile.mode, username: profile.username ?? state.username, password: '', status: 'idle', message: `Loaded ${profile.name}. Password was not stored.` }));
                }}>
                  <option value="">Choose a saved server…</option>
                  {connectionProfiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </label>
            )}
            <form onSubmit={connect} className="stack">
              <label>
                <span>Mode</span>
                <select value={connection.mode} onChange={(event) => setConnection((state) => ({ ...state, mode: event.target.value as AuthMode }))}>
                  <option value="password">Password</option>
                  <option value="token">Token (experimental)</option>
                  <option value="mock">Mock demo</option>
                </select>
              </label>
              {connection.mode !== 'mock' && <label><span>Hermes URL</span><input inputMode="url" placeholder="http://mac.tailnet:9119" value={connection.rawUrl} onChange={(event) => setConnection((state) => ({ ...state, rawUrl: event.target.value, status: 'idle' }))} /></label>}
              {connection.mode === 'password' && <div className="grid2"><label><span>Username</span><input autoComplete="username" value={connection.username} onChange={(event) => setConnection((state) => ({ ...state, username: event.target.value }))} /></label><label><span>Password</span><input type="password" autoComplete="current-password" value={connection.password} onChange={(event) => setConnection((state) => ({ ...state, password: event.target.value }))} /></label></div>}
              {connection.mode === 'token' && <><label><span>Dashboard bearer token</span><input type="password" autoComplete="off" value={connection.token} onChange={(event) => setConnection((state) => ({ ...state, token: event.target.value }))} /></label><div className="security-note"><CircleAlert size={16} /> Experimental: API_SERVER_KEY does not work here. Use only with a dashboard token provider for these routes.</div><label className="check-row"><input type="checkbox" checked={connection.rememberToken} onChange={(event) => setConnection((state) => ({ ...state, rememberToken: event.target.checked }))} /> Remember token on this device</label></>}
              <div className="button-row">
                <button type="button" className="secondary" onClick={checkServer}>{connection.mode === 'mock' ? 'Enable mock' : 'Check server'}</button>
                <button type="submit" className="primary">Connect</button>
              </div>
            </form>
            <InfoBanner status={connection.status} message={connection.message} />
            <DiagnosticList steps={diagnosticSteps} />
            <div className="security-note"><ShieldCheck size={16} /> Passwords are never persisted. Use Tailscale/VPN; do not expose Hermes publicly.</div>
          </section>
        )}

        {screen === 'sessions' && (
          <section className="sessions-screen">
            <div className="session-summary"><strong>{sessions.length}</strong><span>{typeof sessionPage.total === 'number' ? ` of ${sessionPage.total} conversations loaded` : ' conversations loaded'}</span></div>
            {banner && <div className="inline-banner"><WifiOff size={16} /> {banner}</div>}
            <div className="search-wrap"><Search size={18} /><input placeholder="Search loaded sessions" value={sessionFilter} onChange={(event) => setSessionFilter(event.target.value)} /></div>
            <button className="new-chat" onClick={newChat}><Plus size={20} /> New chat</button>
            <div className="session-list">
              {filteredSessions.map((session) => <button key={session.id} className="session-row" onClick={() => openSession(session)}><div className="session-dot">{session.running ? <Radio size={15} /> : <MessageCircle size={15} />}</div><div className="session-copy"><strong>{session.title || session.preview || 'Untitled session'}</strong><span>{session.preview || session.source || session.id}</span><small>{[session.message_count ? `${session.message_count} messages` : '', session.workspace, session.source].filter(Boolean).join(' · ')}</small></div><time>{relativeTime(session.updated_at)}</time></button>)}
              {canLoadMore && <button className="load-more" onClick={loadMoreSessions} disabled={sessionsLoading}>{sessionsLoading ? 'Loading…' : `Load more (${Math.min(75, (sessionPage.total ?? sessions.length) - sessions.length)} more)`}</button>}
            </div>
          </section>
        )}

        {screen === 'chat' && (
          <section className="chat-screen">
            {banner && <div className="inline-banner"><WifiOff size={16} /> {banner}</div>}
            <button type="button" className="refresh-chat" onClick={() => refreshActiveSessionMessages()}><RefreshCw size={15} /> Refresh transcript</button>
            <div className="messages">
              {visibleMessages.length === 0 && <div className="empty-chat"><Sparkles size={28} /><strong>Fresh session</strong><span>Send a prompt to start Hermes.</span></div>}
              {visibleMessages.map((message) => <MessageRow key={message.id} message={message} />)}
              <div ref={messagesEndRef} />
            </div>
            <form ref={composerRef} className="composer" onSubmit={submitPrompt}>
              <RuntimeControls catalog={runtimeCatalog} selection={runtimeSelection} onChange={(next) => {
                setRuntimeSelection(next);
                if (connection.rawUrl) saveRuntimeSelection(normalizeServerUrl(connection.rawUrl) ?? connection.rawUrl, next);
              }} />
              {attachments.length > 0 && <div className="attachment-tray">{attachments.map((file, index) => <span className="attachment-chip" key={`${file.name}-${file.size}-${index}`}>📎 {file.name}<button type="button" aria-label={`Remove ${file.name}`} onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={13} /></button></span>)}</div>}
              <button type="button" className="attach" aria-label="Attach file or screenshot" onClick={() => fileInputRef.current?.click()}><Paperclip size={20} /></button>
              <input ref={fileInputRef} className="file-input" type="file" multiple accept="image/*,application/pdf,.pdf,.txt,.md,.csv,.json,.doc,.docx,.xls,.xlsx" onChange={(event) => onFilesSelected(event.target.files)} />
              <textarea value={composer} onChange={(event) => setComposer(event.target.value)} onFocus={() => window.setTimeout(scrollChatToBottom, 120)} placeholder="Message Hermes…" rows={1} />
              <button className="send" aria-label="Send message" disabled={(!composer.trim() && attachments.length === 0) || chatStatus === 'connecting' || chatStatus === 'running'}><SendHorizonal size={20} /></button>
            </form>
          </section>
        )}
      </main>
    </div>
  );
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

function DiagnosticList({ steps }: { steps: DiagnosticStep[] }) {
  return <div className="diagnostic-list" aria-label="Connection diagnostics">
    {steps.map((step) => <div key={step.id} className={`diagnostic-step ${step.state}`}>
      <span>{step.state === 'passed' ? '✓' : step.state === 'failed' ? '!' : step.state === 'running' ? '…' : '·'}</span>
      <div><strong>{connectionStepName(step.id)}</strong><small>{step.message}{step.detail ? ` ${step.detail}` : ''}</small></div>
    </div>)}
  </div>;
}

function RuntimeControls({ catalog, selection, onChange }: { catalog: RuntimeCatalog; selection: RuntimeSelection; onChange: (next: RuntimeSelection) => void }) {
  const profiles = catalog.profiles.length ? catalog.profiles : [{ id: 'default', label: 'default' }];
  const projects = catalog.projects.length ? catalog.projects : [{ id: '', label: 'No project' }];
  const models = catalog.models.length ? catalog.models : [{ id: '', label: 'Backend default' }];
  return <div className="runtime-controls" aria-label="Runtime controls">
    <label><span>Profile</span><select aria-label="Profile" value={selection.profile ?? profiles[0]?.id ?? ''} onChange={(event) => onChange({ ...selection, profile: event.target.value || undefined })}>{profiles.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}</select></label>
    <label><span>Project</span><select aria-label="Project" value={selection.projectId ?? ''} onChange={(event) => onChange({ ...selection, projectId: event.target.value || undefined })}>{projects.map((option) => <option key={option.id || 'none'} value={option.id}>{option.label}</option>)}</select></label>
    <label><span>Model</span><select aria-label="Model" value={selection.model ?? ''} onChange={(event) => onChange({ ...selection, model: event.target.value || undefined })}>{models.map((option) => <option key={option.id || 'default'} value={option.id}>{option.label}</option>)}</select></label>
  </div>;
}

function connectionStepName(id: DiagnosticStep['id']): string {
  return {
    url: 'Server URL',
    status: 'Dashboard status',
    auth: 'Authentication',
    login: 'Login/session',
    gateway: 'Live gateway',
  }[id];
}

function StatusPill({ status }: { status: string }) {
  const ready = ['ready', 'running'].includes(status);
  return <div className={`status-pill ${ready ? 'ok' : status === 'error' ? 'bad' : ''}`}>{ready ? <CheckCircle2 size={14} /> : status === 'error' ? <CircleAlert size={14} /> : <Clock3 size={14} />}{status}</div>;
}

function InfoBanner({ status, message }: { status: ConnStatus; message: string }) {
  return <div className={`info-banner ${status === 'error' ? 'bad' : status === 'ready' ? 'ok' : ''}`}><Lock size={15} /> {message}</div>;
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

function prioritizeLastSession(sessions: HermesSession[]): HermesSession[] {
  const lastSessionId = loadLastSessionId();
  if (!lastSessionId) return sessions;
  const last = sessions.find((session) => session.id === lastSessionId);
  if (!last) return sessions;
  return [last, ...sessions.filter((session) => session.id !== lastSessionId)];
}
