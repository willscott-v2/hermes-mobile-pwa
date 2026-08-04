import type { AuthMode, HermesSession } from './hermesApi';
import type { RuntimeSelection } from './runtimeOptions';

const TOKEN_KEY = 'hermes-mobile-pwa.token';
const SERVER_KEY = 'hermes-mobile-pwa.server-url';
const LAST_SESSION_KEY = 'hermes-mobile-pwa.last-session-id';
const LOGIN_HINT_KEY = 'hermes-mobile-pwa.login-hint';
const SESSION_CACHE_KEY = 'hermes-mobile-pwa.sessions-cache.v1';
const CONNECTION_PROFILES_KEY = 'hermes-mobile-pwa.connection-profiles.v1';
const RUNTIME_SELECTION_KEY = 'hermes-mobile-pwa.runtime-selection.v1';
const SESSION_CACHE_MAX = 150;

export interface LoginHint {
  username?: string;
  mode?: AuthMode;
}

export interface ConnectionProfile {
  id: string;
  name: string;
  url: string;
  mode: AuthMode;
  username?: string;
  lastUsedAt?: string;
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

export function loadConnectionProfiles(): ConnectionProfile[] {
  try {
    const raw = window.localStorage.getItem(CONNECTION_PROFILES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { profiles?: ConnectionProfile[] };
    return Array.isArray(parsed.profiles) ? parsed.profiles.filter((profile) => profile.id && profile.url) : [];
  } catch {
    return [];
  }
}

export function saveConnectionProfile(input: Omit<ConnectionProfile, 'id' | 'lastUsedAt'> & { id?: string; password?: string; token?: string }): ConnectionProfile {
  const profiles = loadConnectionProfiles();
  const id = input.id || (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `profile-${Date.now()}`);
  let fallbackName = input.url;
  try { fallbackName = new URL(input.url).hostname; } catch {}
  const profile: ConnectionProfile = {
    id,
    name: input.name.trim() || fallbackName,
    url: input.url,
    mode: input.mode,
    username: input.username?.trim() || undefined,
    lastUsedAt: new Date().toISOString(),
  };
  const next = [profile, ...profiles.filter((seen) => seen.id !== id && seen.url !== profile.url)].slice(0, 8);
  window.localStorage.setItem(CONNECTION_PROFILES_KEY, JSON.stringify({ profiles: next }));
  return profile;
}

export function deleteConnectionProfile(id: string): void {
  const next = loadConnectionProfiles().filter((profile) => profile.id !== id);
  window.localStorage.setItem(CONNECTION_PROFILES_KEY, JSON.stringify({ profiles: next }));
}

export function loadRuntimeSelection(serverUrl: string): RuntimeSelection {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(RUNTIME_SELECTION_KEY) ?? '{}') as Record<string, RuntimeSelection>;
    return parsed[serverUrl] ?? {};
  } catch {
    return {};
  }
}

export function saveRuntimeSelection(serverUrl: string, selection: RuntimeSelection): void {
  let parsed: Record<string, RuntimeSelection> = {};
  try {
    parsed = JSON.parse(window.localStorage.getItem(RUNTIME_SELECTION_KEY) ?? '{}') as Record<string, RuntimeSelection>;
  } catch {
    parsed = {};
  }
  parsed[serverUrl] = selection;
  window.localStorage.setItem(RUNTIME_SELECTION_KEY, JSON.stringify(parsed));
}
