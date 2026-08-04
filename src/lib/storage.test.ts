import { beforeEach, describe, expect, it } from 'vitest';
import { loadConnectionProfiles, loadRuntimeSelection, saveConnectionProfile, saveRuntimeSelection } from './storage';

function installLocalStorage() {
  const store = new Map<string, string>();
  globalThis.window = {
    localStorage: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
    },
  } as unknown as Window & typeof globalThis;
}

describe('connection profile storage', () => {
  beforeEach(() => installLocalStorage());

  it('stores safe server profile metadata without passwords or tokens', () => {
    saveConnectionProfile({ name: 'Local demo', url: 'https://agent.example/hermes', mode: 'password', username: 'will', password: 'secret', token: 'abc' });
    const raw = JSON.stringify(loadConnectionProfiles());
    expect(raw).toContain('Local demo');
    expect(raw).toContain('https://agent.example/hermes');
    expect(raw).not.toContain('secret');
    expect(raw).not.toContain('abc');
  });

  it('stores runtime selections scoped by server URL', () => {
    saveRuntimeSelection('https://agent-a.example/hermes', { profile: 'research', projectId: 'pwa', model: 'fast' });
    expect(loadRuntimeSelection('https://agent-a.example/hermes')).toEqual({ profile: 'research', projectId: 'pwa', model: 'fast' });
    expect(loadRuntimeSelection('https://agent-b.example/hermes')).toEqual({});
  });
});
