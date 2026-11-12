import { describe, expect, it, vi } from 'vitest';
import { HttpError, HermesSession } from './hermesApi';
import { canPinAsBobMain, resolveBobMain } from './bobMain';

const reference = { sessionId: 'sess-bob', title: 'Bob', savedAt: '2026-10-20T00:00:00Z' };
const detail = (overrides: Partial<HermesSession> = {}): HermesSession => ({ id: 'sess-bob', title: 'Whatever the server says', profile: 'default', ...overrides });

describe('resolveBobMain', () => {
  it('has nothing to resolve without a pinned reference and never calls the server', async () => {
    const fetchDetail = vi.fn();
    expect(await resolveBobMain(null, fetchDetail)).toEqual({ kind: 'none' });
    expect(fetchDetail).not.toHaveBeenCalled();
  });

  it('validates by exact session id under the default profile and returns that session', async () => {
    const fetchDetail = vi.fn(async () => detail());
    const result = await resolveBobMain(reference, fetchDetail);
    expect(fetchDetail).toHaveBeenCalledWith({ id: 'sess-bob', profile: 'default', title: 'Bob' });
    expect(result).toEqual({ kind: 'ok', session: expect.objectContaining({ id: 'sess-bob', profile: 'default' }) });
  });

  it('treats an untagged server row as the default profile and stamps it', async () => {
    const result = await resolveBobMain(reference, async () => detail({ profile: undefined }));
    expect(result).toMatchObject({ kind: 'ok', session: { id: 'sess-bob', profile: 'default' } });
  });

  it('is stale when the server answers with a different session id (no fuzzy or title matching)', async () => {
    expect(await resolveBobMain(reference, async () => detail({ id: 'other', title: 'Bob' }))).toEqual({ kind: 'stale' });
  });

  it('is stale when the row belongs to another profile', async () => {
    expect(await resolveBobMain(reference, async () => detail({ profile: 'sales-test' }))).toEqual({ kind: 'stale' });
  });

  it('is stale on 404 so the pin can be cleared or reconfigured', async () => {
    expect(await resolveBobMain(reference, async () => { throw new HttpError('Not found', 404); })).toEqual({ kind: 'stale' });
  });

  it('a network or server failure is an error, not stale, so a transient outage never drops the pin', async () => {
    const result = await resolveBobMain(reference, async () => { throw new Error('offline'); });
    expect(result).toEqual({ kind: 'error', message: 'offline', authExpired: false });
    const auth = await resolveBobMain(reference, async () => { throw new HttpError('nope', 401); });
    expect(auth).toMatchObject({ kind: 'error', authExpired: true });
  });
});

describe('canPinAsBobMain', () => {
  it('allows only a persisted default-profile chat', () => {
    expect(canPinAsBobMain({ id: 'sess-1', profile: 'default' })).toBe(true);
    expect(canPinAsBobMain({ id: 'sess-1' })).toBe(true); // untagged means default
    expect(canPinAsBobMain({ id: 'sess-1', profile: 'sales-test' })).toBe(false);
    expect(canPinAsBobMain({ id: 'new-123', profile: 'default' })).toBe(false);
    expect(canPinAsBobMain(null)).toBe(false);
  });
});
