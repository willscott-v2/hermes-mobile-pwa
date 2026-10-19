import { describe, it, expect } from 'vitest';
import { sessionRowKey, admitSessionsForProfile, resolveActiveProfile, seedNewChatSelection, isProfileActionStale, historyPageBelongsToScope } from './profileScope';

describe('sessionRowKey', () => {
  it('distinguishes the same session id across different profiles', () => {
    // A session id can recur under two profiles (e.g. "new-chat" stamped by both
    // default and sales-test). Its list identity must never collapse the two.
    expect(sessionRowKey('s-1', 'default')).toBe('default:s-1');
    expect(sessionRowKey('s-1', 'sales-test')).toBe('sales-test:s-1');
    expect(sessionRowKey('s-1', 'default')).not.toBe(sessionRowKey('s-1', 'sales-test'));
    expect(sessionRowKey('s-1', 'default')).not.toBe(sessionRowKey('s-2', 'default'));
  });

  it('treats an untagged row as the default profile', () => {
    expect(sessionRowKey('s-1')).toBe('default:s-1');
    expect(sessionRowKey('s-1', undefined)).toBe('default:s-1');
    expect(sessionRowKey('s-1', '')).toBe('default:s-1');
   });
});

describe('admitSessionsForProfile', () => {
  type Row = { id: string; profile?: string; preview?: string };
  it('keeps a private default-only session out of the sales-test view', () => {
    const rows: Row[] = [
      { id: 'mock-private-default', profile: 'default', preview: 'Private default task' },
      { id: 'mock-private-default', profile: 'sales-test', preview: 'sales-test: same id' },
      { id: 'campaign', profile: 'sales-test', preview: 'launch plan' },
      // A row the server forgot to stamp is treated as default, so it is dropped
      // from a non-default view but kept for default.
      { id: 'untagged', preview: 'no profile stamped' },
     ];
    const salesTest = admitSessionsForProfile(rows, 'sales-test');
    expect(salesTest.map((row) => `${row.profile}:${row.id}`)).toEqual([
       'sales-test:mock-private-default',
       'sales-test:campaign',
     ]);
    expect(salesTest.some((row) => row.id === 'mock-private-default' && (row.profile ?? 'default') === 'default')).toBe(false);
    expect(salesTest.some((row) => row.id === 'untagged')).toBe(false);
    });

  it('keeps default rows (including untagged) when default is active', () => {
    const rows: Row[] = [
       { id: 'mock-private-default', profile: 'default' },
       { id: 'untagged' },
       { id: 'campaign', profile: 'sales-test' },
      ];
    const admitted = admitSessionsForProfile(rows, 'default');
    expect(admitted.map((row) => row.id).sort()).toEqual(['mock-private-default', 'untagged']);
     });
});

describe('resolveActiveProfile', () => {
  it('honors a remembered preferred profile only while it is still advertised', () => {
    expect(resolveActiveProfile(['default', 'sales-test'], 'sales-test', 'sales-test')).toBe('sales-test');
    expect(resolveActiveProfile(['default', 'sales-test', 'ops'], 'default', 'ops')).toBe('ops');
    expect(resolveActiveProfile(['default'], undefined, undefined)).toBe('default');
    expect(resolveActiveProfile([], undefined, undefined)).toBe('default');
    expect(resolveActiveProfile([], undefined, 'whatever')).toBe('default');
    });

  it('ignores a remembered profile the server no longer advertises (profile mismatch)', () => {
    // A host remembered a private profile that this connection does not offer.
    // Falling back to the advertised current profile keeps the view honest.
    expect(resolveActiveProfile(['default', 'sales-test'], 'default', 'old-private')).toBe('default');
    expect(resolveActiveProfile(['default', 'sales-test'], 'sales-test', 'old-private')).toBe('sales-test');
    });

  it('falls back to an advertised current profile, else the first advertised', () => {
    expect(resolveActiveProfile(['ops', 'sales-test'], 'ops', null)).toBe('ops');
    expect(resolveActiveProfile(['ops', 'sales-test'], undefined, null)).toBe('ops');
    expect(resolveActiveProfile([], 'sales-test', 'sales-test')).toBe('sales-test');
    });
});

describe('seedNewChatSelection', () => {
  it('seeds the active profile and no older one onto a fresh chat', () => {
    expect(seedNewChatSelection('sales-test')).toEqual({ profile: 'sales-test' });
    expect(seedNewChatSelection('default')).toEqual({ profile: 'default' });
     });

  it('never carries a stale/empty profile forward', () => {
    expect(seedNewChatSelection('')).toEqual({ profile: undefined });
    expect(seedNewChatSelection('   ')).toEqual({ profile: undefined });
     });
});

describe('isProfileActionStale', () => {
  it('drops a session-list fetch whose generation moved on (navigated away)', () => {
    expect(isProfileActionStale(3, 3, 'default', 'default')).toBe(false);
    expect(isProfileActionStale(3, 4, 'default', 'default')).toBe(true);
    expect(isProfileActionStale(2, 3, 'sales-test', 'sales-test')).toBe(true);
      });

  it('drops a send/history page from a profile that is no longer active', () => {
      // A submit or history page that began under 'default' must not land once the
      // user switched to 'sales-test', even if the generation counter is untouched.
    expect(isProfileActionStale(5, 5, 'default', 'sales-test')).toBe(true);
    expect(isProfileActionStale(5, 5, 'sales-test', 'sales-test')).toBe(false);
    expect(isProfileActionStale(5, 5, '', 'default')).toBe(false);
        });
});

describe('historyPageBelongsToScope', () => {
  it('applies a page only when its profile and session both match', () => {
    expect(historyPageBelongsToScope({ sessionId: 's1', profile: 'default' }, { sessionId: 's1', profile: 'default' })).toBe(true);
    expect(historyPageBelongsToScope({ sessionId: 's1' }, { sessionId: 's1', profile: undefined })).toBe(true);
    expect(historyPageBelongsToScope({ sessionId: 's1' }, { sessionId: 's1' })).toBe(true);
      });

  it('rejects a page whose profile differs (no cross-profile history)', () => {
      // The same session id can exist under two profiles; a page fetched for one
      // must not populate a history scoped to the other.
    expect(historyPageBelongsToScope({ sessionId: 's1', profile: 'default' }, { sessionId: 's1', profile: 'sales-test' })).toBe(false);
    expect(historyPageBelongsToScope({ sessionId: 's1', profile: 'sales-test' }, { sessionId: 's1', profile: 'default' })).toBe(false);
    expect(historyPageBelongsToScope({ sessionId: 's1', profile: 'sales-test' }, { sessionId: 's2', profile: 'sales-test' })).toBe(false);
      });

  it('treats an untagged page as default', () => {
    expect(historyPageBelongsToScope({ sessionId: 's1' }, { sessionId: 's1', profile: 'default' })).toBe(true);
    expect(historyPageBelongsToScope({ sessionId: 's1', profile: 'default' }, { sessionId: 's1' })).toBe(true);
      });
});
