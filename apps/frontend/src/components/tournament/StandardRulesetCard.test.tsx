import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { modEnforces, splitShared, StandardRulesetCard } from './StandardRulesetCard';
import type { BattleType, StandardRuleset } from '@/lib/api.js';

// The card skips its fetch when an explicit ruleset is passed; stub react-query anyway.
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));
// No router in a static render: a plain anchor stands in for <Link>.
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => <a href={to}>{children}</a>,
}));

const base: StandardRuleset = {
  settings: ['1500 Tickets'],
  banned_factions: ['undead_legions'],
  banned: ['Dreadmaw'],
  banned_abilities: ['Masque of Slaanesh'],
  conduct: ['40 minute round limit'],
};

const render = (rs: StandardRuleset, battleType?: BattleType) =>
  renderToStaticMarkup(<StandardRulesetCard ruleset={rs} battleType={battleType} />);

describe('StandardRulesetCard — only what players watch themselves', () => {
  it('shows the arena-mode duty and the conduct, not the settings or bans the mod enforces', () => {
    const html = render(base);
    expect(html).toContain('arena mode');
    expect(html).toContain('40 minute round limit');
    expect(html).not.toContain('1500 Tickets');
    expect(html).not.toContain('Dreadmaw');
    expect(html).not.toContain('Masque of Slaanesh');
    expect(html).not.toContain('Banned');
  });

  it('links to How to Play', () => {
    expect(render(base)).toContain('href="/how-to-play"');
  });

  it('names the Fruit Rules as enforced only for Land Battle, Conquest and Siege', () => {
    for (const bt of ['LAND_BATTLE', 'CONQUEST', 'SIEGE'] as const) expect(render(base, bt)).toContain('Fruit Rules');
    for (const bt of ['DOMINATION', 'DOMQUEST'] as const) expect(render(base, bt)).not.toContain('Fruit Rules');
  });
});

describe('splitShared — shared rules once, extras per battle type', () => {
  const common = ['10 minutes to ready up', 'No exploits'];

  it('keeps what every type has as shared and lists only the differences per type', () => {
    const { shared, extra } = splitShared([
      { battleType: 'DOMINATION', items: [...common, '40 minute round limit'] },
      { battleType: 'LAND_BATTLE', items: [...common, '40 minute round limit', 'Attack at all times'] },
      { battleType: 'SIEGE', items: [...common, '30 minute round limit'] },
    ]);
    expect(shared).toEqual(common);
    expect(extra).toEqual([
      { battleType: 'DOMINATION', items: ['40 minute round limit'] },
      { battleType: 'LAND_BATTLE', items: ['40 minute round limit', 'Attack at all times'] },
      { battleType: 'SIEGE', items: ['30 minute round limit'] },
    ]);
  });

  it('leaves out types that add nothing, and a single type is all shared', () => {
    const two = splitShared([
      { battleType: 'DOMINATION', items: [...common, '40 minute round limit'] },
      { battleType: 'LAND_BATTLE', items: [...common, '40 minute round limit', 'Attack at all times'] },
    ]);
    expect(two.shared).toEqual([...common, '40 minute round limit']);
    expect(two.extra).toEqual([{ battleType: 'LAND_BATTLE', items: ['Attack at all times'] }]);
    expect(splitShared([{ battleType: 'SIEGE', items: common }])).toEqual({ shared: common, extra: [] });
  });
});

describe('modEnforces — the Fruit Rules only where they apply', () => {
  it('names the Fruit Rules for all, none or some of the selected types', () => {
    expect(modEnforces(['CONQUEST', 'SIEGE'])).toBe('the lobby settings, the bans and the Fruit Rules in the arena modes');
    expect(modEnforces(['DOMINATION', 'DOMQUEST'])).toBe('the lobby settings and the bans in the arena modes');
    expect(modEnforces(['DOMINATION', 'LAND_BATTLE', 'CONQUEST', 'SIEGE'])).toBe(
      'the lobby settings and the bans in the arena modes, plus the Fruit Rules in Land Battle, Conquest and Siege',
    );
  });
});
