import { describe, expect, it, vi } from 'vitest';
import { JsonRpcPeer, parseJsonRpcMessage } from './jsonRpc';

describe('parseJsonRpcMessage', () => {
  it('parses newline-delimited frames and skips invalid lines', () => {
    const frames = parseJsonRpcMessage('{"id":1,"result":{}}\nnot-json\n{"type":"message.delta","delta":"hi"}');
    expect(frames).toHaveLength(2);
    expect(frames[1].type).toBe('message.delta');
  });
});

describe('JsonRpcPeer', () => {
  it('uses per-request timeout overrides for slow prompt submits', async () => {
    vi.useFakeTimers();
    const sent: string[] = [];
    const peer = new JsonRpcPeer({ send: (frame: string) => sent.push(frame) } as unknown as WebSocket, 1_000);
    const request = peer.request('prompt.submit', { session_id: 's1', text: 'slow turn' }, { timeoutMs: 10_000 });

    await vi.advanceTimersByTimeAsync(1_500);
    expect(sent[0]).toContain('prompt.submit');
    const stillPending = Promise.race([
      request.then(() => 'resolved', () => 'rejected'),
      Promise.resolve('pending'),
    ]);
    await expect(stillPending).resolves.toBe('pending');

    peer.handleFrame({ id: 1, result: { status: 'streaming' } });
    await expect(request).resolves.toEqual({ status: 'streaming' });
    vi.useRealTimers();
  });
});
