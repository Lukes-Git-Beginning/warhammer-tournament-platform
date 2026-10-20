import { describe, it, expect } from 'vitest';
import limitsJson from '@/content/fruit-rules/fruit_rules_limits.json?raw';
import interpretation from '@/content/fruit-rules/fruit_rules_interpretation.md?raw';
import {
  KNOWN_LIMIT_KINDS,
  buildFactions,
  filterFactions,
  fruitRulesSchema,
  normalizeSearch,
  parseFruitRules,
  searchTokens,
  splitFruitRulesDoc,
  type FruitRulesData,
} from './fruit-rules';

// Guards the generated file: when a new fruit_rules_limits.json from the mod build is copied
// in, these fail on a shape the page can't show instead of the page failing for players.
describe('committed Fruit Rules data', () => {
  const data = fruitRulesSchema.parse(JSON.parse(limitsJson));

  it('parses, with every limit kind known and every limit reference resolvable', () => {
    expect(data.factions.length).toBeGreaterThan(0);
    for (const faction of data.factions) {
      const ids = new Set(faction.limits.map((l) => l.id));
      for (const limit of faction.limits) {
        expect(KNOWN_LIMIT_KINDS, `${faction.name}: ${limit.name}`).toContain(limit.kind);
      }
      for (const unit of faction.units) {
        for (const id of unit.limits)
          expect(ids.has(id), `${faction.name}: ${unit.name}`).toBe(true);
      }
    }
  });

  it('gives every faction a sigil and every category a short tag', () => {
    const factions = parseFruitRules(JSON.parse(limitsJson));
    for (const f of factions)
      expect(f.iconUrl, f.name).toMatch(/^\/icons\/factions\/[a-z_]+\.png$/);
    const tags = new Set(
      factions
        .flatMap((f) => [...f.units, ...f.characters])
        .flatMap((r) => r.categories.map((c) => c.tag)),
    );
    expect([...tags].sort()).toEqual(
      ['360°', 'Breath', 'Chariot', 'Flying ranged', 'RSE', 'Ranged cav', 'SE'].sort(),
    );
  });

  it('classifies every fixed ability from the ability lists', () => {
    const rows = parseFruitRules(JSON.parse(limitsJson)).flatMap((f) => [
      ...f.units,
      ...f.characters,
    ]);
    const kinds = new Set(rows.flatMap((r) => r.abilities.map((a) => a.kind)));
    expect(kinds.has('net/rampage')).toBe(false);
  });
});

const fixture: FruitRulesData = {
  categories: [
    { id: 'se', cap: 4, name: 'Single entities' },
    { id: 'rse', cap: 3, name: 'Rare single entities' },
  ],
  factions: [
    {
      subculture: 'wh_main_sc_emp_empire',
      name: 'The Empire',
      limits: [
        { id: 1, kind: 'cat', cap: 4, name: 'Single entities' },
        { id: 2, kind: 'own', cap: 2, name: 'Steam Tank' },
        { id: 3, kind: 'grp', cap: 5, name: 'Spearmen / Spearmen (Shields)' },
        { id: 4, kind: 'mount', cap: 2, name: 'Griffon mounts' },
        { id: 5, kind: 'own', cap: 1, name: 'Royal Altdorf Gryphites (Demigryph Knights)' },
        { id: 6, kind: 'own', cap: 3, name: 'Demigryph Knights' },
        { id: 7, kind: 'ban', cap: 0, name: 'Banned' },
        { id: 8, kind: 'cat', cap: 3, name: 'Rare single entities' },
      ],
      units: [
        unit({ key: 'spear', name: 'Spearmen (Shields)', limits: [3], effective_cap: 5 }),
        unit({
          key: 'ror',
          name: 'Royal Altdorf Gryphites (Demigryph Knights)',
          limits: [5, 6],
          effective_cap: 1,
          innate: { drains: null, nets_or_rampages: 'Net of Amyntok' },
        }),
        unit({
          key: 'tank',
          name: 'Steam Tank',
          limits: [1, 2, 8],
          fruit_cap: 2,
          official_cap: 1,
          effective_cap: 1,
          official_stricter: true,
        }),
        unit({ key: 'banned', name: 'Bad Unit', limits: [7], effective_cap: 0 }),
        unit({
          key: 'gen1',
          name: 'General ',
          character: true,
          mount: 'Imperial Griffon ',
          limits: [1, 4],
        }),
        // Same visible data as gen1 (e.g. another weapon set): dropped as a duplicate.
        unit({
          key: 'gen2',
          name: 'General',
          character: true,
          mount: 'Imperial Griffon',
          limits: [1, 4],
        }),
        unit({
          key: 'gen3',
          name: 'General',
          character: true,
          mount: '{{tr:units_custom_battle_mounts_mount_name_x}}',
          limits: [1, 2],
        }),
        unit({
          key: 'drainer',
          name: 'Plague Priest',
          character: true,
          limits: [1],
          innate: { drains: 'Aura of Madness', nets_or_rampages: 'Kill for Khorne!' },
        }),
      ],
    },
  ],
  abilities: {
    drains: [{ name: 'Aura of Madness', targetable: false }],
    nets: [{ name: 'Net of Amyntok', targetable: true }],
    rampages: [{ name: 'Kill for Khorne!', targetable: false }],
  },
};

function unit(over: Partial<FruitRulesData['factions'][number]['units'][number]>) {
  return {
    key: 'k',
    name: 'Unit',
    character: false,
    mount: null,
    limits: [],
    fruit_cap: null,
    official_cap: null,
    effective_cap: null,
    official_stricter: false,
    basis: 'Faction page',
    ...over,
  };
}

describe('buildFactions', () => {
  const [empire] = buildFactions(fixture);

  it('splits units from characters and maps the faction sigil', () => {
    expect(empire!.id).toBe('empire');
    expect(empire!.iconUrl).toBe('/icons/factions/empire.png');
    expect(empire!.units.map((r) => r.key)).toEqual(['spear', 'ror', 'tank', 'banned']);
    expect(empire!.characters.map((r) => r.key)).toEqual(['gen1', 'gen3', 'drainer']);
  });

  it('lists shared limits, "counts toward" only for another unit\'s own limit', () => {
    const [spear, ror, tank, banned] = empire!.units;
    expect(spear!.shared).toEqual(['Spearmen / Spearmen (Shields) (5)']);
    expect(ror!.shared).toEqual(['Counts toward Demigryph Knights (3)']);
    expect(tank!.shared).toEqual([]);
    expect(banned!.shared).toEqual([]);
    expect(banned!.limit).toBe(0);
  });

  it('turns category limits into short tags and keeps the game-cap mark', () => {
    const tank = empire!.units[2]!;
    expect(tank.categories).toEqual([
      { tag: 'SE', title: 'Single entities (max 4 per army)' },
      { tag: 'RSE', title: 'Rare single entities (max 3 per army)' },
    ]);
    expect(tank.limit).toBe(1);
    expect(tank.gameCapStricter).toBe(true);
    expect(tank.fruitCap).toBe(2);
  });

  it('lists what a character counts toward without a prefix, trims names', () => {
    const [griffon, unnamed] = empire!.characters;
    expect(griffon!.name).toBe('General');
    expect(griffon!.mount).toBe('Imperial Griffon');
    expect(griffon!.shared).toEqual(['Griffon mounts (2)']);
    expect(unnamed!.shared).toEqual(['Steam Tank (2)']);
  });

  it('never shows an unresolved game text key as a mount name', () => {
    const unnamed = empire!.characters[1]!;
    expect(unnamed.mount).toBeNull();
    expect(unnamed.mountUnnamed).toBe(true);
  });

  it('classifies fixed abilities as drain, net or rampage', () => {
    expect(empire!.units[1]!.abilities).toEqual([
      { name: 'Net of Amyntok', kind: 'net', targetable: true },
    ]);
    expect(empire!.characters[2]!.abilities).toEqual([
      { name: 'Aura of Madness', kind: 'drain', targetable: false },
      { name: 'Kill for Khorne!', kind: 'rampage', targetable: false },
    ]);
  });
});

describe('search', () => {
  const factions = buildFactions(fixture);

  it('ignores case, accents and apostrophes; needs 2 characters', () => {
    expect(normalizeSearch("  Ku'gath  Plaguefather ")).toBe('kugath plaguefather');
    expect(normalizeSearch('Kroq-Gár')).toBe('kroq-gar');
    expect(searchTokens('a')).toEqual([]);
    expect(searchTokens('Steam  tank')).toEqual(['steam', 'tank']);
  });

  it('matches every word against name and mount, keeping only factions with hits', () => {
    expect(
      filterFactions(factions, searchTokens('griffon general'))[0]!.characters.map((r) => r.key),
    ).toEqual(['gen1']);
    const tank = filterFactions(factions, searchTokens('steam'));
    expect(tank[0]!.units.map((r) => r.key)).toEqual(['tank']);
    expect(tank[0]!.matches).toBe(1);
    expect(filterFactions(factions, searchTokens('zzz'))).toEqual([]);
    expect(filterFactions(factions, [])[0]!.units).toHaveLength(4);
  });
});

describe('splitFruitRulesDoc', () => {
  it('puts the faction tables right after the section that introduces them', () => {
    const doc = splitFruitRulesDoc(interpretation);
    expect(doc.intro).toMatch(/^# Fruit Rules/);
    expect(doc.toc[0]!.id).toBe('1-where-the-rules-apply');
    const tables = doc.toc.findIndex((h) => /faction tables/i.test(h.text));
    expect(tables).toBeGreaterThan(-1);
    expect(doc.body).toContain(`## ${doc.toc[tables]!.text}`);
    expect(doc.after).not.toContain(`## ${doc.toc[tables]!.text}`);
  });

  it('keeps sections after the tables section apart, and falls back to the end without one', () => {
    const md = '# T\n\nIntro\n\n## 1. A\n\nx\n\n## 2. Faction tables\n\ny\n\n## 3. Later\n\nz\n';
    const doc = splitFruitRulesDoc(md);
    expect(doc.intro.trim()).toBe('# T\n\nIntro');
    expect(doc.body).toContain('## 2. Faction tables');
    expect(doc.after.trim()).toBe('## 3. Later\n\nz');
    expect(doc.toc.map((h) => h.id)).toEqual(['1-a', '2-faction-tables', '3-later']);

    const none = splitFruitRulesDoc('# T\n\n## 1. A\n\nx\n');
    expect(none.after).toBe('');
    expect(none.body).toContain('## 1. A');
  });
});
