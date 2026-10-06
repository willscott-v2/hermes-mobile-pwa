import { describe, it, expect } from 'vitest';
import type { ChatMessage, HistoryPage } from './hermesApi';
import {
  createHistoryState,
  historyScopeKey,
  beginHistoryLoad,
  failHistoryLoad,
  applyHistoryPage,
  appendLiveMessages,
  visibleHistory,
  historyScopeKey as _key,
  historyPresentation,
} from './history';
import type { HistoryScope, HistoryState } from './history';

// Small, stable fixtures
function msg(id: string, role: ChatMessage['role'] = 'user'): ChatMessage {
  return { id, role, text: `text-${id}`, state: 'complete' };
}

function makeScope(): HistoryScope {
  return { baseUrl: 'https://x.dev', profile: 'default', sessionId: 'sess-1' };
}

function makeState(scope?: HistoryScope): HistoryState {
  return createHistoryState(scope ?? makeScope());
}

function page(
  messages: ChatMessage[],
  opts: Partial<HistoryPage> = {},
): HistoryPage {
  return {
    sessionId: 'sess-1',
    profile: 'default',
    messages,
    limit: 10,
    offset: opts.offset ?? 0,
    returned: opts.returned ?? messages.length,
    reachedBeginning: opts.reachedBeginning ?? false,
  };
}

describe('historyScopeKey', () => {
  it('joins baseUrl, profile (default empty), and sessionId with pipes', () => {
    expect(
      historyScopeKey({ baseUrl: 'https://x', sessionId: 's' }),
    ).toBe('https://x||s');
    expect(
      historyScopeKey({ baseUrl: 'https://x', profile: 'p', sessionId: 's' }),
    ).toBe('https://x|p|s');
  });

  it('is a stable key (unused import guard)', () => {
    expect(_key({ baseUrl: 'https://x', sessionId: 's' })).toBe('https://x||s');
  });
});

describe('createHistoryState', () => {
  it('creates an empty idle state with the right key', () => {
    const state = createHistoryState(makeScope());
    expect(state.scopeKey).toBe('https://x.dev|default|sess-1');
    expect(state.messages).toEqual([]);
    expect(state.liveMessages).toEqual([]);
    expect(state.loadedRawCount).toBe(0);
    expect(state.reachedBeginning).toBe(false);
    expect(state.load).toBe('idle');
    expect(state.error).toBeUndefined();
    expect(state.hasLoadedOnce).toBe(false);
  });
});

describe('applyHistoryPage stale scope', () => {
  it('returns the same state object unchanged when scopeKey differs', () => {
    const state = createHistoryState(makeScope());
    const result = applyHistoryPage(state, page([msg('history-1')]), 'different-key', 'initial');
    expect(result).toBe(state);
  });
});

describe('applyHistoryPage initial', () => {
  it('sets messages, loadedRawCount, reachedBeginning, hasLoadedOnce, idle, no error', () => {
    const scope = makeScope();
    const key = historyScopeKey(scope);
    const state = createHistoryState(scope);
    const p = page([msg('history-1'), msg('history-2'), msg('history-3')], {
      returned: 3,
      reachedBeginning: true,
    });
    const next = applyHistoryPage(state, p, key, 'initial');
    expect(next.messages).toEqual(p.messages);
    expect(next.loadedRawCount).toBe(3);
    expect(next.reachedBeginning).toBe(true);
    expect(next.hasLoadedOnce).toBe(true);
    expect(next.load).toBe('idle');
    expect(next.error).toBeUndefined();
  });
});

describe('applyHistoryPage older', () => {
  it('prepends older page and dedupes overlapping ids, summing loadedRawCount', () => {
    const key = 'k';
    const state: HistoryState = {
      scopeKey: key,
      messages: [msg('history-2'), msg('history-3'), msg('history-4'), msg('history-5')],
      liveMessages: [],
      loadedRawCount: 4,
      reachedBeginning: false,
      load: 'idle',
      hasLoadedOnce: true,
    };
    const older = page([msg('history-1'), msg('history-2'), msg('history-3')], {
      offset: 4,
      returned: 3,
    });
    const next = applyHistoryPage(state, older, key, 'older');
    expect(next.messages.map((m) => m.id)).toEqual([
      'history-1',
      'history-2',
      'history-3',
      'history-4',
      'history-5',
    ]);
    expect(next.loadedRawCount).toBe(7);
    expect(next.hasLoadedOnce).toBe(true);
    expect(next.error).toBeUndefined();
  });

  it('marks reachedBeginning when an older page returns zero rows', () => {
    const key = 'k';
    const state: HistoryState = {
      scopeKey: key,
      messages: [msg('history-2')],
      liveMessages: [],
      loadedRawCount: 2,
      reachedBeginning: false,
      load: 'idle',
      hasLoadedOnce: true,
    };
    const empty = page([], { offset: 2, returned: 0 });
    const next = applyHistoryPage(state, empty, key, 'older');
    expect(next.reachedBeginning).toBe(true);
    expect(next.loadedRawCount).toBe(2);
  });
});

describe('applyHistoryPage refresh', () => {
  it('replaces the overlapping tail and keeps older pages (no duplicates)', () => {
    const key = 'k';
    const state: HistoryState = {
      scopeKey: key,
      messages: [msg('history-1'), msg('history-2'), msg('history-3'), msg('history-4')],
      liveMessages: [],
      loadedRawCount: 4,
      reachedBeginning: false,
      load: 'idle',
      hasLoadedOnce: true,
    };
    const freshTail = page(
      [msg('history-3'), msg('history-4'), msg('history-5')],
      { offset: 0, returned: 5 },
    );
    const next = applyHistoryPage(state, freshTail, key, 'refresh');
    expect(next.messages.map((m) => m.id)).toEqual([
      'history-1',
      'history-2',
      'history-3',
      'history-4',
      'history-5',
    ]);
    expect(next.messages.filter((m) => m.id === 'history-5')).toHaveLength(1);
    // 5 present exactly once
    expect(next.messages.filter((m) => m.id === 'history-3')).toHaveLength(1);
    expect(next.loadedRawCount).toBe(5);
  });

  it('appends a non-overlapping refresh without duplicates', () => {
    const key = 'k';
    const state: HistoryState = {
      scopeKey: key,
      messages: [msg('history-1'), msg('history-2'), msg('history-3'), msg('history-4')],
      liveMessages: [],
      loadedRawCount: 4,
      reachedBeginning: false,
      load: 'idle',
      hasLoadedOnce: true,
    };
    const newPage = page([msg('history-5'), msg('history-6')], {
      offset: 0,
      returned: 2,
    });
    const next = applyHistoryPage(state, newPage, key, 'refresh');
    expect(next.messages.map((m) => m.id)).toEqual([
      'history-1',
      'history-2',
      'history-3',
      'history-4',
      'history-5',
      'history-6',
    ]);
  });
});

describe('load lifecycle + failure', () => {
  it('beginHistoryLoad sets the load and clears prior error', () => {
    let state = makeState();
    state = beginHistoryLoad(state, 'initial');
    expect(state.load).toBe('initial');
    expect(state.error).toBeUndefined();
  });

  it('failHistoryLoad keeps messages and sets error', () => {
    let state = makeState();
    state = applyHistoryPage(
      state,
      page([msg('history-1'), msg('history-2')], { returned: 2, reachedBeginning: true }),
      state.scopeKey,
      'initial',
    );
    const failed = failHistoryLoad(state, 'boom');
    expect(failed.error).toBe('boom');
    expect(failed.messages.map((m) => m.id)).toEqual(['history-1', 'history-2']);
    expect(failed.load).toBe('idle');
  });
});

describe('historyPresentation', () => {
  it('is loading during an initial load that has not finished', () => {
    const state = beginHistoryLoad(makeState(), 'initial');
    expect(historyPresentation(state)).toBe('loading');
  });

  it('is error before any successful load', () => {
    const state = failHistoryLoad(makeState(), 'nope');
    expect(historyPresentation(state)).toBe('error');
  });

  it('is empty when zero messages and reached the beginning', () => {
    const state = applyHistoryPage(makeState(), page([], { returned: 0, reachedBeginning: true }), makeState().scopeKey, 'initial');
    expect(state.messages).toHaveLength(0);
    expect(state.reachedBeginning).toBe(true);
    expect(historyPresentation(state)).toBe('empty');
  });

  it('is complete when reached the beginning with messages', () => {
    const scope = makeScope();
    const state = applyHistoryPage(
      createHistoryState(scope),
      page([msg('history-1')], { returned: 1, reachedBeginning: true }),
      historyScopeKey(scope),
      'initial',
    );
    expect(historyPresentation(state)).toBe('complete');
  });

  it('is partial after a load with more history available', () => {
    const scope = makeScope();
    const state = applyHistoryPage(
      createHistoryState(scope),
      page([msg('history-1')], { returned: 1, reachedBeginning: false }),
      historyScopeKey(scope),
      'initial',
    );
    expect(historyPresentation(state)).toBe('partial');
  });

  it('is partial when there is an error but a prior load succeeded', () => {
    let state = makeState();
    state = applyHistoryPage(
      state,
      page([msg('history-1')], { returned: 1, reachedBeginning: false }),
      state.scopeKey,
      'initial',
    );
    state = failHistoryLoad(state, 'boom');
    expect(historyPresentation(state)).toBe('partial');
  });
});

describe('begin / apply / append / visible', () => {
  it('visibleHistory appends live messages not already in messages', () => {
    const scope = makeScope();
    let state = createHistoryState(scope);
    state = applyHistoryPage(
      state,
      page([msg('history-1'), msg('history-2')], { returned: 2 }),
      historyScopeKey(scope),
      'initial',
    );
    const live = [msg('history-2'), msg('history-3'), msg('history-9')];
    state = appendLiveMessages(state, live);
    const visible = visibleHistory(state);
   // history-2 is already in messages, so it is filtered; history-3 and
    // history-9 are new live messages appended after the loaded history.
    expect(visible.map((m) => m.id)).toEqual([
      'history-1',
      'history-2',
      'history-3',
      'history-9',
    ]);
  });

  it('appendLiveMessages replaces liveMessages wholesale', () => {
    let state = makeState();
    state = appendLiveMessages(state, [msg('history-a')]);
    state = appendLiveMessages(state, [msg('history-b')]);
    expect(state.liveMessages.map((m) => m.id)).toEqual(['history-b']);
    // visible still shows messages then live
    expect(visibleHistory(state).map((m) => m.id)).toEqual(['history-b']);
  });
});

describe('immutability', () => {
  it('does not mutate input state or page (deep-frozen inputs)', () => {
    const scope = makeScope();
    const state = createHistoryState(scope);
    const p = page([msg('history-1'), msg('history-2')], { returned: 2 });

    Object.freeze(p);
    Object.freeze(p.messages);
    p.messages.forEach((m) => Object.freeze(m));
    Object.freeze(state);
    state.messages.forEach((m) => Object.freeze(m));

    const snapshot = JSON.stringify({ ...state });
    expect(() =>
      applyHistoryPage(state, p, historyScopeKey(scope), 'initial'),
    ).not.toThrow();

    // inputs must be untouched
    expect(JSON.stringify({ ...state })).toBe(snapshot);
    expect(state.messages).toHaveLength(0);
    expect(state.load).toBe('idle');
    expect(p.returned).toBe(2);
  });

  it('liveMessages replacement does not mutate the live input array', () => {
    const live = [msg('history-7')];
    const liveSnapshot = JSON.stringify(live);
    const state = makeState();
    appendLiveMessages(state, live);
    expect(JSON.stringify(live)).toBe(liveSnapshot);
  });
});
