import { describe, it, expect } from 'vitest';
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
