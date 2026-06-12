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

  it('rendert korrekte Größe sm (30px)', () => {
    const html = renderToStaticMarkup(
      <FactionBadge colorHex="#333" initials="VC" name="Vampire Counts" size="sm" />,
    );
    expect(html).toContain('30');
  });

  it('rendert korrekte Größe lg (60px)', () => {
    const html = renderToStaticMarkup(
      <FactionBadge colorHex="#333" initials="VC" name="Vampire Counts" size="lg" />,
    );
    expect(html).toContain('60');
  });

  it('renders img with src when iconUrl is a path', () => {
    const html = renderToStaticMarkup(
      <FactionBadge colorHex="#c41e3a" initials="EG" name="Empire" iconUrl="/icons/factions/empire.png" />,
    );
    expect(html).toContain('<img');
    expect(html).toContain('src="/icons/factions/empire.png"');
    expect(html).not.toContain('EG');
  });

  it('renders initials fallback when iconUrl is null', () => {
    const html = renderToStaticMarkup(
      <FactionBadge colorHex="#c41e3a" initials="EG" name="Empire" iconUrl={null} />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('EG');
  });

  it('renders initials fallback when iconUrl is empty string', () => {
    const html = renderToStaticMarkup(
      <FactionBadge colorHex="#c41e3a" initials="EG" name="Empire" iconUrl="" />,
    );
    expect(html).not.toContain('<img');
    expect(html).toContain('EG');
  });
});
