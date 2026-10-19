import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MessageContent } from './MessageContent';

function render(markdown: string) {
  return renderToStaticMarkup(<MessageContent text={markdown} />);
}

describe('MessageContent', () => {
  it('renders structured markdown and GFM tables', () => {
    const html = render('# Result\n\n- **One**\n- `two`\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<h1>Result</h1>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>One</strong>');
    expect(html).toContain('<code>two</code>');
    expect(html).toContain('class="table-scroll"');
    expect(html).toContain('<table>');
  });

  it('renders fenced code in a scrollable block with a copy control', () => {
    const html = render('```ts\nconst answer = 42;\n```');
    expect(html).toContain('class="code-block"');
    expect(html).toContain('Copy code');
    expect(html).toContain('language-ts');
    expect(html).toContain('const answer = 42;');
  });

  it('drops raw HTML and blocks non-http links and remote markdown images', () => {
    const html = render('<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [mail](mailto:test@example.com) [good](https://example.com)\n\n![tracker](https://example.com/pixel.gif)');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('mailto:');
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('rel="noreferrer noopener"');
    expect(html).not.toContain('<img');
    expect(html).toContain('Image: tracker');
  });

  it('preserves legitimate protocol examples as readable assistant content', () => {
    const html = render('The payload is:\n\n```json\n{"method":"session.resume","params":{"session_id":"demo"}}\n```');
    expect(html).toContain('session.resume');
    expect(html).toContain('session_id');
  });
});
