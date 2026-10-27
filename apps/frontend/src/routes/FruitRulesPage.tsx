import { isValidElement, useEffect, useMemo, type ReactNode } from 'react';
import { useRouterState } from '@tanstack/react-router';
import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import fruitRulesText from '@/content/fruit-rules/fruit_rules_interpretation.md?raw';
import { PageShell } from '@/components/layout/PageShell';
import { FruitFactionTables, scrollToAnchor } from '@/components/fruit-rules/FruitFactionTables';
import { slugify, splitFruitRulesDoc } from '@/lib/fruit-rules';
import { cn } from '@/lib/utils';

// Public since the release of RizzOtto's Arena Mod: header tab "Fruit Rules", in the sitemap and open to
// search engines. The text and the faction data come from the mod repo (docs/fruit_rules); the mod enforces
// the rules itself, this page shows how we read them and every limit for planning.

function nodeText(node: ReactNode): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}

function SectionHeading({
  as: Tag,
  className,
  children,
}: {
  as: 'h2' | 'h3';
  className: string;
  children: ReactNode;
}) {
  const id = slugify(nodeText(children));
  return (
    <Tag id={id} className={cn('group scroll-mt-28 font-display', className)}>
      {children}
      <a
        href={`#${id}`}
        aria-label="Link to this section"
        className="ml-2 font-sans text-rizzotto-stone-500 opacity-0 transition-opacity hover:text-rizzotto-gold-400 focus-visible:opacity-100 group-hover:opacity-100"
      >
        #
      </a>
    </Tag>
  );
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="font-display text-2xl font-bold leading-tight text-rizzotto-gold-500 sm:text-4xl">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <SectionHeading
      as="h2"
      className="mb-4 mt-12 border-t border-rizzotto-iron-700 pt-8 text-2xl text-rizzotto-gold-400"
    >
      {children}
    </SectionHeading>
  ),
  h3: ({ children }) => (
    <SectionHeading as="h3" className="mb-2 mt-7 text-lg text-rizzotto-stone-100">
      {children}
    </SectionHeading>
  ),
  p: ({ children }) => <p className="my-3 leading-relaxed text-rizzotto-stone-300">{children}</p>,
  ul: ({ children }) => (
    <ul className="my-3 list-disc space-y-1.5 pl-5 leading-relaxed text-rizzotto-stone-300 marker:text-rizzotto-gold-600">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-3 list-decimal space-y-2 pl-5 leading-relaxed text-rizzotto-stone-300 marker:text-rizzotto-gold-600">
      {children}
    </ol>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-rizzotto-stone-100">{children}</strong>
  ),
  a: ({ children, href }) => {
    const external = /^https?:\/\//.test(href ?? '');
    return (
      <a
        href={href}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="text-rizzotto-gold-400 underline decoration-rizzotto-gold-600/60 underline-offset-2 [overflow-wrap:anywhere] hover:text-rizzotto-gold-300"
      >
        {children}
      </a>
    );
  },
  table: ({ children }) => (
    <div className="my-4 overflow-x-auto rounded-md border border-rizzotto-iron-700">
      <table className="w-full text-left text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="bg-rizzotto-iron-900/80 text-xs uppercase tracking-wide text-rizzotto-stone-400">
      {children}
    </thead>
  ),
  th: ({ children }) => <th className="px-3 py-2 font-medium">{children}</th>,
  td: ({ children }) => (
    <td className="border-t border-rizzotto-iron-700/70 px-3 py-2 align-top text-rizzotto-stone-300">
      {children}
    </td>
  ),
};

function Prose({ children }: { children: string }) {
  if (!children.trim()) return null;
  return (
    <Markdown remarkPlugins={[remarkGfm]} components={components}>
      {children}
    </Markdown>
  );
}

function usePageMeta() {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "Fruit Rules — RizzOtto's Arena";
    return () => {
      document.title = previousTitle;
    };
  }, []);
}

export function FruitRulesPage() {
  usePageMeta();
  const doc = useMemo(() => splitFruitRulesDoc(fruitRulesText), []);

  // Section links (#9-where-the-mod-differs-from-the-pdf): the text renders after the browser's
  // own jump to the anchor, so scroll once it is there.
  const hash = useRouterState({ select: (s) => s.location.hash });
  useEffect(() => {
    const id = hash.replace(/^#/, '');
    if (id && !id.startsWith('faction-')) scrollToAnchor(id);
  }, [hash]);

  return (
    <PageShell variant="wide">
      <article className="max-w-3xl">
        <Prose>{doc.intro}</Prose>
        {doc.toc.length > 0 && (
          <nav
            aria-label="Contents"
            className="mt-8 rounded-md border border-rizzotto-iron-700 bg-rizzotto-iron-900/60 p-4 sm:p-5"
          >
            <p className="mb-3 font-display text-sm uppercase tracking-wider text-rizzotto-stone-400">
              Contents
            </p>
            <ul className="gap-x-8 space-y-1.5 text-sm sm:columns-2">
              {doc.toc.map((h) => (
                <li key={h.id} className="break-inside-avoid">
                  <a
                    href={`#${h.id}`}
                    className="text-rizzotto-stone-200 hover:text-rizzotto-gold-400"
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <Prose>{doc.body}</Prose>
      </article>
      <div className="mt-6">
        <FruitFactionTables />
      </div>
      <article className="max-w-3xl">
        <Prose>{doc.after}</Prose>
      </article>
    </PageShell>
  );
}
