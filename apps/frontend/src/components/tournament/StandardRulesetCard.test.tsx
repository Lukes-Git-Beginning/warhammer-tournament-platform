import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StandardRulesetCard } from './StandardRulesetCard';
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
