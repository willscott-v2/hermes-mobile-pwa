import { Children, isValidElement, ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

function safeHttpUrl(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '';
  } catch {
    return '';
  }
}

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}

function CodeBlock({ children }: { children?: ReactNode }) {
  const text = nodeText(children).replace(/\n$/, '');
  async function copy() {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // Clipboard permission can be unavailable in installed or embedded PWAs.
    }
  }

  return (
    <div className="code-block">
      <button type="button" className="copy-code" onClick={() => { void copy(); }} aria-label="Copy code">Copy code</button>
      <pre>{children}</pre>
    </div>
  );
}

export function MessageContent({ text }: { text: string }) {
  return (
    <div className="message-content">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        skipHtml
        urlTransform={safeHttpUrl}
        components={{
          a: ({ href, children }) => {
            const safeHref = href ? safeHttpUrl(href) : '';
            return safeHref
              ? <a href={safeHref} target="_blank" rel="noreferrer noopener">{children}</a>
              : <span>{children}</span>;
          },
          img: ({ alt }) => <span className="blocked-image">Image: {alt || 'attachment'}</span>,
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ children }) => <div className="table-scroll"><table>{children}</table></div>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
