import { describe, expect, it } from 'vitest';
import { HermesApiClient, HermesSession } from './hermesApi';
import { mergeSearchResults, searchQueryForServer, sessionMatchesQuery } from './sessionSearch';
import { viewportLayoutVars } from './viewportLayout';

// Issue 1 (docs/PWA-ISSUES-2026-11-19.md): the canonical "Bot Chat" is hidden=1 and
// so is never in the recent list the PWA pages through. Conversations search must
// consult the profile-scoped server search and surface such a row without widening
// the ordinary listing to every hidden/internal session.

const loaded: HermesSession[] = [
  { id: 'recent-1', title: 'Weekend reading', preview: 'articles', profile: 'default', updated_at: '2026-11-20T10:00:00.000Z' },
  { id: 'recent-2', title: 'Bot Chat notes', preview: 'planning the bot chat', profile: 'default', updated_at: '2026-11-19T10:00:00.000Z' },
];

const hiddenCanonical: HermesSession = { id: '20260101_000000_abc123', title: 'Bot Chat', preview: 'Bot Mode identity', profile: 'default', message_count: 33 };

describe('searchQueryForServer', () => {
  it('does not query the server for blank or one-character input', () => {
    expect(searchQueryForServer('')).toBeNull();
    expect(searchQueryForServer('   ')).toBeNull();
    expect(searchQueryForServer('b')).toBeNull();
    expect(searchQueryForServer(' Bot chat ')).toBe('Bot chat');
  });
});

describe('sessionMatchesQuery', () => {
  it('keeps the existing loaded-row substring semantics (title/preview/workspace/source)', () => {
    expect(sessionMatchesQuery(loaded[0], 'weekend')).toBe(true);
    expect(sessionMatchesQuery(loaded[0], 'articles')).toBe(true);
    expect(sessionMatchesQuery(loaded[0], 'bot chat')).toBe(false);
  });
});

describe('mergeSearchResults', () => {
  it('surfaces a hidden canonical row from server search that the loaded list cannot contain', () => {
    const merged = mergeSearchResults({ loaded, remote: [hiddenCanonical], query: 'bot chat', profile: 'default' });
    expect(merged.map((row) => row.id)).toContain('20260101_000000_abc123');
  });

  it('ranks exact title matches first, then loaded local matches, then other server hits', () => {
    const contentHit: HermesSession = { id: 'content-hit', title: 'Something else', preview: 'mentions bot chat in a message', profile: 'default' };
    const merged = mergeSearchResults({ loaded, remote: [contentHit, hiddenCanonical], query: 'bot chat', profile: 'default' });
    expect(merged.map((row) => row.id)).toEqual(['20260101_000000_abc123', 'recent-2', 'content-hit']);
  });

  it('dedupes rows already loaded and keeps the loaded copy', () => {
    const remoteCopy: HermesSession = { ...loaded[1], preview: 'server snippet' };
    const merged = mergeSearchResults({ loaded, remote: [remoteCopy], query: 'bot chat', profile: 'default' });
    expect(merged.filter((row) => row.id === 'recent-2')).toHaveLength(1);
    expect(merged.find((row) => row.id === 'recent-2')?.preview).toBe('planning the bot chat');
  });

  it('never lets a row from another profile into the active profile view', () => {
    const foreign: HermesSession = { id: 'sales-bot', title: 'Bot Chat', profile: 'sales-test' };
    const merged = mergeSearchResults({ loaded, remote: [foreign, hiddenCanonical], query: 'bot chat', profile: 'default' });
    expect(merged.map((row) => row.id)).not.toContain('sales-bot');
    expect(merged.map((row) => row.id)).toContain('20260101_000000_abc123');
  });

  it('with no query returns the loaded list untouched', () => {
    expect(mergeSearchResults({ loaded, remote: [hiddenCanonical], query: '', profile: 'default' })).toEqual(loaded);
  });
});

describe('HermesApiClient.searchSessions', () => {
  it('calls the profile-scoped server search and normalizes result rows', async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({
        results: [
          { session_id: '20260101_000000_abc123', id: '20260101_000000_abc123', title: 'Bot Chat', snippet: 'Bot Mode identity', profile: 'default', last_active: 1763000000, message_count: 33, source: 'cli', archived: false },
          { session_id: 'content-only', snippet: 'a content hit with no rich row', profile: 'default' },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    try {
      const rows = await new HermesApiClient('https://agent.example/hermes').searchSessions({ mode: 'password' }, 'Bot chat', { profile: 'default', limit: 20 });
      const url = new URL(seen[0]);
      expect(url.pathname).toBe('/hermes/api/sessions/search');
      expect(url.searchParams.get('q')).toBe('Bot chat');
      expect(url.searchParams.get('profile')).toBe('default');
      expect(url.searchParams.get('limit')).toBe('20');
      expect(rows.map((row) => row.id)).toEqual(['20260101_000000_abc123', 'content-only']);
      expect(rows[0].title).toBe('Bot Chat');
      expect(rows[0].profile).toBe('default');
      expect(rows[1].preview).toBe('a content hit with no rich row');
      expect(rows[1].profile).toBe('default');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('leaves the ordinary listing request unchanged (no include_hidden widening)', async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      seen.push(String(input));
      return new Response(JSON.stringify({ sessions: [], total: 0, limit: 75, offset: 0 }), { status: 200 });
    }) as unknown as typeof fetch;
    try {
      await new HermesApiClient('https://agent.example/hermes').sessionPage({ mode: 'password' }, { profile: 'default' });
      expect(seen[0]).not.toContain('include_hidden');
      expect(seen[0]).toContain('order=recent');
      expect(seen[0]).toContain('min_messages=1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// Issue 2: with the iOS keyboard up the visual viewport shrinks AND can pan inside the
// layout viewport (offsetTop > 0). The shell must follow that pan, otherwise its bottom
// edge clips the focused search field and bare body background shows beneath it.
describe('viewportLayoutVars', () => {
  it('reports the pan offset so the shell can follow the visual viewport', () => {
    const vars = viewportLayoutVars({ innerHeight: 852, viewport: { height: 516, offsetTop: 200 } });
    expect(vars['--visual-viewport-height']).toBe('516px');
    expect(vars['--visual-viewport-offset-top']).toBe('200px');
    expect(vars['--keyboard-inset-bottom']).toBe('136px');
  });

  it('is zero-offset without a visualViewport or when nothing has panned', () => {
    expect(viewportLayoutVars({ innerHeight: 852, viewport: null })['--visual-viewport-offset-top']).toBe('0px');
    expect(viewportLayoutVars({ innerHeight: 852, viewport: { height: 516, offsetTop: 0 } })['--visual-viewport-offset-top']).toBe('0px');
  });

  it('never produces a negative offset or an offset that pushes the shell past the layout viewport', () => {
    expect(viewportLayoutVars({ innerHeight: 852, viewport: { height: 516, offsetTop: -4 } })['--visual-viewport-offset-top']).toBe('0px');
    expect(viewportLayoutVars({ innerHeight: 852, viewport: { height: 516, offsetTop: 900 } })['--visual-viewport-offset-top']).toBe('336px');
  });
});
