import { describe, it, expect } from 'vitest';
import { verifyReplayMeta, type ExpectedGame } from '../src/lib/replay-verify.js';
import type { ReplayPlayer } from '../src/lib/replay-parser.js';

const base: ExpectedGame = {
  factionSlugs: ['kislev', 'skaven'],
  mapName: 'Jade Tomb',
  matchCreatedAt: new Date('2026-08-01T20:00:00Z'),
  steamPersonaNames: ['pan_sarin', 'Martinius | RTK'],
};
const meta = (o: Partial<{
  factions: string[]; mapTerrain: string | null; recordedAt: Date | null; players: ReplayPlayer[];
}>) => ({
  factions: o.factions ?? ['kislev', 'skaven'],
  mapTerrain: o.mapTerrain ?? 'test_domination_jade_tomb',
  recordedAt: o.recordedAt ?? new Date('2026-08-01T21:00:00Z'),
  players: o.players ?? [{ name: 'pan_sarin', faction: 'kislev' }, { name: 'Martinius | RTK', faction: 'skaven' }],
});

describe('verifyReplayMeta', () => {
  it('passes when factions, map, time and names all match', () => {
    const r = verifyReplayMeta(meta({}), base);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('flags a faction mismatch (right game, wrong reported factions)', () => {
    const r = verifyReplayMeta(meta({ factions: ['greenskins', 'norsca'] }), base);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.type)).toContain('FACTIONS');
  });

  it('suppresses a faction diff confined to the Chaos-god family (unreliable)', () => {
    const chaosBase = { ...base, factionSlugs: ['nurgle', 'daemons_of_chaos'] };
    const r = verifyReplayMeta(meta({ factions: ['daemons_of_chaos', 'tzeentch'] }), chaosBase);
    expect(r.issues.map((i) => i.type)).not.toContain('FACTIONS');
  });

  it('still flags when a clean faction is part of the diff, even alongside a chaos-god', () => {
    const b2 = { ...base, factionSlugs: ['dark_elves', 'warriors_of_chaos'] };
    const r = verifyReplayMeta(meta({ factions: ['empire', 'warriors_of_chaos'] }), b2);
    expect(r.issues.map((i) => i.type)).toContain('FACTIONS');
  });

  it('flags a map mismatch', () => {
    const r = verifyReplayMeta(meta({ mapTerrain: 'test_domination_hasuts_dom' }), base);
    expect(r.issues.map((i) => i.type)).toContain('MAP');
  });

  it('flags a recycled replay (recorded before the match was created)', () => {
    const r = verifyReplayMeta(meta({ recordedAt: new Date('2026-07-10T10:00:00Z') }), base);
    expect(r.issues.map((i) => i.type)).toContain('RECORDED_TIME');
  });

  it('flags PLAYER only for an entirely foreign replay (neither participant recorded)', () => {
    const r = verifyReplayMeta(meta({ players: [{ name: 'someone_else', faction: null }, { name: 'another_guy', faction: null }] }), base);
    const player = r.issues.filter((i) => i.type === 'PLAYER');
    expect(player).toHaveLength(1);
    expect(player[0]!.message).toContain('pan_sarin');
  });

  it('does NOT flag when the game stripped clan-tag brackets ("[-ODM-] flower" → "-ODM- flower")', () => {
    const bracketBase = { ...base, steamPersonaNames: ['[-ODM-] flower', 'FoK | Von_Carstein'] };
    const r = verifyReplayMeta(meta({ players: [{ name: '-ODM- flower', faction: null }, { name: 'FoK | Von_Carstein', faction: null }] }), bracketBase);
    expect(r.issues.map((i) => i.type)).not.toContain('PLAYER');
  });

  it('does NOT flag when only one player renamed (the other still matches)', () => {
    const renamed = { ...base, steamPersonaNames: ['pan_sarin', 'CompletelyNewHandle'] };
    const r = verifyReplayMeta(meta({}), renamed);
    expect(r.issues.map((i) => i.type)).not.toContain('PLAYER');
  });

  it('skips the player check when the replay yielded no names (fail-open)', () => {
    const r = verifyReplayMeta(meta({ players: [] }), { ...base, steamPersonaNames: ['nobody_here'] });
    expect(r.issues.map((i) => i.type)).not.toContain('PLAYER');
  });

  it('is inconclusive (no issue) when faction extraction is empty', () => {
    const r = verifyReplayMeta(meta({ factions: [] }), base);
    expect(r.issues.map((i) => i.type)).not.toContain('FACTIONS');
  });

  it('skips the map check when the terrain is unknown (fail-open)', () => {
    const r = verifyReplayMeta(meta({ mapTerrain: 'brand_new_unmapped_terrain' }), base);
    expect(r.issues.map((i) => i.type)).not.toContain('MAP');
  });

  it('treats a mirror match as matching a same-faction report', () => {
    const mirror = { ...base, factionSlugs: ['grand_cathay', 'grand_cathay'] };
    const r = verifyReplayMeta(meta({ factions: ['grand_cathay'] }), mirror);
    expect(r.issues.map((i) => i.type)).not.toContain('FACTIONS');
  });
});
