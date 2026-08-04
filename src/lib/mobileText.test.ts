import { describe, expect, it } from 'vitest';
import { formatMessageTextForMobile } from './mobileText';

describe('formatMessageTextForMobile', () => {
  it('removes markdown text fences from assistant summaries', () => {
    expect(formatMessageTextForMobile('Verification passed:\n\n```text\nnpm run typecheck\nnpm test\n```\n\nNew commit:\n\n```text\nda3380e fix: remove tool placeholders\n```')).toBe('Verification passed:\n\nnpm run typecheck\nnpm test\n\nNew commit:\n\nda3380e fix: remove tool placeholders');
  });

  it('removes inline markdown that appears as raw punctuation on mobile', () => {
    const text = 'Then tap **Refresh transcript**.\n- The ` ```text ` fence markers should disappear.\n```text\n📎 filename.pdf\n```';
    expect(formatMessageTextForMobile(text)).toBe('Then tap Refresh transcript.\n- The fence markers should disappear.\n📎 filename.pdf');
  });

  it('preserves full URL text while cleaning surrounding markdown', () => {
    const url = 'https://hermes.example.test/?v=23';
    expect(formatMessageTextForMobile(`Fresh URL:\n\n\`\`\`text\n${url}\n\`\`\``)).toBe(`Fresh URL:\n\n${url}`);
  });
});
