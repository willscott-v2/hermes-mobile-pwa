import type { AttentionRequest } from './hermesApi';
import type { JsonRpcEvent } from './jsonRpc';

export type AttentionPhase = 'none' | 'waiting' | 'submitting' | 'sent-unconfirmed' | 'resolved' | 'cancelled' | 'disconnected' | 'unsupported';

export interface AttentionState {
  phase: AttentionPhase;
  request: AttentionRequest | null;
  sessionKey: string;
  responseKey?: string;
  sentAt?: number;
  note?: string;
}

// The identity of a request, or undefined when it cannot be answered from the phone.
export function requestKey(request: AttentionRequest | null | undefined): string | undefined {
  if (!request) return undefined;
  return request.requestId ?? request.serverRequestId ?? undefined;
}

export function createAttentionState(sessionKey: string): AttentionState {
  return { phase: 'none', request: null, sessionKey };
}

export function showAttention(state: AttentionState, request: AttentionRequest | null, sessionKey: string): AttentionState {
  if (request === null) {
    if (state.phase === 'submitting' || state.phase === 'sent-unconfirmed') {
      return state;
    }
    return { ...state, phase: 'none', request: null, sessionKey, responseKey: undefined, sentAt: undefined, note: undefined };
  }

  const key = requestKey(request);
  if (key === undefined) {
    return { ...state, phase: 'unsupported', request, sessionKey, note: 'This request cannot be answered from the phone.' };
  }

  // A duplicate frame of the request we already answered keeps the in-flight state.
  if (key === state.responseKey && state.phase === 'sent-unconfirmed') {
    return state;
  }

  // A new or different request (including a session switch) starts as waiting.
  if (sessionKey !== state.sessionKey || key !== state.responseKey) {
    return { ...state, phase: 'waiting', request, sessionKey, responseKey: undefined, sentAt: undefined, note: undefined };
  }

  return state;
}

export function canRespond(state: AttentionState): boolean {
  return state.phase === 'waiting';
}

export function beginResponse(state: AttentionState, key: string, sessionKey: string): AttentionState | null {
  if (!canRespond(state)) return null;
  if (key !== requestKey(state.request)) return null;
  if (sessionKey !== state.sessionKey) return null;
  return { ...state, phase: 'submitting', responseKey: key };
}

export function markSent(state: AttentionState, key: string, now: number): AttentionState {
  if (state.phase !== 'submitting' || state.responseKey !== key) return state;
  return { ...state, phase: 'sent-unconfirmed', sentAt: now, note: 'Response sent; checking status…' };
}

export function markSendFailed(state: AttentionState, key: string, error: string): AttentionState {
  if (state.phase !== 'submitting' || state.responseKey !== key) return state;
  return { ...state, phase: 'waiting', responseKey: undefined, note: error };
}

export function reconcileEvent(state: AttentionState, event: JsonRpcEvent, sessionKey: string): AttentionState {
  if (sessionKey !== state.sessionKey) return state;

  const type = event.type;
  const payload = (event.payload && typeof event.payload === 'object')
    ? event.payload as Record<string, unknown>
    : {};

  // A cancel/expire for the request we are answering is authoritative even if it
  // lands before the send call returns (the gateway can answer synchronously).
  if (state.phase === 'sent-unconfirmed' || state.phase === 'submitting') {
    const expires = type !== undefined && type.endsWith('.expire');
    if ((type === 'request.cancel' && payload.id === state.responseKey) ||
        (expires && payload.request_id === state.responseKey)) {
      return { ...state, phase: 'resolved', request: null, note: 'Resolved.' };
    }
  }

  if (state.phase === 'sent-unconfirmed') {
    if (type === 'message.start' || type === 'message.delta' ||
        type === 'message.complete' || type === 'message.interim') {
      return { ...state, phase: 'resolved', request: null, note: 'Hermes continued.' };
    }
    return state;
  }

  if (state.phase === 'waiting') {
    const rkey = requestKey(state.request);
    const expires = type !== undefined && type.endsWith('.expire');
    if ((type === 'request.cancel' && payload.id === rkey) ||
        (expires && payload.request_id === rkey)) {
      return { ...state, phase: 'cancelled', request: null, note: 'This request was resolved elsewhere.' };
    }
    return state;
  }

  return state;
}

export function reconcileResume(state: AttentionState, openKeys: string[], sessionKey: string): AttentionState {
  if (sessionKey !== state.sessionKey) return createAttentionState(sessionKey);

  if (state.phase === 'sent-unconfirmed') {
    if (state.responseKey !== undefined && openKeys.includes(state.responseKey)) {
      return { ...state, phase: 'waiting', note: 'Could not confirm your response; it is still open.' };
    }
    return { ...state, phase: 'resolved', request: null, note: 'Resolved.' };
  }

  if (state.phase === 'waiting') {
    const rkey = requestKey(state.request);
    if (rkey !== undefined && !openKeys.includes(rkey)) {
      return { ...state, phase: 'cancelled', request: null, note: 'This request was resolved elsewhere.' };
    }
    return state;
  }

  return state;
}

export function markDisconnected(state: AttentionState): AttentionState {
  if (state.phase === 'submitting' || state.phase === 'sent-unconfirmed') {
    return {
      ...state,
      phase: 'disconnected',
      note: 'Connection lost before Hermes confirmed. Reopen the session to check.'
    };
  }
  return state;
}
