import { afterEach, describe, it, expect, vi } from 'vitest';
import { MockHermesClient } from './mockHermes';

// The installed API filters sessions server-side by `profile` and stamps each
// session with its profile. The mirror must behave the same way so the profile
// switcher's scoping is exercised end-to-end under the mock.
describe('MockHermesClient profile filtering', () => {
  it('returns only the active profile from the session list', async () => {
    const client = new MockHermesClient();
    const sales = await client.sessionPage(undefined, { limit: 75, offset: 0, profile: 'sales-test' });
    expect(sales.sessions.length).toBeGreaterThan(0);
    expect(sales.sessions.every((session) => session.profile === 'sales-test')).toBe(true);
    expect(sales.total).toBe(sales.sessions.length);
     });

  it('keeps the same session id distinct across profiles (a collision is two rows)', async () => {
    const client = new MockHermesClient();
    const def = await client.sessionPage(undefined, { limit: 75, offset: 0, profile: 'default' });
    const sales = await client.sessionPage(undefined, { limit: 75, offset: 0, profile: 'sales-test' });
    const defIds = new Set(def.sessions.map((session) => session.id));
    const salesIds = new Set(sales.sessions.map((session) => session.id));
     // 'mock-shared-id' exists under both profiles, but as one row per profile.
    expect(defIds.has('mock-shared-id')).toBe(true);
    expect(salesIds.has('mock-shared-id')).toBe(true);
     // A private default-only session must never appear in sales-test.
    expect(salesIds.has('mock-private-default')).toBe(false);
    expect(defIds.has('mock-private-default')).toBe(true);
    expect(def.sessions.every((session) => session.profile === 'default')).toBe(true);
    expect(sales.sessions.every((session) => session.profile === 'sales-test')).toBe(true);
     });

  it('filters to default-or-untagged when default (or no profile) is requested', async () => {
    const client = new MockHermesClient();
    const all = await client.sessionPage(undefined, { limit: 75, offset: 0 });
    const def = await client.sessionPage(undefined, { limit: 75, offset: 0, profile: 'default' });
    expect(def.sessions.length).toBeLessThan(all.sessions.length);
    expect(def.sessions.every((session) => (session.profile ?? 'default') === 'default')).toBe(true);
     });
});

describe('MockHermesClient.sessionDetail', () => {
  it('matches the exact id under the requested profile and 404s otherwise', async () => {
    const client = new MockHermesClient();
    expect((await client.sessionDetail({ mode: 'token' }, { id: 'mock-shared-id', profile: 'sales-test' })).title).toBe('Shared task (sales view)');
    expect((await client.sessionDetail({ mode: 'token' }, { id: 'mock-shared-id', profile: 'default' })).title).toBe('Shared task');
    await expect(client.sessionDetail({ mode: 'token' }, { id: 'sales-campaign', profile: 'default' })).rejects.toMatchObject({ status: 404 });
    await expect(client.sessionDetail({ mode: 'token' }, { id: 'nope', profile: 'default' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('MockHermesClient gateway frames', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('mirrors the real gateway: resume hands out a live id distinct from the stored id and message frames carry it as session_id', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout.bind(globalThis) });
    const events: Array<{ type?: string; session_id?: string }> = [];
    const gateway = await new MockHermesClient().connectGateway({ mode: 'token' }, { onEvent: (event) => events.push(event) });
    const resumed = await gateway.resumeSession('mock-weekend-reading', 'default');
    expect(resumed.storedId).toBe('mock-weekend-reading');
    expect(resumed.sessionId).not.toBe(resumed.storedId);
    events.length = 0;
    const submitted = gateway.submitPrompt(resumed.sessionId, 'hello');
    await vi.advanceTimersByTimeAsync(2000);
    await submitted;
    const messages = events.filter((event) => event.type?.startsWith('message.'));
    expect(messages.map((event) => event.type)).toEqual(['message.start', 'message.delta', 'message.delta', 'message.delta', 'message.complete']);
    expect(messages.every((event) => event.session_id === resumed.sessionId)).toBe(true);
  });
});

describe('MockHermesClient test hooks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('holds exactly the next sessionDetail until released, then behaves normally', async () => {
    vi.stubGlobal('window', {});
    const client = new MockHermesClient();
    const hooks = (globalThis as unknown as { window: { __mockHoldNextSessionDetail(): void; __mockReleaseSessionDetail(): void } }).window;
    hooks.__mockHoldNextSessionDetail();
    let held = false;
    const first = client.sessionDetail({ mode: 'token' }, { id: 'mock-weekend-reading', profile: 'default' }).then((value) => { held = true; return value; });
    const second = await client.sessionDetail({ mode: 'token' }, { id: 'mock-lisbon-trip', profile: 'default' });
    expect(second.id).toBe('mock-lisbon-trip');
    await Promise.resolve();
    expect(held).toBe(false);
    hooks.__mockReleaseSessionDetail();
    expect((await first).id).toBe('mock-weekend-reading');
  });
});
