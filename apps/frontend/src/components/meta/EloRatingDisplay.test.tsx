import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EloRatingDisplay } from './EloRatingDisplay';

describe('EloRatingDisplay', () => {
  it('zeigt nur Rating wenn kein delta übergeben', () => {
    const html = renderToStaticMarkup(<EloRatingDisplay rating={1234} />);
    expect(html).toContain('1234');
    expect(html).not.toContain('▲');
    expect(html).not.toContain('▼');
  });

  it('zeigt positives delta in grün (emerald)', () => {
    const html = renderToStaticMarkup(<EloRatingDisplay rating={1250} delta={16} />);
    expect(html).toContain('+16');
    expect(html).toContain('emerald');
    expect(html).toContain('▲');
  });

  it('zeigt negatives delta in rot', () => {
    const html = renderToStaticMarkup(<EloRatingDisplay rating={1230} delta={-8} />);
    expect(html).toContain('-8');
    expect(html).toContain('red');
    expect(html).toContain('▼');
  });

  it('zeigt delta=0 als neutral', () => {
    const html = renderToStaticMarkup(<EloRatingDisplay rating={1200} delta={0} />);
    expect(html).toContain('—');
    expect(html).toContain('stone');
  });
});
