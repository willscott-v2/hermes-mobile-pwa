import { describe, expect, it } from 'vitest';
import type { ChatMessage } from './hermesApi';
import { compactMessagesForMobile } from './mobileText';

describe('compactMessagesForMobile', () => {
  it('collapses consecutive tool events without exposing raw output', () => {
    const messages: ChatMessage[] = [
      { id: '1', role: 'assistant', text: 'Checking now.' },
      { id: '2', role: 'tool', text: '{"output":"private value"}', meta: 'terminal' },
      { id: '3', role: 'tool', text: '{"output":"another value"}', meta: 'read_file' },
      { id: '4', role: 'assistant', text: 'Done.' },
    ];
    const result = compactMessagesForMobile(messages);
    expect(result.map((message) => message.text)).toEqual(['Checking now.', '2 tool actions completed', 'Done.']);
    expect(JSON.stringify(result)).not.toContain('private value');
  });

  it('keeps legitimate assistant JSON and protocol examples', () => {
    const message: ChatMessage = {
      id: '1',
      role: 'assistant',
      text: 'Example: {"method":"session.resume","params":{"session_id":"demo"}}',
    };
    expect(compactMessagesForMobile([message])).toEqual([message]);
  });

  it('collapses status messages explicitly marked as tool output', () => {
    const result = compactMessagesForMobile([{ id: '1', role: 'status', text: '{"output":"secret"}', meta: 'tool result' }]);
    expect(result).toHaveLength(1);
    expect(result[0].text).toBe('1 tool action completed');
    expect(result[0].meta).toBe('tool activity');
  });
});
