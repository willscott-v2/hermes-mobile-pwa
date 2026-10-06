import { describe, expect, it } from 'vitest';
import type { AttentionRequest } from './hermesApi';
import type { AttentionState } from './attentionState';
import type { JsonRpcEvent } from './jsonRpc';
import {
  beginResponse,
  canRespond,
  createAttentionState,
  markDisconnected,
  markSendFailed,
  markSent,
  reconcileEvent,
  reconcileResume,
  requestKey,
  showAttention
} from './attentionState';

const req = (id: string): AttentionRequest => ({
  kind: 'approval',
  requestId: id,
  title: 'Approval needed',
  detail: 'rm -rf build',
  choices: ['once', 'deny']
});

const serverReq = (id: string): AttentionRequest => ({
  kind: 'clarify',
  serverRequestId: id,
  title: 'Clarify',
  detail: 'which build?'
});

const ev = (type: string, payload: Record<string, unknown> = {}): JsonRpcEvent =>
  ({ type, payload }) as JsonRpcEvent;

const unkeyed: AttentionRequest = {
  kind: 'approval',
  title: 'Approval needed',
  detail: 'danger'
};

// Reach a submitted, unconfirmed state for the request with key `key`.
function sentState(sessionKey: string, key: string, r1 = key): AttentionState {
  const shown = showAttention(createAttentionState(sessionKey), r1 ? req(key) : null, sessionKey);
  const begin = beginResponse(shown, key, sessionKey);
  if (begin === null) throw new Error('expected beginResponse to succeed');
  return markSent(begin, key, 1000);
}

describe('showAttention', () => {
  it('a keyed request reads as waiting and can be answered', () => {
    const s = showAttention(createAttentionState('s1'), req('r1'), 's1');
    expect(s.phase).toBe('waiting');
    expect(canRespond(s)).toBe(true);
    expect(s.responseKey).toBeUndefined();
  });

  it('a request with only serverRequestId is keyed by that id', () => {
    expect(requestKey(serverReq('s9'))).toBe('s9');
    const s = showAttention(createAttentionState('s1'), serverReq('s9'), 's1');
    expect(s.phase).toBe('waiting');
  });

  it('an unkeyed request is unsupported and cannot be answered', () => {
    const s = showAttention(createAttentionState('s1'), unkeyed, 's1');
    expect(s.phase).toBe('unsupported');
    expect(canRespond(s)).toBe(false);
    expect(s.note).toBe('This request cannot be answered from the phone.');
  });

  it('showAttention(null) during sent-unconfirmed keeps the in-flight state', () => {
    const s = sentState('s1', 'r1', 'r1');
    expect(s.phase).toBe('sent-unconfirmed');
    const after = showAttention(s, null, 's1');
    expect(after).toBe(s);
  });

  it('a duplicate frame of the answered request keeps the state', () => {
    const s = sentState('s1', 'r1', 'r1');
    const after = showAttention(s, req('r1'), 's1');
    expect(after).toBe(s);
    expect(after.phase).toBe('sent-unconfirmed');
  });

  it('a different key while unconfirmed starts the new request as waiting', () => {
    const s = sentState('s1', 'r1', 'r1');
    const after = showAttention(s, req('r2'), 's1');
    expect(after.phase).toBe('waiting');
    expect(after.request).not.toBeNull();
    expect((after.request as AttentionRequest).requestId).toBe('r2');
  });

  it('null from a fresh session resets to none', () => {
    const s = showAttention(createAttentionState('s1'), null, 's1');
    expect(s.phase).toBe('none');
    expect(s.request).toBeNull();
  });
});

describe('beginResponse', () => {
  it('refuses a wrong key, wrong session, and a non-waiting phase', () => {
    const s = showAttention(createAttentionState('s1'), req('r1'), 's1');
    expect(beginResponse(s, 'nope', 's1')).toBeNull();
    expect(beginResponse(s, 'r1', 's2')).toBeNull();
    const submitting = beginResponse(s, 'r1', 's1');
    expect(submitting).not.toBeNull();
    expect(submitting?.phase).toBe('submitting');
    expect(beginResponse(submitting ?? s, 'r1', 's1')).toBeNull();
  });
});

describe('markSent / markSendFailed', () => {
  it('markSent moves submitting to sent-unconfirmed with a note', () => {
    const s = showAttention(createAttentionState('s1'), req('r1'), 's1');
    const submitting = beginResponse(s, 'r1', 's1');
    expect(submitting).not.toBeNull();
    const sent = markSent(submitting ?? s, 'r1', 4242);
    expect(sent.phase).toBe('sent-unconfirmed');
    expect(sent.sentAt).toBe(4242);
    expect(sent.note).toBe('Response sent; checking status…');
    expect(sent.responseKey).toBe('r1');
  });

  it('markSent is a no-op for the wrong key or wrong phase', () => {
    const s = showAttention(createAttentionState('s1'), req('r1'), 's1');
    expect(markSent(s, 'r1', 1)).toBe(s);
    const submitting = beginResponse(s, 'r1', 's1');
    expect(markSent(submitting ?? s, 'other', 1)).toBe(submitting ?? s);
  });

  it('markSendFailed returns to waiting carrying the error note', () => {
    const s = showAttention(createAttentionState('s1'), req('r1'), 's1');
    const submitting = beginResponse(s, 'r1', 's1');
    expect(submitting).not.toBeNull();
    const failed = markSendFailed(submitting ?? s, 'r1', 'socket closed');
    expect(failed.phase).toBe('waiting');
    expect(failed.responseKey).toBeUndefined();
    expect(failed.note).toBe('socket closed');
  });
});

describe('reconcileEvent', () => {
  it('a continuing message after send resolves the request', () => {
    const s = sentState('s1', 'r1', 'r1');
    const r = reconcileEvent(s, ev('message.delta'), 's1');
    expect(r.phase).toBe('resolved');
    expect(r.request).toBeNull();
    expect(r.note).toBe('Hermes continued.');
  });

  it('matching request.cancel after send resolves the request', () => {
    const s = sentState('s1', 'r1', 'r1');
    const r = reconcileEvent(s, ev('request.cancel', { id: 'r1' }), 's1');
    expect(r.phase).toBe('resolved');
    expect(r.request).toBeNull();
    expect(r.note).toBe('Resolved.');
  });

  it('matching request.cancel while waiting cancels the request', () => {
    const s = showAttention(createAttentionState('s1'), req('r1'), 's1');
    const r = reconcileEvent(s, ev('request.cancel', { id: 'r1' }), 's1');
    expect(r.phase).toBe('cancelled');
    expect(r.request).toBeNull();
    expect(r.note).toBe('This request was resolved elsewhere.');
  });

  it('an .expire event for the open request cancels it', () => {
    const s = showAttention(createAttentionState('s1'), req('r1'), 's1');
    const r = reconcileEvent(s, ev('request.expire', { request_id: 'r1' }), 's1');
    expect(r.phase).toBe('cancelled');
  });

  it('ignores events from another session', () => {
    const s = sentState('s1', 'r1', 'r1');
    expect(reconcileEvent(s, ev('message.delta'), 's2')).toBe(s);
  });

  it('leaves unrelated events unchanged', () => {
    const s = sentState('s1', 'r1', 'r1');
    expect(reconcileEvent(s, ev('heartbeat'), 's1')).toBe(s);
    expect(reconcileEvent(s, ev('request.cancel', { id: 'other' }), 's1')).toBe(s);
  });
});

describe('reconcileResume', () => {
  it('an open response after resume waits and asks the user to re-answer', () => {
    const s = sentState('s1', 'r1', 'r1');
    const r = reconcileResume(s, ['r1'], 's1');
    expect(r.phase).toBe('waiting');
    expect(r.note).toBe('Could not confirm your response; it is still open.');
  });

  it('a closed response after resume resolves cleanly', () => {
    const s = sentState('s1', 'r1', 'r1');
    const r = reconcileResume(s, [], 's1');
    expect(r.phase).toBe('resolved');
    expect(r.request).toBeNull();
  });

  it('a waiting request that closed elsewhere is cancelled', () => {
    const s = showAttention(createAttentionState('s1'), req('r1'), 's1');
    expect(reconcileResume(s, ['other'], 's1').phase).toBe('cancelled');
    const still = reconcileResume(s, ['r1'], 's1');
    expect(still).toBe(s);
  });

  it('a different session starts fresh', () => {
    const s = sentState('s1', 'r1', 'r1');
    const r = reconcileResume(s, ['r1'], 's2');
    expect(r.phase).toBe('none');
    expect(r.request).toBeNull();
    expect(r.sessionKey).toBe('s2');
  });
});

describe('markDisconnected', () => {
  it('drops an in-flight unconfirmed response to disconnected', () => {
    const s = sentState('s1', 'r1', 'r1');
    const d = markDisconnected(s);
    expect(d.phase).toBe('disconnected');
    expect(d.note).toBe('Connection lost before Hermes confirmed. Reopen the session to check.');
  });

  it('leaves a waiting request shown (caller gates on socket state)', () => {
    const s = showAttention(createAttentionState('s1'), req('r1'), 's1');
    expect(markDisconnected(s)).toBe(s);
  });
});

describe('purity', () => {
  it('never mutates its input states', () => {
    const s = showAttention(createAttentionState('s1'), req('r1'), 's1');
    const before = JSON.stringify(s);
    const submitting = beginResponse(s, 'r1', 's1');
    markSent(submitting ?? s, 'r1', 9);
    markSendFailed(s, 'r1', 'x');
    reconcileEvent(s, ev('request.cancel', { id: 'r1' }), 's1');
    reconcileResume(s, [], 's1');
    markDisconnected(s);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe('synchronous cancel during submitting', () => {
  it('resolves when request.cancel for the answered key lands before markSent', () => {
    const base = showAttention(createAttentionState('s'), { kind: 'approval', requestId: 'r1', title: 'Approval needed', detail: 'x', choices: ['once', 'deny'] }, 's');
    const submitting = beginResponse(base, 'r1', 's')!;
    const resolved = reconcileEvent(submitting, { type: 'request.cancel', payload: { id: 'r1' } }, 's');
    expect(resolved.phase).toBe('resolved');
    expect(markSent(resolved, 'r1', 1).phase).toBe('resolved');
  });
});
