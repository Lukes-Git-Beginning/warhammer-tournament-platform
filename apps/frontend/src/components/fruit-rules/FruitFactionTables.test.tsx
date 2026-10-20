import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FactionSection, Highlight } from './FruitFactionTables';
import type { FactionView, FruitRow } from '@/lib/fruit-rules';

function row(over: Partial<FruitRow>): FruitRow {
  return {
    key: 'k',
    name: 'Unit',
    mount: null,
    mountUnnamed: false,
    limit: 3,
    gameCapStricter: false,
    fruitCap: 3,
    shared: [],
    categories: [],
    abilities: [],
    basis: 'Faction page',
    searchText: '',
    ...over,
  };
}

const view: FactionView = {
  faction: {
    id: 'empire',
    name: 'The Empire',
    iconUrl: '/icons/factions/empire.png',
    units: [],
    characters: [],
  },
  units: [
    row({ key: 'a', name: 'Steam Tank', limit: 1, fruitCap: 2, gameCapStricter: true }),
    row({ key: 'b', name: 'Bad Unit', limit: 0, basis: 'Banned' }),
  ],
  characters: [
    row({
      key: 'c',
      name: 'General',
      mount: 'Imperial Griffon',
      limit: null,
      shared: ['Griffon mounts (2)'],
    }),
    row({ key: 'd', name: 'General', mountUnnamed: true, limit: null }),
  ],
  matches: 0,
};

const render = (open: boolean) =>
  renderToStaticMarkup(
    <FactionSection view={view} open={open} searching={false} tokens={[]} onToggle={() => {}} />,
  );

describe('FactionSection', () => {
  it('shows only the header while closed', () => {
    const html = render(false);
    expect(html).toContain('id="faction-empire"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('2 units · 2 characters');
    expect(html).not.toContain('Steam Tank');
  });

  it('marks the game cap, bans and characters without a mount name when open', () => {
    const html = render(true);
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('game cap (Fruit: 2)');
    expect(html).toContain('Banned');
    expect(html).toContain('Griffon mounts (2)');
    expect(html).toContain('unnamed mount');
    expect(html).not.toContain('{{tr:');
    expect(html).toContain('href="#faction-empire"');
  });
});

describe('Highlight', () => {
  it('marks every search word, case-insensitive', () => {
    const html = renderToStaticMarkup(
      <Highlight text="Steam Tank (Steam)" tokens={['steam', 'tank']} />,
    );
    expect(html.match(/<mark/g)).toHaveLength(3);
    expect(html).toContain('>Steam</mark>');
  });

  it('leaves the text alone without a match', () => {
    expect(renderToStaticMarkup(<Highlight text="Spearmen" tokens={['zz']} />)).toBe('Spearmen');
  });
});
