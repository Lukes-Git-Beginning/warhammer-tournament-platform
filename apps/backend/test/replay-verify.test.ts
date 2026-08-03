import { describe, it, expect } from 'vitest';
import { verifyReplayMeta, type ExpectedGame } from '../src/lib/replay-verify.js';

const base: ExpectedGame = {
  factionSlugs: ['kislev', 'skaven'],
  mapName: 'Jade Tomb',
  matchCreatedAt: new Date('2026-08-01T20:00:00Z'),
  steamPersonaNames: ['pan_sarin', 'Martinius | RTK'],
};
const meta = (o: Partial<{ factions: string[]; mapTerrain: string | null; recordedAt: Date | null }>) => ({
  factions: o.factions ?? ['kislev', 'skaven'],
  mapTerrain: o.mapTerrain ?? 'test_domination_jade_tomb',
  recordedAt: o.recordedAt ?? new Date('2026-08-01T21:00:00Z'),
});
const allNames = (name: string) => base.steamPersonaNames.includes(name);

describe('verifyReplayMeta', () => {
  it('passes when factions, map, time and names all match', () => {
    const r = verifyReplayMeta(meta({}), allNames, base);
    expect(r.ok).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it('flags a faction mismatch (right game, wrong reported factions)', () => {
    const r = verifyReplayMeta(meta({ factions: ['greenskins', 'norsca'] }), allNames, base);
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.type)).toContain('FACTIONS');
  });

  it('flags a map mismatch', () => {
    const r = verifyReplayMeta(meta({ mapTerrain: 'test_domination_hasuts_dom' }), allNames, base);
    expect(r.issues.map((i) => i.type)).toContain('MAP');
  });

  it('flags a recycled replay (recorded before the match was created)', () => {
    const r = verifyReplayMeta(meta({ recordedAt: new Date('2026-07-10T10:00:00Z') }), allNames, base);
    expect(r.issues.map((i) => i.type)).toContain('RECORDED_TIME');
  });

  it('flags a missing player (wrong opponent)', () => {
    const only = (name: string) => name === 'pan_sarin';
    const r = verifyReplayMeta(meta({}), only, base);
    const player = r.issues.filter((i) => i.type === 'PLAYER');
    expect(player).toHaveLength(1);
    expect(player[0]!.message).toContain('Martinius | RTK');
  });

  it('is inconclusive (no issue) when faction extraction is empty', () => {
    const r = verifyReplayMeta(meta({ factions: [] }), allNames, base);
    expect(r.issues.map((i) => i.type)).not.toContain('FACTIONS');
  });

  it('skips the map check when the terrain is unknown (fail-open)', () => {
    const r = verifyReplayMeta(meta({ mapTerrain: 'brand_new_unmapped_terrain' }), allNames, base);
    expect(r.issues.map((i) => i.type)).not.toContain('MAP');
  });

  it('treats a mirror match as matching a same-faction report', () => {
    const mirror = { ...base, factionSlugs: ['grand_cathay', 'grand_cathay'] };
    const r = verifyReplayMeta(meta({ factions: ['grand_cathay'] }), allNames, mirror);
    expect(r.issues.map((i) => i.type)).not.toContain('FACTIONS');
  });
});
