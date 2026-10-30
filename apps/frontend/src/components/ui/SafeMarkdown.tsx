import ReactMarkdown from 'react-markdown';
import DOMPurify from 'dompurify';

/** The bits of a hast tree rehypeUnderline touches. */
type HastNode = { type: string; value?: string; tagName?: string; properties?: object; children?: HastNode[] };

const U_OPEN = /^<u>$/i;
const U_CLOSE = /^<\/u>$/i;

/**
 * The editor (MarkdownEditor) stores underline as `<u>…</u>`, since markdown has none. react-markdown shows
 * raw HTML as text, so this turns a `<u>` … `</u>` pair within one paragraph into a real <u>. Any other raw
 * HTML stays text, as before; an unpaired tag too.
 */
export function rehypeUnderline() {
  const walk = (parent: HastNode) => {
    if (!parent.children) return;
    const out: HastNode[] = [];
    let open: HastNode[] | null = null;
    for (const child of parent.children) {
      const raw = child.type === 'raw' ? (child.value ?? '').trim() : null;
      if (raw !== null && open === null && U_OPEN.test(raw)) {
        open = [];
      } else if (raw !== null && open !== null && U_CLOSE.test(raw)) {
        out.push({ type: 'element', tagName: 'u', properties: {}, children: open });
        open = null;
      } else {
        walk(child);
        (open ?? out).push(child);
      }
    }
    if (open !== null) out.push({ type: 'raw', value: '<u>' }, ...open);
    parent.children = out;
  };
  return (tree: HastNode) => walk(tree);
}

// Sanitize markdown HTML output via DOMPurify
export function SafeMarkdown({ children }: { children: string }) {
  const clean = DOMPurify.sanitize(children);
  return (
    <ReactMarkdown
      rehypePlugins={[rehypeUnderline]}
      components={{
        // Override to use sanitized content
        p: ({ children: c }) => <p className="mb-3">{c}</p>,
        h2: ({ children: c }) => (
          <h2 className="font-display text-xl font-semibold mt-5 mb-2 text-rizzotto-gold-500">{c}</h2>
        ),
        ul: ({ children: c }) => <ul className="list-disc pl-5 mb-3 space-y-1">{c}</ul>,
        ol: ({ children: c }) => <ol className="list-decimal pl-5 mb-3 space-y-1">{c}</ol>,
        code: ({ children: c }) => (
          <code className="rounded bg-stone-800 px-1 py-0.5 text-sm font-mono">{c}</code>
        ),
        blockquote: ({ children: c }) => (
          <blockquote className="border-l-[3px] border-rizzotto-gold-500 pl-3 my-2 italic text-rizzotto-stone-300">{c}</blockquote>
        ),
        a: ({ children: c, href }) => (
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-rizzotto-gold-400 underline hover:text-rizzotto-gold-300">{c}</a>
        ),
      }}
    >
      {clean}
    </ReactMarkdown>
  );
}
