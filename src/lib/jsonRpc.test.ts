import { describe, expect, it, vi } from 'vitest';
import { JsonRpcError, JsonRpcPeer, parseJsonRpcMessage } from './jsonRpc';

describe('parseJsonRpcMessage', () => {
  it('parses newline-delimited frames and skips invalid lines', () => {
    const frames = parseJsonRpcMessage('{"id":1,"result":{}}\nnot-json\n{"type":"message.delta","delta":"hi"}');
    expect(frames).toHaveLength(2);
    expect(frames[1].type).toBe('message.delta');
  });
});

describe('JsonRpcPeer', () => {
  it('preserves the gateway event type inside method=event frames', () => {
    const peer = new JsonRpcPeer({ send: () => {} } as unknown as WebSocket);
    expect(peer.handleFrame({
      jsonrpc: '2.0',
      method: 'event',
      params: { type: 'clarify.request', session_id: 's1', payload: { request_id: 'req-1', question: 'Pick?' } },
    })).toEqual({
      type: 'clarify.request',
      session_id: 's1',
      payload: { request_id: 'req-1', question: 'Pick?' },
    });
  });

  it('preserves string ids on server-to-client request frames', () => {
    const peer = new JsonRpcPeer({ send: () => {} } as unknown as WebSocket);
    expect(peer.handleFrame({
      jsonrpc: '2.0',
      id: 'srq-live',
      method: 'clarify',
      params: { session_id: 's1', question: 'Pick one?' },
    })).toEqual({
      type: 'clarify',
      server_request_id: 'srq-live',
      session_id: 's1',
      question: 'Pick one?',
    });
  });

  it('answers a server request with a correlated JSON-RPC response frame', () => {
    const socket = { send: vi.fn() } as unknown as WebSocket;
    const peer = new JsonRpcPeer(socket);

    peer.respond('srq-approval', { choice: 'once' });

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({
      jsonrpc: '2.0',
      id: 'srq-approval',
      result: { choice: 'once' },
    }));
  });

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

  it('rejects a pending request with a JsonRpcError carrying the code', async () => {
    const peer = new JsonRpcPeer({ send: () => {} } as unknown as WebSocket);
    const pending = peer.request('session.steer', { session_id: 's1', text: 'steer' });

    peer.handleFrame({ jsonrpc: '2.0', id: 1, error: { code: 4010, message: 'agent does not support steer' } });

    await expect(pending).rejects.toBeInstanceOf(JsonRpcError);
    await expect(pending).rejects.toMatchObject({ code: 4010 });
  });
});

describe('JsonRpcPeer.respondError', () => {
  it('sends a JSON-RPC error frame with the given code for a server request id', () => {
    const sent: string[] = [];
    const peer = new JsonRpcPeer({ send: (frame: string) => sent.push(frame) } as unknown as WebSocket);
    peer.respondError('srq-9', 4404, 'not shown here');
    expect(JSON.parse(sent[0])).toEqual({ jsonrpc: '2.0', id: 'srq-9', error: { code: 4404, message: 'not shown here' } });
  });
});
