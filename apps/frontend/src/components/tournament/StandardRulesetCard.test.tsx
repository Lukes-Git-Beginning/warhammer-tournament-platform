import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { StandardRulesetCard } from './StandardRulesetCard';
import type { StandardRuleset } from '@/lib/api.js';

// The card skips its fetch when an explicit ruleset is passed; stub react-query anyway.
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: undefined }) }));

const base: StandardRuleset = {
  settings: ['1500 Tickets'],
  banned_factions: [],
  banned: [],
  banned_abilities: [],
  conduct: ['40 minute round limit'],
};

const render = (rs: StandardRuleset) => renderToStaticMarkup(<StandardRulesetCard ruleset={rs} />);

describe('StandardRulesetCard — ban categories', () => {
  it('hides every ban category when nothing is banned', () => {
    const html = render(base);
    expect(html).not.toContain('Banned');
    expect(html).toContain('Settings');
    expect(html).toContain('Conduct');
  });

  it('shows only the categories that have entries, in order Factions → Units → Spells/Items/Abilities', () => {
    const html = render({
      ...base,
      banned_factions: ['Kislev'],
      banned: ['Dreadmaw'],
      banned_abilities: ['Masque of Slaanesh'],
    });
    const f = html.indexOf('Banned Factions');
    const u = html.indexOf('Banned Units');
    const a = html.indexOf('Banned Spells / Items / Abilities');
    expect(f).toBeGreaterThan(-1);
    expect(u).toBeGreaterThan(f);
    expect(a).toBeGreaterThan(u);
    expect(html).toContain('Kislev');
  });

  it('shows just Banned Units for a ruleset saved before the new categories existed', () => {
    const legacy = { settings: ['x'], banned: ['Dreadmaw'], conduct: ['y'] } as StandardRuleset;
    const html = render(legacy);
    expect(html).toContain('Banned Units');
    expect(html).not.toContain('Banned Factions');
    expect(html).not.toContain('Banned Spells');
  });
});
