import type { AuthMode, HermesSession } from './hermesApi';

const TOKEN_KEY = 'hermes-mobile-pwa.token';
const SERVER_KEY = 'hermes-mobile-pwa.server-url';
const LAST_SESSION_KEY = 'hermes-mobile-pwa.last-session-id';
const LOGIN_HINT_KEY = 'hermes-mobile-pwa.login-hint';
const SESSION_CACHE_KEY = 'hermes-mobile-pwa.sessions-cache.v1';
const SESSION_CACHE_MAX = 150;

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
  return window.localStorage.getItem(LAST_SESSION_KEY) ?? '';
}

export function saveLastSessionId(sessionId: string): void {
  if (sessionId.trim()) window.localStorage.setItem(LAST_SESSION_KEY, sessionId.trim());
}

export function loadSessionCache(): HermesSession[] {
  try {
    const raw = window.localStorage.getItem(SESSION_CACHE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { sessions?: HermesSession[] };
    return Array.isArray(parsed.sessions) ? parsed.sessions.filter((session) => typeof session.id === 'string' && session.id) : [];
  } catch {
    return [];
  }
}

export function saveSessionCache(sessions: HermesSession[]): void {
  const deduped = sessions.filter((session, index) => session.id && sessions.findIndex((seen) => seen.id === session.id) === index).slice(0, SESSION_CACHE_MAX);
  window.localStorage.setItem(SESSION_CACHE_KEY, JSON.stringify({ savedAt: new Date().toISOString(), sessions: deduped }));
}
