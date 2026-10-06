import { beforeEach, describe, expect, it, vi } from 'vitest';

interface MemoryLocalStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  clear(): void;
  readonly length: number;
}

function makeStore(): MemoryLocalStorage {
  const data = new Map<string, string>();
  return {
    getItem: (key) => (data.has(key) ? (data.get(key) as string) : null),
    setItem: (key, value) => {
      data.set(key, String(value));
    },
    removeItem: (key) => {
      data.delete(key);
    },
    key: (index) => Array.from(data.keys())[index] ?? null,
    clear: () => {
      data.clear();
    },
    get length() {
      return data.size;
    },
  };
}

let store: MemoryLocalStorage;

async function loadStorage() {
  // Vitest runs in a node env (no window/localStorage). Stub the global
  // before importing so storage functions resolve window.localStorage to `store`.
  return import('./storage');
}

const APP_KEYS = [
  'hermes-mobile-pwa.continue.v2',
  'hermes-mobile-pwa.schema-version',
  'hermes-mobile-pwa.token',
  'hermes-mobile-pwa.server-url',
  'hermes-mobile-pwa.login-hint',
  'hermes-mobile-pwa.sessions-cache.v1',
  'hermes-mobile-pwa.last-session-id',
];

beforeEach(() => {
  store = makeStore();
  vi.stubGlobal('window', { localStorage: store });
});

describe('scopeFromServerUrl', () => {
  it('parses origin, basePath and profile', async () => {
    const storage = await loadStorage();
    expect(storage.scopeFromServerUrl('https://host:9119/hermes', 'worker')).toEqual({
      origin: 'https://host:9119',
      basePath: '/hermes',
      profile: 'worker',
    });
  });

  it('collapses a trailing slash on path to an empty basePath', async () => {
    const storage = await loadStorage();
    const scope = storage.scopeFromServerUrl('https://host:9119/');
    expect(scope?.basePath).toBe('');
    expect(scope?.origin).toBe('https://host:9119');
    expect(scope?.profile).toBeUndefined();
  });

  it('returns null for an invalid URL and for non-http schemes', async () => {
    const storage = await loadStorage();
    expect(storage.scopeFromServerUrl('not a url')).toBeNull();
    expect(storage.scopeFromServerUrl('ftp://host')).toBeNull();
    expect(storage.scopeFromServerUrl('javascript:alert(1)')).toBeNull();
    expect(storage.scopeFromServerUrl('mock')).toBeNull();
  });
});

describe('migrateLegacyStorage', () => {
  it('removes legacy keys, sets the schema key, and is idempotent', async () => {
    const storage = await loadStorage();
    store.setItem('hermes-mobile-pwa.sessions-cache.v1', '[{"id":"a"}]');
    store.setItem('hermes-mobile-pwa.last-session-id', 'abc');

    const first = storage.migrateLegacyStorage();
    expect(first.removed.sort()).toEqual([
      'hermes-mobile-pwa.last-session-id',
      'hermes-mobile-pwa.sessions-cache.v1',
    ]);
    expect(store.getItem('hermes-mobile-pwa.sessions-cache.v1')).toBeNull();
    expect(store.getItem('hermes-mobile-pwa.last-session-id')).toBeNull();
    expect(store.getItem('hermes-mobile-pwa.schema-version')).toBe('2');

    const second = storage.migrateLegacyStorage();
    expect(second.removed).toEqual([]);
    expect(store.getItem('hermes-mobile-pwa.schema-version')).toBe('2');
  });
});

describe('continue reference round-trip', () => {
  it('saves and loads a reference for the same scope', async () => {
    const storage = await loadStorage();
    const scope = storage.scopeFromServerUrl('https://host:9119/hermes', 'worker');
    expect(scope).not.toBeNull();
    storage.saveContinueReference(scope!, { sessionId: 'sess-1', title: 'Review PR' });
    const loaded = storage.loadContinueReference(scope!);
    expect(loaded).toEqual({ sessionId: 'sess-1', title: 'Review PR', savedAt: expect.any(String) });
  });
});

describe('loadContinueReference scope mismatch', () => {
  it('returns null when origin, basePath, or profile differ', async () => {
    const storage = await loadStorage();
    const base = storage.scopeFromServerUrl('https://host:9119/hermes', 'worker');
    storage.saveContinueReference(base!, { sessionId: 'sess-1' });

    expect(storage.loadContinueReference({ origin: 'https://other:9119', basePath: '/hermes', profile: 'worker' })).toBeNull();
    expect(storage.loadContinueReference({ origin: 'https://host:9119', basePath: '/other', profile: 'worker' })).toBeNull();
    expect(storage.loadContinueReference({ origin: 'https://host:9119', basePath: '/hermes', profile: 'admin' })).toBeNull();
  });

  it('treats undefined and empty profile as equal', async () => {
    const storage = await loadStorage();
    const saved = storage.scopeFromServerUrl('https://host:9119/hermes', '');
    storage.saveContinueReference(saved!, { sessionId: 'sess-2' });
    const loaded = storage.loadContinueReference({ origin: 'https://host:9119', basePath: '/hermes', profile: undefined });
    expect(loaded?.sessionId).toBe('sess-2');
  });
});

describe('loadContinueReference corruption and version', () => {
  it('returns null and removes the key on corrupt JSON', async () => {
    const storage = await loadStorage();
    store.setItem('hermes-mobile-pwa.continue.v2', '{not json');
    const scope = storage.scopeFromServerUrl('https://host:9119', undefined);
    expect(storage.loadContinueReference(scope!)).toBeNull();
    expect(store.getItem('hermes-mobile-pwa.continue.v2')).toBeNull();
  });

  it('returns null on the wrong version without removing a valid key', async () => {
    const storage = await loadStorage();
    store.setItem('hermes-mobile-pwa.continue.v2', JSON.stringify({ v: 1, sessionId: 'x', savedAt: 't' }));
    const scope = storage.scopeFromServerUrl('https://host:9119', undefined);
    expect(storage.loadContinueReference(scope!)).toBeNull();
  });
});

describe('saveContinueReference refusal', () => {
  it('refuses empty and new- placeholder ids (no write)', async () => {
    const storage = await loadStorage();
    const scope = storage.scopeFromServerUrl('https://host:9119/hermes', undefined);
    storage.saveContinueReference(scope!, { sessionId: '   ' });
    storage.saveContinueReference(scope!, { sessionId: 'new-123' });
    expect(store.getItem('hermes-mobile-pwa.continue.v2')).toBeNull();
  });
});

describe('serialized reference privacy', () => {
  it('contains no sensitive fields and caps title at 80 chars', async () => {
    const storage = await loadStorage();
    const scope = storage.scopeFromServerUrl('https://host:9119/hermes', 'worker');
    storage.saveContinueReference(scope!, { sessionId: 'sess-1', title: 'x'.repeat(100) });
    const raw = store.getItem('hermes-mobile-pwa.continue.v2')!;
    expect(raw).not.toContain('preview');
    expect(raw).not.toContain('messages');
    expect(raw).not.toContain('password');
    expect(raw).not.toContain('token');
    const parsed = JSON.parse(raw);
    expect(parsed.title).toHaveLength(80);
    expect(parsed.v).toBe(2);
  });
});

describe('forgetThisDevice', () => {
  it('removes only app keys and leaves unrelated keys intact', async () => {
    const storage = await loadStorage();
    for (const key of APP_KEYS) store.setItem(key, '1');
    store.setItem('other-app.key', 'keep-me');

    const removed = storage.forgetThisDevice();
    expect([...removed].sort()).toEqual([...APP_KEYS].sort());
    expect(store.getItem('other-app.key')).toBe('keep-me');
    for (const key of APP_KEYS) expect(store.getItem(key)).toBeNull();
    expect(storage.appStorageKeys()).toEqual([]);
  });
});

describe('retired session cache and last-session key', () => {
  it('loadSessionCache returns [] even with legacy data; saveSessionCache removes the legacy key', async () => {
    const storage = await loadStorage();
    store.setItem('hermes-mobile-pwa.sessions-cache.v1', JSON.stringify({ sessions: [{ id: 'a' }, { id: 'b' }] }));
    expect(storage.loadSessionCache()).toEqual([]);
    storage.saveSessionCache([{ id: 'a' }] as any);
    expect(store.getItem('hermes-mobile-pwa.sessions-cache.v1')).toBeNull();
  });

  it('loadLastSessionId returns "" after saveLastSessionId', async () => {
    const storage = await loadStorage();
    storage.saveLastSessionId('abc');
    expect(storage.loadLastSessionId()).toBe('');
  });
});
