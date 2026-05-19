import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('rendert title und body in jeder Variante', () => {
    for (const variant of ['banner', 'sigil', 'compact'] as const) {
      const html = renderToStaticMarkup(
        <EmptyState variant={variant} title="Titel-X" body="Body-Y" />,
      );
      expect(html).toContain('Titel-X');
      expect(html).toContain('Body-Y');
    }
  });

  it('rendert motto nur wenn gesetzt (banner/sigil)', () => {
    const without = renderToStaticMarkup(
      <EmptyState variant="sigil" title="T" body="B" />,
    );
    expect(without).not.toContain('lang="la"');

    const withMotto = renderToStaticMarkup(
      <EmptyState variant="sigil" title="T" body="B" motto="Honor Vacat" mottoTitle="empty" />,
    );
    expect(withMotto).toContain('lang="la"');
    expect(withMotto).toContain('Honor Vacat');
    expect(withMotto).toContain('title="empty"');
  });

  it('compact rendert weder motto noch cta', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        variant="compact"
        title="T"
        body="B"
        motto="Should-Not-Appear"
        cta={<button>Should-Not-Appear-Either</button>}
      />,
    );
    expect(html).not.toContain('Should-Not-Appear');
    expect(html).not.toContain('Should-Not-Appear-Either');
    expect(html).not.toContain('lang="la"');
  });

  it('variant=banner mit image rendert <picture>, ohne image rendert RizzottoSigil', () => {
    const withImg = renderToStaticMarkup(
      <EmptyState
        variant="banner"
        title="T"
        body="B"
        image={{ src: '/img/test', width: 100, height: 75 }}
      />,
    );
    expect(withImg).toContain('<picture');
    expect(withImg).toContain('/img/test.avif');

    const withoutImg = renderToStaticMarkup(
      <EmptyState variant="banner" title="T" body="B" />,
    );
    expect(withoutImg).not.toContain('<picture');
    expect(withoutImg).toContain('/img/rizzotto-sigil.png');
  });

  it('setzt data-testid passend zur Variante', () => {
    expect(
      renderToStaticMarkup(<EmptyState variant="banner" title="T" body="B" />),
    ).toContain('data-testid="empty-state-banner"');
    expect(
      renderToStaticMarkup(<EmptyState variant="sigil" title="T" body="B" />),
    ).toContain('data-testid="empty-state-sigil"');
    expect(
      renderToStaticMarkup(<EmptyState variant="compact" title="T" body="B" />),
    ).toContain('data-testid="empty-state-compact"');
  });

  it('rendert cta nur wenn gesetzt (banner/sigil)', () => {
    const html = renderToStaticMarkup(
      <EmptyState
        variant="sigil"
        title="T"
        body="B"
        cta={<button>Schmieden</button>}
      />,
    );
    expect(html).toContain('Schmieden');
  });
});
