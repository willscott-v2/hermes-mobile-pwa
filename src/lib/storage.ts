import type { AuthMode, HermesSession } from './hermesApi';

const TOKEN_KEY = 'hermes-mobile-pwa.token';
const SERVER_KEY = 'hermes-mobile-pwa.server-url';
const LOGIN_HINT_KEY = 'hermes-mobile-pwa.login-hint';
const SESSION_CACHE_KEY = 'hermes-mobile-pwa.sessions-cache.v1';

export const STORAGE_SCHEMA_VERSION = 2;
const CONTINUE_KEY = 'hermes-mobile-pwa.continue.v2';
const SCHEMA_KEY = 'hermes-mobile-pwa.schema-version';
const LEGACY_KEYS = ['hermes-mobile-pwa.sessions-cache.v1', 'hermes-mobile-pwa.last-session-id'];

export interface StorageScope { origin: string; basePath: string; profile?: string }
export interface ContinueReference { sessionId: string; title?: string; savedAt: string }

export interface LoginHint {
  username?: string;
  mode?: AuthMode;
}

export function loadServerUrl(): string {
  return window.localStorage.getItem(SERVER_KEY) ?? '';
}

export function saveServerUrl(url: string): void {
  window.localStorage.setItem(SERVER_KEY, url);
}

export function loadLoginHint(): LoginHint {
  try {
    const raw = window.localStorage.getItem(LOGIN_HINT_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as LoginHint;
    return {
      username: typeof parsed.username === 'string' ? parsed.username : undefined,
      mode: parsed.mode === 'password' || parsed.mode === 'token' || parsed.mode === 'mock' ? parsed.mode : undefined,
    };
  } catch {
    return {};
  }
}

export function saveLoginHint(hint: LoginHint): void {
  const clean: LoginHint = {};
  if (hint.username?.trim()) clean.username = hint.username.trim();
  if (hint.mode) clean.mode = hint.mode;
  window.localStorage.setItem(LOGIN_HINT_KEY, JSON.stringify(clean));
}

export function loadRememberedToken(): string {
  return window.localStorage.getItem(TOKEN_KEY) ?? '';
}

export function saveRememberedToken(token: string): void {
  if (token.trim()) window.localStorage.setItem(TOKEN_KEY, token.trim());
}

export function clearRememberedToken(): void {
  window.localStorage.removeItem(TOKEN_KEY);
}

export function loadLastSessionId(): string {
  // The legacy global last-session key is retired; continue references are
  // host/base-path/profile-scoped instead.
  return '';
}

export function saveLastSessionId(sessionId: string): void {
  // No-op: the legacy global key is retired.
  void sessionId;
}

export function scopeFromServerUrl(serverUrl: string, profile?: string): StorageScope | null {
  let url: URL;
  try {
    url = new URL(serverUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.origin === 'mock') return null;
  const rawPath = url.pathname.length > 1 ? url.pathname : '';
  const basePath = rawPath.replace(/\/+$/, '');
  return { origin: url.origin, basePath, profile };
}

export function migrateLegacyStorage(): { removed: string[] } {
  const stored = window.localStorage.getItem(SCHEMA_KEY);
  if (stored === String(STORAGE_SCHEMA_VERSION)) {
    return { removed: [] };
  }
  const removed: string[] = [];
  for (const key of LEGACY_KEYS) {
    if (window.localStorage.getItem(key) !== null) {
      window.localStorage.removeItem(key);
      removed.push(key);
    }
  }
  window.localStorage.setItem(SCHEMA_KEY, String(STORAGE_SCHEMA_VERSION));
  return { removed };
}

export function saveContinueReference(scope: StorageScope, ref: { sessionId: string; title?: string }): void {
  const sessionId = ref.sessionId?.trim();
  if (!sessionId || sessionId.startsWith('new-')) return;
  if (!scope.origin.startsWith('http://') && !scope.origin.startsWith('https://')) return;

  const trimmed = ref.title?.trim();
  const entry = {
    v: STORAGE_SCHEMA_VERSION,
    scope: { origin: scope.origin, basePath: scope.basePath, profile: scope.profile },
    sessionId,
    savedAt: new Date().toISOString(),
    ...(trimmed ? { title: trimmed.slice(0, 80) } : {}),
  };
  window.localStorage.setItem(CONTINUE_KEY, JSON.stringify(entry));
}

export function loadContinueReference(scope: StorageScope): ContinueReference | null {
  const raw = window.localStorage.getItem(CONTINUE_KEY);
  if (!raw) return null;

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    window.localStorage.removeItem(CONTINUE_KEY);
    return null;
  }

  if (parsed?.v !== STORAGE_SCHEMA_VERSION) return null;
  const stored = parsed.scope;
  const sessionId = parsed.sessionId;
  if (typeof sessionId !== 'string' || !sessionId) return null;
  if (!stored || typeof stored.origin !== 'string') return null;
  if (stored.origin !== scope.origin) return null;
  if ((stored.basePath ?? '') !== (scope.basePath ?? '')) return null;
  if ((stored.profile ?? '') !== (scope.profile ?? '')) return null;
  return {
    sessionId,
    title: typeof parsed.title === 'string' ? parsed.title : undefined,
    savedAt: parsed.savedAt,
  };
}

export function clearContinueReference(): void {
  window.localStorage.removeItem(CONTINUE_KEY);
}

export function loadSessionCache(): HermesSession[] {
  // Private previews are no longer persisted; continue references are scoped.
  return [];
}

export function saveSessionCache(sessions: HermesSession[]): void {
  // No-op, but retire the legacy key so stale previews don't linger.
  void sessions;
  window.localStorage.removeItem(SESSION_CACHE_KEY);
}

export function forgetThisDevice(): string[] {
  const keys = [CONTINUE_KEY, SCHEMA_KEY, TOKEN_KEY, SERVER_KEY, LOGIN_HINT_KEY, ...LEGACY_KEYS];
  const removed: string[] = [];
  for (const key of keys) {
    if (window.localStorage.getItem(key) !== null) {
      window.localStorage.removeItem(key);
      removed.push(key);
    }
  }
  return removed;
}

export function appStorageKeys(): string[] {
  const keys: string[] = [];
  const ls = window.localStorage;
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (key && key.startsWith('hermes-mobile-pwa.')) keys.push(key);
  }
  return keys;
}
