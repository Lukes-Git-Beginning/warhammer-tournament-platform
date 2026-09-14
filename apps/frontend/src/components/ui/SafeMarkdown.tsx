import ReactMarkdown from 'react-markdown';
import DOMPurify from 'dompurify';

// Sanitize markdown HTML output via DOMPurify
export function SafeMarkdown({ children }: { children: string }) {
  const clean = DOMPurify.sanitize(children);
  return (
    <ReactMarkdown
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
