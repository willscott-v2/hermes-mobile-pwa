import { describe, expect, it, vi } from 'vitest';
import { HttpError, HermesSession } from './hermesApi';
import { canPinChat, resolvePinnedChat } from './pinnedChat';

const reference = { sessionId: 'sess-main', title: 'Main', savedAt: '2026-10-20T00:00:00Z' };
const detail = (overrides: Partial<HermesSession> = {}): HermesSession => ({ id: 'sess-main', title: 'Whatever the server says', profile: 'default', ...overrides });

describe('resolvePinnedChat', () => {
  it('has nothing to resolve without a pinned reference and never calls the server', async () => {
    const fetchDetail = vi.fn();
    expect(await resolvePinnedChat(null, fetchDetail)).toEqual({ kind: 'none' });
    expect(fetchDetail).not.toHaveBeenCalled();
  });

  it('validates by exact session id under the default profile and returns that session', async () => {
    const fetchDetail = vi.fn(async () => detail());
    const result = await resolvePinnedChat(reference, fetchDetail);
    expect(fetchDetail).toHaveBeenCalledWith({ id: 'sess-main', profile: 'default', title: 'Main' });
    expect(result).toEqual({ kind: 'ok', session: expect.objectContaining({ id: 'sess-main', profile: 'default' }) });
  });

  it('treats an untagged server row as the default profile and stamps it', async () => {
    const result = await resolvePinnedChat(reference, async () => detail({ profile: undefined }));
    expect(result).toMatchObject({ kind: 'ok', session: { id: 'sess-main', profile: 'default' } });
  });

  it('is stale when the server answers with a different session id (no fuzzy or title matching)', async () => {
    expect(await resolvePinnedChat(reference, async () => detail({ id: 'other', title: 'Main' }))).toEqual({ kind: 'stale' });
  });

  it('is stale when the row belongs to another profile', async () => {
    expect(await resolvePinnedChat(reference, async () => detail({ profile: 'sales-test' }))).toEqual({ kind: 'stale' });
  });

  it('is stale on 404 so the pin can be cleared or reconfigured', async () => {
    expect(await resolvePinnedChat(reference, async () => { throw new HttpError('Not found', 404); })).toEqual({ kind: 'stale' });
  });

  it('a network or server failure is an error, not stale, so a transient outage never drops the pin', async () => {
    const result = await resolvePinnedChat(reference, async () => { throw new Error('offline'); });
    expect(result).toEqual({ kind: 'error', message: 'offline', authExpired: false });
    const auth = await resolvePinnedChat(reference, async () => { throw new HttpError('nope', 401); });
    expect(auth).toMatchObject({ kind: 'error', authExpired: true });
  });
});

describe('canPinChat', () => {
  it('allows only a persisted default-profile chat', () => {
    expect(canPinChat({ id: 'sess-1', profile: 'default' })).toBe(true);
    expect(canPinChat({ id: 'sess-1' })).toBe(true); // untagged means default
    expect(canPinChat({ id: 'sess-1', profile: 'sales-test' })).toBe(false);
    expect(canPinChat({ id: 'new-123', profile: 'default' })).toBe(false);
    expect(canPinChat(null)).toBe(false);
  });
});
