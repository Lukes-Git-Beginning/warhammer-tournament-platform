import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SafeMarkdown } from './SafeMarkdown';

const html = (md: string) => renderToStaticMarkup(<SafeMarkdown>{md}</SafeMarkdown>);

describe('SafeMarkdown underline', () => {
  it("renders the editor's <u> pair as underline, with other formatting inside", () => {
    expect(html('Read <u>the **rules** first</u>, please.')).toContain(
      '<u>the <strong>rules</strong> first</u>, please.',
    );
  });

  it('handles several pairs in one paragraph and inside a list', () => {
    expect(html('- <u>one</u> and <u>two</u>')).toContain('<li><u>one</u> and <u>two</u></li>');
  });

  it('keeps other HTML, and a pair split over two paragraphs, as text', () => {
    expect(html('a <b>bold</b> b')).toContain('a &lt;b&gt;bold&lt;/b&gt; b');
    const split = html(['<u>one', '', 'two</u>'].join('\n'));
    expect(split).toContain('&lt;u&gt;one');
    expect(split).toContain('two&lt;/u&gt;');
  });
});
