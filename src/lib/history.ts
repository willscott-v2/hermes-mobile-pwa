import type { ChatMessage, HistoryPage } from './hermesApi';

export type HistoryLoad = 'idle' | 'initial' | 'older' | 'refreshing';

export interface HistoryScope {
  baseUrl: string;
  profile?: string;
  sessionId: string;
}

export function historyScopeKey(scope: HistoryScope): string {
  return `${scope.baseUrl}|${scope.profile ?? ''}|${scope.sessionId}`;
}

export interface HistoryState {
  scopeKey: string;
  // all loaded history, chronological, deduped by id
  messages: ChatMessage[];
  // messages appended by live events this session (not from REST), chronological
  liveMessages: ChatMessage[];
  // sum of `returned` across pages loaded so far = next backward offset
  loadedRawCount: number;
  reachedBeginning: boolean;
  load: HistoryLoad;
  // last load error; cleared on success
  error?: string;
  // at least one page succeeded
  hasLoadedOnce: boolean;
}

export function createHistoryState(scope: HistoryScope): HistoryState {
  return {
    scopeKey: historyScopeKey(scope),
    messages: [],
    liveMessages: [],
    loadedRawCount: 0,
    reachedBeginning: false,
    load: 'idle',
    error: undefined,
    hasLoadedOnce: false,
  };
}

export function beginHistoryLoad(
  state: HistoryState,
  load: Exclude<HistoryLoad, 'idle'>,
): HistoryState {
  return {
    ...state,
    load,
    error: undefined,
  };
}

export function failHistoryLoad(state: HistoryState, error: string): HistoryState {
  return {
    ...state,
    load: 'idle',
    error,
  };
}

// Keep the FIRST occurrence of each id, preserving order.
function dedupeById(messages: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  const out: ChatMessage[] = [];
  for (const m of messages) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
  }
  return out;
}

export function applyHistoryPage(
  state: HistoryState,
  page: HistoryPage,
  scopeKey: string,
  mode: 'initial' | 'older' | 'refresh',
): HistoryState {
  // Stale cross-session result: discard unchanged (same reference).
  if (scopeKey !== state.scopeKey) return state;

  if (mode === 'initial') {
    return {
      ...state,
      messages: page.messages,
      loadedRawCount: page.returned,
      reachedBeginning: page.reachedBeginning,
      load: 'idle',
      error: undefined,
      hasLoadedOnce: true,
    };
  }

  if (mode === 'older') {
    // Older page comes first; keep first occurrence of each id.
    const messages = dedupeById([...page.messages, ...state.messages]);
    let reachedBeginning = state.reachedBeginning || page.reachedBeginning;
    if (page.returned === 0) reachedBeginning = true;
    return {
      ...state,
      messages,
      loadedRawCount: state.loadedRawCount + page.returned,
      reachedBeginning,
      load: 'idle',
      error: undefined,
      hasLoadedOnce: true,
    };
  }

  // mode === 'refresh'
  const pageIds = new Set(page.messages.map((m) => m.id));
  const overlapIndex = state.messages.findIndex((m) => pageIds.has(m.id));

  let messages: ChatMessage[];
  if (overlapIndex !== -1) {
    // Replace the overlapping tail with the fresh tail; keep older pages.
    messages = [...state.messages.slice(0, overlapIndex), ...page.messages];
  } else if (state.messages.length === 0) {
    messages = [...page.messages];
  } else {
    messages = dedupeById([...state.messages, ...page.messages]);
  }

  const reachedBeginning =
    state.reachedBeginning ||
    (page.reachedBeginning && state.loadedRawCount <= page.returned);

  return {
    ...state,
    messages,
    loadedRawCount: Math.max(state.loadedRawCount, page.returned),
    reachedBeginning,
    load: 'idle',
    error: undefined,
    hasLoadedOnce: true,
  };
}

export function appendLiveMessages(
  state: HistoryState,
  live: ChatMessage[],
): HistoryState {
  return {
    ...state,
    liveMessages: [...live],
  };
}

export function visibleHistory(state: HistoryState): ChatMessage[] {
  const messageIds = new Set(state.messages.map((m) => m.id));
  const liveTail = state.liveMessages.filter((m) => !messageIds.has(m.id));
  return [...state.messages, ...liveTail];
}

export type HistoryPresentation = 'loading' | 'error' | 'empty' | 'partial' | 'complete';

export function historyPresentation(state: HistoryState): HistoryPresentation {
  if (state.load === 'initial') return 'loading';
  if (state.error && !state.hasLoadedOnce) return 'error';
  if (state.hasLoadedOnce && state.messages.length === 0 && state.reachedBeginning) {
    return 'empty';
  }
  if (state.hasLoadedOnce && state.reachedBeginning) return 'complete';
  return 'partial';
}
