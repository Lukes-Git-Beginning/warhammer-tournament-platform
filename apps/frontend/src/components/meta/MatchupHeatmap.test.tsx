import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MatchupHeatmap } from './MatchupHeatmap';
import type { FactionDto, MatchupCell } from '@tww3/types';

function makeFaction(id: string, order: number): FactionDto {
  return {
    id,
    name: `Faction ${id}`,
    race: 'TestRace',
    category: 'Grand Alliance',
    color_hex: '#c41e3a',
    display_order: order,
    icon_url: null,
    initials: id.slice(0, 2).toUpperCase(),
  };
}

describe('MatchupHeatmap', () => {
  it('rendert Tabelle mit Header-Row und Daten-Rows (smoke)', () => {
    const factions: FactionDto[] = [
      makeFaction('aa', 1),
      makeFaction('bb', 2),
      makeFaction('cc', 3),
    ];
    const cells: MatchupCell[] = [
      {
        faction_a_id: 'aa',
        faction_b_id: 'bb',
        faction_a_wins: 3,
        faction_b_wins: 1,
        draws: 0,
        total: 4,
        winrate_a: 0.75,
      },
    ];

    const html = renderToStaticMarkup(<MatchupHeatmap cells={cells} factions={factions} />);
    // Should render a table
    expect(html).toContain('<table');
    // Diagonal placeholder
    expect(html).toContain('—');
    // At least one colored cell title
    expect(html).toContain('Faction aa vs Faction bb');
  });

  it('rendert N×N Zellen für N Fraktionen', () => {
    const N = 4;
    const factions = Array.from({ length: N }, (_, i) =>
      makeFaction(String(i + 1).padStart(2, 'x'), i + 1),
    );
    const cells: MatchupCell[] = [];

    const html = renderToStaticMarkup(<MatchupHeatmap cells={cells} factions={factions} />);
    // Diagonal cells show "—", so we check for N diagonal markers
    const diagCount = (html.match(/—/g) ?? []).length;
    expect(diagCount).toBe(N);
  });
});
