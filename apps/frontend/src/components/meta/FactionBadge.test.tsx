import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FactionBadge } from './FactionBadge';

describe('FactionBadge', () => {
  it('rendert Initialen korrekt', () => {
    const html = renderToStaticMarkup(
      <FactionBadge colorHex="#c41e3a" initials="EG" name="Empire of Greenskins" />,
    );
    expect(html).toContain('EG');
  });

  it('setzt title-Attribut auf faction name', () => {
    const html = renderToStaticMarkup(
      <FactionBadge colorHex="#1a6b3a" initials="SK" name="Skaven" />,
    );
    expect(html).toContain('title="Skaven"');
  });

  it('rendert korrekte Größe sm (24px)', () => {
    const html = renderToStaticMarkup(
      <FactionBadge colorHex="#333" initials="VC" name="Vampire Counts" size="sm" />,
    );
    // inline style should contain width: 24
    expect(html).toContain('24');
  });

  it('rendert korrekte Größe lg (48px)', () => {
    const html = renderToStaticMarkup(
      <FactionBadge colorHex="#333" initials="VC" name="Vampire Counts" size="lg" />,
    );
    expect(html).toContain('48');
  });
});
