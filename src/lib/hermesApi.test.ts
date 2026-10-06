import { describe, expect, it } from 'vitest';
import { resumeResultFromPayload, shouldDeclineOnPhone, clarifyServerRequestResult, approvalActionAvailability, approvalResponseParams, attentionFromEvent, clarifyResponseParams, pendingAttentionEvents, queueOutcomeFromResult, queuePromptParams, steerOutcomeFromError, steerOutcomeFromResult, steerParams, updateAttentionFromEvent, normalizeServerUrl, endpointUrl, eventToMessages, HermesApiClient, normalizeHistoryMessages, redactForLog, wsUrl } from './hermesApi';
import { JsonRpcError } from './jsonRpc';

 describe('normalizeServerUrl', () => {
  it('defaults host:port to http and removes trailing slash', () => {
    expect(normalizeServerUrl('mac.tailnet:9119/')).toBe('http://mac.tailnet:9119');
  });

  it('rejects non-http schemes', () => {
    expect(normalizeServerUrl('javascript:alert(1)')).toBeNull();
  });
});

describe('wsUrl', () => {
  it('maps https to wss and redacts logs', () => {
    const url = wsUrl('https://agent.example', { ticket: 'abc123' });
    expect(url).toBe('wss://agent.example/api/ws?ticket=abc123');
    expect(redactForLog(url)).toContain('ticket=[redacted]');
  });

  it('preserves a proxy path prefix', () => {
    expect(endpointUrl('https://agent.example/hermes', '/api/status').toString()).toBe('https://agent.example/hermes/api/status');
    expect(wsUrl('https://agent.example/hermes', { ticket: 'abc123' })).toBe('wss://agent.example/hermes/api/ws?ticket=abc123');
  });
});


describe('history normalization', () => {
  it('compacts raw tool messages instead of rendering JSON blobs', () => {
    const messages = normalizeHistoryMessages([
      { role: 'user', content: 'Review this repo' },
      { role: 'user', content: '{"method":"prompt.submit","params":{"session_id":"abc","text":"hello"}}' },
      { role: 'tool', content: '{"output":"src/App.tsx | 18 +++++","exit_code":0,"error":null}' },
      { role: 'tool_result', content: '[terminal] ran `npm test` -> exit 0' },
      { role: 'assistant', content: '{"output":"browser snapshot","exit_code":0}' },
      { role: 'assistant', content: '```json\n{"method":"prompt.submit","params":{"session_id":"abc","text":"hello"}}\n```' },
      { role: 'user', content: '[CONTEXT COMPACTION — REFERENCE ONLY] Prior session handoff with lots of JSON.' },
      { role: 'assistant', content: '', tool_calls: [{ function: { name: 'terminal', arguments: '{}' } }] },
      { role: 'assistant', content: '', tool_calls: '[{"id":"call_123","function":{"name":"terminal"}}]' },
      { role: 'assistant', content: '<untrusted_tool_result source="browser_console">{"result":{"session_id":"abc"}}</untrusted_tool_result>' },
      { role: 'assistant', content: 'tool output was saved', tool_name: 'terminal', tool_call_id: 'call_abc' },
      { role: 'assistant', content: '[This response was interrupted by a user correction.]\n\nReasoning shown before the interruption: noisy internals' },
      { role: 'assistant', content: 'Fixed. This mentions tool_calls in prose.\n\n```text\n6885be8 fix: suppress resolved-session tool JSON\n```' },
      { role: 'assistant', content: 'Done.' },
    ]);
    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'Review this repo'],
      ['assistant', 'Fixed. This mentions tool_calls in prose.\n\n```text\n6885be8 fix: suppress resolved-session tool JSON\n```'],
      ['assistant', 'Done.'],
    ]);
  });

  it('drops display_kind hidden rows from history normalization', () => {
    const messages = normalizeHistoryMessages([
      { role: 'user', content: 'visible question', display_kind: 'visible' },
      { role: 'assistant', content: 'hidden internal', display_kind: 'hidden' },
      { role: 'assistant', content: 'shown', display_kind: 'visible' },
    ]);
    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ['user', 'visible question'],
      ['assistant', 'shown'],
    ]);
  });
});


describe('history API transcript fetching', () => {
  it('resolves compressed descendants before fetching messages', async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith('/api/sessions/parent/latest-descendant')) {
        return new Response(JSON.stringify({ session_id: 'child' }), { status: 200 });
      }
      if (url.endsWith('/api/sessions/child')) {
        return new Response(JSON.stringify({ id: 'child', title: 'Child', message_count: 2 }), { status: 200 });
      }
      if (url.includes('/api/sessions/child/messages')) {
        return new Response(JSON.stringify({ session_id: 'child', messages: [{ role: 'assistant', content: 'fresh response' }] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    try {
      const transcript = await new HermesApiClient('https://agent.example/hermes').sessionTranscript({ mode: 'password' }, { id: 'parent', message_count: 500 }, 120);
      expect(transcript.session.id).toBe('child');
      expect(transcript.messages.map((message) => message.text)).toEqual(['fresh response']);
      expect(seen.some((url) => url.includes('/api/sessions/parent/latest-descendant'))).toBe(true);
      expect(seen.some((url) => url.includes('/api/sessions/child/messages?limit=120&offset=0'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('retries transcript fetch from offset zero when cached message counts are stale', async () => {
    const messageUrls: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/sessions/stale/latest-descendant')) return new Response('{}', { status: 500 });
      if (url.endsWith('/api/sessions/stale')) return new Response(JSON.stringify({ id: 'stale', message_count: 500 }), { status: 200 });
      if (url.includes('/api/sessions/stale/messages')) {
        messageUrls.push(url);
        const empty = url.includes('offset=380');
        return new Response(JSON.stringify({ session_id: 'stale', messages: empty ? [] : [{ role: 'assistant', content: 'latest after retry' }] }), { status: 200 });
      }
      return new Response('not found', { status: 404 });
    }) as typeof fetch;
    try {
      const transcript = await new HermesApiClient('https://agent.example').sessionTranscript({ mode: 'password' }, { id: 'stale', message_count: 500 }, 120);
      expect(transcript.messages.map((message) => message.text)).toEqual(['latest after retry']);
      expect(messageUrls.length).toBe(2);
      expect(messageUrls[0]).toContain('offset=380');
      expect(messageUrls[1]).toContain('offset=0');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});



describe('updateAttentionFromEvent', () => {
  it('clears only the matching expired attention request', () => {
    const current = { kind: 'clarify' as const, requestId: 'req-1', title: 'Hermes needs an answer', detail: 'Pick one' };
    expect(updateAttentionFromEvent(current, { type: 'clarify.expire', payload: { request_id: 'req-other' } })).toEqual(current);
    expect(updateAttentionFromEvent(current, { type: 'clarify.expire', payload: { request_id: 'req-1' } })).toBeNull();
  });

  it('clears a restored server request when the gateway cancels it', () => {
    const current = { kind: 'clarify' as const, serverRequestId: 'srq-1', title: 'Hermes needs an answer', detail: 'Pick one' };
    expect(updateAttentionFromEvent(current, {
      type: 'request.cancel',
      payload: { id: 'srq-1', method: 'clarify', reason: 'resolved' },
    })).toBeNull();
  });
});

describe('pendingAttentionEvents', () => {
  it('replays a pending clarify snapshot returned by session.resume', () => {
    expect(pendingAttentionEvents({
      pending_clarify: { request_id: 'req-resume', question: 'Resume where?', choices: ['here', 'later'] },
    })).toEqual([{
      type: 'clarify.request',
      payload: { request_id: 'req-resume', question: 'Resume where?', choices: ['here', 'later'] },
    }]);
  });

  it('replays an explicit pending snapshot without a request id as a disabled fallback', () => {
    expect(pendingAttentionEvents({
      pending_approval: { description: 'A command is still waiting.' },
    })).toEqual([{
      type: 'approval.request',
      payload: { description: 'A command is still waiting.' },
    }]);
  });

  it('does not invent sensitive pending input from a running resume snapshot', () => {
    expect(pendingAttentionEvents({
      session_id: 'runtime-session',
      running: true,
      inflight: { role: 'assistant', tool_calls: [{ function: { name: 'terminal' } }] },
    })).toEqual([]);
  });

  it('replays the current gateway open_requests snapshot as an honest fallback', () => {
    expect(pendingAttentionEvents({
      open_requests: [{
        id: 'srq-resume',
        method: 'clarify',
        params: { session_id: 'runtime-session', question: 'Which region?', choices: ['US', 'EU'] },
      }],
    })).toEqual([{
      type: 'clarify',
      server_request_id: 'srq-resume',
      session_id: 'runtime-session',
      question: 'Which region?',
      choices: ['US', 'EU'],
    }]);
  });
});

describe('approvalResponseParams', () => {
  it('targets one approval request without enabling approve-all', () => {
    expect(approvalResponseParams('session-1', 'request-1', 'once')).toEqual({
      session_id: 'session-1',
      request_id: 'request-1',
      choice: 'once',
      all: false,
    });
  });
});

describe('approvalActionAvailability', () => {
  it('does not offer approve once when the gateway omits that choice', () => {
    expect(approvalActionAvailability({
      kind: 'approval',
      requestId: 'request-deny-only',
      title: 'Approval needed',
      detail: 'This command can only be denied here.',
      choices: ['deny'],
    })).toEqual({ approveOnce: false, deny: true });
  });

  it('offers advertised actions for a current-protocol server request', () => {
    expect(approvalActionAvailability({
      kind: 'approval',
      serverRequestId: 'srq-approval',
      title: 'Approval needed',
      detail: 'Run the command?',
      choices: ['once', 'deny'],
    })).toEqual({ approveOnce: true, deny: true });
  });
});

describe('clarifyResponseParams', () => {
  it('targets the unanswered question in a restored clarify batch', () => {
    expect(clarifyResponseParams('session-1', 'request-1', 'Yes', 'q1')).toEqual({
      session_id: 'session-1',
      request_id: 'request-1',
      question_id: 'q1',
      answer: 'Yes',
    });
  });
});

describe('attentionFromEvent', () => {
  it('normalizes a clarify request into a compact attention model', () => {
    expect(attentionFromEvent({
      type: 'clarify.request',
      payload: { request_id: 'req-clarify', question: 'Which environment?', choices: ['staging', 'production'] },
    })).toEqual({
      kind: 'clarify',
      requestId: 'req-clarify',
      title: 'Hermes needs an answer',
      detail: 'Which environment?',
      choices: ['staging', 'production'],
    });
  });

  it('shows a current-protocol server request without enabling legacy response actions', () => {
    expect(attentionFromEvent({
      type: 'clarify',
      server_request_id: 'srq-live',
      session_id: 'runtime-session',
      question: 'Which environment?',
      choices: ['staging', 'production'],
    })).toEqual({
      kind: 'clarify',
      serverRequestId: 'srq-live',
      title: 'Hermes needs an answer',
      detail: 'Which environment?',
      choices: ['staging', 'production'],
    });
  });

  it('preserves a free-text clarify request for a custom mobile answer', () => {
    expect(attentionFromEvent({
      type: 'clarify.request',
      payload: { request_id: 'req-free-text', question: 'Which deployment label?' },
    })).toEqual({
      kind: 'clarify',
      requestId: 'req-free-text',
      title: 'Hermes needs an answer',
      detail: 'Which deployment label?',
      freeText: true,
    });
  });

  it('marks multi-select clarify requests as unavailable for single-tap submission', () => {
    expect(attentionFromEvent({
      type: 'clarify.request',
      payload: { request_id: 'req-multi', question: 'Which regions?', choices: ['US', 'EU'], multi_select: true },
    })).toEqual({
      kind: 'clarify',
      requestId: 'req-multi',
      title: 'Hermes needs an answer',
      detail: 'Which regions?',
      choices: ['US', 'EU'],
      multiSelect: true,
    });
  });

  it('summarizes a restored batch clarify snapshot without exposing raw JSON', () => {
    expect(attentionFromEvent({
      type: 'clarify.request',
      payload: {
        request_id: 'req-batch',
        questions: [
          { qid: 'q0', question: 'Color?', choices: ['Blue', 'Red'] },
          { qid: 'q1', question: 'Size?', choices: ['Small', 'Large'] },
        ],
        answers: { q0: 'Blue' },
      },
    })).toEqual({
      kind: 'clarify',
      requestId: 'req-batch',
      questionId: 'q1',
      title: 'Hermes needs an answer',
      detail: 'Color? (answered: Blue) · Size? (Small / Large)',
      choices: ['Small', 'Large'],
    });
  });

  it('preserves multi-select on the one unanswered question in a restored batch', () => {
    expect(attentionFromEvent({
      type: 'clarify.request',
      payload: {
        request_id: 'req-batch-multi',
        questions: [{ qid: 'q0', question: 'Regions?', choices: ['US', 'EU'], multi_select: true }],
      },
    })).toMatchObject({
      kind: 'clarify',
      requestId: 'req-batch-multi',
      questionId: 'q0',
      choices: ['US', 'EU'],
      multiSelect: true,
    });
  });

  it('includes the client-safe command in a restored approval summary', () => {
    expect(attentionFromEvent({
      type: 'approval.request',
      payload: {
        request_id: 'req-approval',
        description: 'Deploy the preview build?',
        command: 'npm run deploy -- --preview',
        choices: ['once', 'deny'],
      },
    })).toEqual({
      kind: 'approval',
      requestId: 'req-approval',
      title: 'Approval needed',
      detail: 'Deploy the preview build? · Command: npm run deploy -- --preview',
      choices: ['once', 'deny'],
    });
  });
});

describe('eventToMessages', () => {
  it('keeps blocking input events out of the transcript', () => {
    const existing = [{ id: 'a1', role: 'assistant' as const, text: 'Main answer', state: 'complete' as const }];
    expect(eventToMessages({
      type: 'approval.request',
      payload: { request_id: 'req-approval', description: 'Run a command?' },
    }, existing)).toEqual(existing);
  });

  it('removes transient thinking status when an assistant message completes', () => {
    const started = eventToMessages({ type: 'message.start' }, []);
    const streamed = eventToMessages({ type: 'message.delta', delta: 'done' }, started);
    const completed = eventToMessages({ type: 'message.complete' }, streamed);
    expect(completed.map((message) => message.text)).toEqual(['done']);
    expect(completed[0].state).toBe('complete');
  });

  it('shows the final response when message.complete carries text without deltas', () => {
    const started = eventToMessages({ type: 'message.start' }, []);
    const completed = eventToMessages({ type: 'message.complete', text: 'Latest assistant response' }, started);
    expect(completed.map((message) => [message.role, message.text, message.state])).toEqual([
      ['assistant', 'Latest assistant response', 'complete'],
    ]);
  });

  it('replaces streamed draft text with the final message.complete text', () => {
    const streamed = eventToMessages({ type: 'message.delta', text: 'partial' }, []);
    const completed = eventToMessages({ type: 'message.complete', text: 'full final response' }, streamed);
    expect(completed.map((message) => [message.role, message.text, message.state])).toEqual([
      ['assistant', 'full final response', 'complete'],
    ]);
  });

  it('shows interim assistant commentary instead of dropping it', () => {
    const messages = eventToMessages({ type: 'message.interim', text: 'I checked the logs.' }, []);
    expect(messages.map((message) => [message.role, message.text])).toEqual([
      ['assistant', 'I checked the logs.'],
    ]);
  });
});

describe('sessionHistoryPage', () => {
  it('builds a backward-paginated messages URL with limit/offset/order/profile', async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      return new Response(
        JSON.stringify({
          session_id: 'sess-1',
          profile: 'ops',
          messages: [
            { id: 1, role: 'user', content: 'hello' },
            { id: 2, role: 'assistant', content: 'hi' },
          ],
          pagination: { limit: 50, offset: 100, order: 'latest', returned: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      await new HermesApiClient('https://agent.example/hermes')
        .sessionHistoryPage({ mode: 'password' }, { id: 'sess-1', profile: 'ops' }, { limit: 50, offset: 100 });
      expect(seen[0]).toContain('order=latest');
      expect(seen[0]).toContain('limit=50');
      expect(seen[0]).toContain('offset=100');
      expect(seen[0]).toContain('profile=ops');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('marks reachedBeginning false when pagination.returned equals limit and true when smaller', async () => {
    const originalFetch = globalThis.fetch;
    let returned = 50;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          session_id: 'sess-1',
          messages: Array.from({ length: 50 }, (_, index) => ({ id: index + 1, role: 'user', content: `m${index}` })),
          pagination: { returned },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const client = new HermesApiClient('https://agent.example/hermes');
      const full = await client.sessionHistoryPage({ mode: 'password' }, { id: 'sess-1' }, { limit: 50, offset: 0 });
      expect(full.reachedBeginning).toBe(false);
      returned = 3;
      const partial = await client.sessionHistoryPage({ mode: 'password' }, { id: 'sess-1' }, { limit: 50, offset: 50 });
      expect(partial.reachedBeginning).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('reports returned from pagination while filtering a compacted tool row', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          session_id: 'sess-1',
          messages: [
            { id: 1, role: 'user', content: 'question' },
            { id: 2, role: 'assistant', content: 'answer' },
            { id: 3, role: 'assistant', content: 'tool output was saved', tool_name: 'terminal', tool_call_id: 'call_1' },
          ],
          pagination: { returned: 3 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const page = await new HermesApiClient('https://agent.example/hermes')
        .sessionHistoryPage({ mode: 'password' }, { id: 'sess-1' }, { limit: 50, offset: 0 });
      expect(page.returned).toBe(3);
      expect(page.messages.length).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('drops display_kind hidden rows and renders display_content', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          session_id: 'sess-1',
          messages: [
            { id: 1, role: 'user', content: 'secret hidden', display_kind: 'hidden' },
            { id: 2, role: 'assistant', content: 'should-be-replaced', display_content: 'shown' },
          ],
          pagination: { returned: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const page = await new HermesApiClient('https://agent.example/hermes')
        .sessionHistoryPage({ mode: 'password' }, { id: 'sess-1' }, { limit: 50, offset: 0 });
      expect(page.messages.length).toBe(1);
      expect(page.messages[0].text).toBe('shown');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('derives stable ids from raw id and falls back to index-based ids', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          session_id: 'sess-1',
          messages: [
            { id: 41, role: 'user', content: 'question forty-one' },
            { role: 'assistant', content: 'answer without id' },
          ],
          pagination: { returned: 2 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const page = await new HermesApiClient('https://agent.example/hermes')
        .sessionHistoryPage({ mode: 'password' }, { id: 'sess-1' }, { limit: 50, offset: 0 });
      expect(page.messages[0].id).toBe('history-41');
      expect(page.messages[1].id.startsWith('history-')).toBe(true);
      expect(page.messages[1].id).toContain('1');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('clamps limit to 500 and offset to 0', async () => {
    const seen: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      seen.push(url);
      return new Response(
        JSON.stringify({
          session_id: 'sess-1',
          messages: [],
          pagination: { returned: 0 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as typeof fetch;
    try {
      const page = await new HermesApiClient('https://agent.example/hermes')
         .sessionHistoryPage({ mode: 'password' }, { id: 'sess-1' }, { limit: 9999, offset: -5 });
      expect(seen[0]).toContain('limit=500');
      expect(seen[0]).toContain('offset=0');
      expect(page.reachedBeginning).toBe(true);
      } finally {
      globalThis.fetch = originalFetch;
      }
    });
});

describe('running-turn input helpers', () => {
  it('queuePromptParams marks the submission queued', () => {
    expect(queuePromptParams('session-1', 'do the thing')).toEqual({
      session_id: 'session-1',
      text: 'do the thing',
      queued: true,
     });
   });

  it('steerParams omits profile unless provided', () => {
    expect(steerParams('session-1', 'focus on X')).toEqual({
      session_id: 'session-1',
      text: 'focus on X',
     });
    expect(steerParams('session-1', 'focus on X', 'main')).toEqual({
      session_id: 'session-1',
      text: 'focus on X',
      profile: 'main',
     });
   });

  it('queueOutcomeFromResult maps queued and streaming, unknown otherwise', () => {
    expect(queueOutcomeFromResult({ status: 'queued' })).toEqual({ status: 'queued' });
    expect(queueOutcomeFromResult({ status: 'streaming' })).toEqual({ status: 'streaming' });
    expect(queueOutcomeFromResult({ status: 'idle' })).toEqual({ status: 'unknown', raw: 'idle' });
   });

  it('steerOutcomeFromResult maps queued to accepted, rejected to rejected, unknown otherwise', () => {
    expect(steerOutcomeFromResult({ status: 'queued' })).toEqual({ status: 'accepted' });
    expect(steerOutcomeFromResult({ status: 'rejected' })).toEqual({ status: 'rejected' });
    expect(steerOutcomeFromResult({ status: 'nope' })).toEqual({ status: 'unknown', raw: 'nope' });
   });

  it('steerOutcomeFromError returns unsupported for code 4010 and null otherwise', () => {
    expect(steerOutcomeFromError(new JsonRpcError('no steer support', 4010))).toEqual({ status: 'unsupported' });
    expect(steerOutcomeFromError(new Error('boom'))).toBeNull();
    expect(steerOutcomeFromError(new JsonRpcError('empty text', 4002))).toBeNull();
   });
});

describe('eventToMessages with installed-gateway nested payloads', () => {
  it('streams delta text from payload.text and finalizes from payload.text', () => {
    let messages = eventToMessages({ type: 'message.start', session_id: 's' }, []);
    messages = eventToMessages({ type: 'message.delta', session_id: 's', payload: { text: 'PWA-R1-' } }, messages);
    messages = eventToMessages({ type: 'message.delta', session_id: 's', payload: { text: 'OK' } }, messages);
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', state: 'streaming', text: 'PWA-R1-OK' });
    messages = eventToMessages({ type: 'message.complete', session_id: 's', payload: { text: 'PWA-R1-OK', status: 'complete' } }, messages);
    expect(messages.filter((m) => m.role === 'assistant')).toHaveLength(1);
    expect(messages.at(-1)).toMatchObject({ role: 'assistant', state: 'complete', text: 'PWA-R1-OK' });
  });

  it('still accepts legacy flat delta/text fields', () => {
    const messages = eventToMessages({ type: 'message.delta', delta: 'hi' }, []);
    expect(messages.at(-1)?.text).toBe('hi');
  });

  it('renders status.update text and hides heartbeat kinds', () => {
    const shown = eventToMessages({ type: 'status.update', payload: { kind: 'process', text: 'Running tests…' } }, []);
    expect(shown.at(-1)).toMatchObject({ role: 'status', text: 'Running tests…', meta: 'process' });
    const hidden = eventToMessages({ type: 'status.update', payload: { kind: 'heartbeat', text: '♥ heartbeat #3 firing…' } }, []);
    expect(hidden).toHaveLength(0);
  });
});

describe('resumeResultFromPayload keeps live and stored ids distinct', () => {
  it('maps session_id to the live id and session_key to the stored id', () => {
    const result = resumeResultFromPayload({ session_id: 'live-7', session_key: '20261006-abc', running: true, status: 'streaming' }, 'requested', []);
    expect(result).toMatchObject({ sessionId: 'live-7', storedId: '20261006-abc', running: true, status: 'streaming', openRequestKeys: [] });
  });
  it('falls back to the requested id when the payload has neither', () => {
    expect(resumeResultFromPayload({}, 'requested', [])).toMatchObject({ sessionId: 'requested', storedId: 'requested', running: false });
  });
});

describe('shouldDeclineOnPhone', () => {
  it('declines sudo/secret/multi-select server requests and keeps answerable ones', () => {
    expect(shouldDeclineOnPhone({ kind: 'sudo', serverRequestId: 's1', title: 't', detail: 'd' })).toBe(true);
    expect(shouldDeclineOnPhone({ kind: 'secret', serverRequestId: 's2', title: 't', detail: 'd' })).toBe(true);
    expect(shouldDeclineOnPhone({ kind: 'clarify', serverRequestId: 's3', title: 't', detail: 'd', choices: ['A', 'B'], multiSelect: true })).toBe(true);
    expect(shouldDeclineOnPhone({ kind: 'clarify', serverRequestId: 's4', questionId: 'q0', title: 't', detail: 'd', choices: ['A', 'B'] })).toBe(false);
    expect(shouldDeclineOnPhone({ kind: 'clarify', serverRequestId: 's5', questionId: 'q0', title: 't', detail: 'd', freeText: true })).toBe(false);
    expect(shouldDeclineOnPhone({ kind: 'approval', serverRequestId: 's6', title: 't', detail: 'd', choices: ['once', 'deny'] })).toBe(false);
    expect(shouldDeclineOnPhone({ kind: 'approval', serverRequestId: 's7', title: 't', detail: 'd', choices: ['always'] })).toBe(true);
  });
  it('never declines legacy requests without a server request id', () => {
    expect(shouldDeclineOnPhone({ kind: 'sudo', requestId: 'legacy', title: 't', detail: 'd' })).toBe(false);
  });
});

describe('clarifyServerRequestResult', () => {
  it('answers the installed gateway contract: { answers: { [qid]: answer } }', () => {
    expect(clarifyServerRequestResult('q0', 'Beta')).toEqual({ answers: { q0: 'Beta' } });
  });
  it('a current-protocol clarify without a qid is declined on the phone', () => {
    expect(shouldDeclineOnPhone({ kind: 'clarify', serverRequestId: 's', title: 't', detail: 'd', choices: ['A'] })).toBe(true);
    expect(shouldDeclineOnPhone({ kind: 'clarify', serverRequestId: 's', questionId: 'q0', title: 't', detail: 'd', choices: ['A'] })).toBe(false);
  });
});
