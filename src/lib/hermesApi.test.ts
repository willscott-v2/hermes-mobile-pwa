import { describe, expect, it } from 'vitest';
import { normalizeServerUrl, endpointUrl, eventToMessages, HermesApiClient, normalizeHistoryMessages, redactForLog, wsUrl } from './hermesApi';

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
});


describe('connection diagnostics and runtime catalog', () => {
  it('diagnoses a healthy password dashboard without persisting a password', async () => {
    const requests: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith('/api/status')) return new Response(JSON.stringify({ version: 'test', auth_required: true, gateway_running: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/api/auth/providers')) return new Response(JSON.stringify({ providers: [{ name: 'local', display_name: 'Local', supports_password: true }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/auth/password-login')) return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/api/auth/ws-ticket')) return new Response(JSON.stringify({ ticket: 'ticket-1' }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    try {
      const client = new HermesApiClient('https://agent.example/hermes');
      const result = await client.diagnoseConnection({ mode: 'password', username: 'will', password: 'secret' });

      expect(result.ok).toBe(true);
      expect(result.steps.map((step) => step.state)).toEqual(['passed', 'passed', 'passed', 'passed', 'passed']);
      expect(JSON.stringify(result)).not.toContain('secret');
      expect(requests.some((url) => url.endsWith('/api/auth/ws-ticket'))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('diagnoses likely wrong PWA URL when status route returns html', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response('<!doctype html><div id="root"></div>', { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
    try {
      const client = new HermesApiClient('https://agent.example');
      const result = await client.diagnoseConnection({ mode: 'password', username: '', password: '' });
      expect(result.ok).toBe(false);
      expect(result.steps.find((step) => step.id === 'status')?.issue).toBe('wrong-pwa-url');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('loads runtime catalog from optional dashboard endpoints', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/api/profiles')) return new Response(JSON.stringify({ profiles: ['default', 'research'] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/api/projects')) return new Response(JSON.stringify({ projects: [{ id: 'pwa', name: 'PWA' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/api/models')) return new Response(JSON.stringify({ models: [{ id: 'm1', label: 'Model 1' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
      return new Response('{}', { status: 404 });
    }) as typeof fetch;
    try {
      const catalog = await new HermesApiClient('https://agent.example/hermes').runtimeCatalog({ mode: 'password' });
      expect(catalog.profiles.map((profile) => profile.id)).toContain('research');
      expect(catalog.projects[0]).toEqual({ id: 'pwa', label: 'PWA' });
      expect(catalog.models[0]).toEqual({ id: 'm1', label: 'Model 1' });
    } finally {
      globalThis.fetch = originalFetch;
    }
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


describe('eventToMessages', () => {
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
