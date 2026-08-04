import { describe, it, expect } from 'vitest';
import {
  isEsf, readRecordedAt, extractMapTerrain, extractFactions, replayContainsName, attributeFaction, TOKEN_TO_FACTION,
} from '../src/lib/replay-parser.js';
import { mapNameFromTerrain } from '../src/lib/replay-maps.js';

// Minimal synthetic ESF buffers. Real-replay accuracy (factions 39/40, map 40/40, timestamp 40/40)
// was validated against prod on 2026-08-03; these lock the units.
function esfHeader(unix = 1785014439): Buffer {
  const b = Buffer.alloc(12);
  b[0] = 0xcb; b[1] = 0xab; // signature
  b.writeUInt32LE(unix, 8);
  return b;
}
function withText(header: Buffer, text: string): Buffer {
  return Buffer.concat([header, Buffer.from(text, 'latin1')]);
}
// repeat a faction's unit-token key n times to simulate an army of that faction
const army = (token: string, n: number) =>
  Array.from({ length: n }, (_, i) => `wh3_main_${token}_inf_unit_${i}`).join(' ');

describe('replay-parser', () => {
  it('detects the ESF signature (and rejects jpg/png)', () => {
    expect(isEsf(Buffer.from([0xcb, 0xab]))).toBe(true);
    expect(isEsf(Buffer.from([0xca, 0xab]))).toBe(true); // patch variant
    expect(isEsf(Buffer.from([0xff, 0xd8]))).toBe(false);
    expect(isEsf(Buffer.from([0x89, 0x50]))).toBe(false);
  });

  it('reads the recording timestamp from header offset 8', () => {
    const dt = readRecordedAt(esfHeader(1785014439));
    expect(dt?.toISOString()).toBe('2026-07-25T21:20:39.000Z');
    // implausible value → null
    expect(readRecordedAt(esfHeader(123))).toBeNull();
  });

  it('extracts the map terrain slug (both path and domination-key forms)', () => {
    expect(extractMapTerrain(withText(esfHeader(), 'x terrain/battles/test_domination_jade_tomb y'))).toBe('test_domination_jade_tomb');
    expect(extractMapTerrain(withText(esfHeader(), 'x wh3_main_domination_battle_for_itza y'))).toBe('battle_for_itza');
    expect(mapNameFromTerrain('test_domination_jade_tomb')).toBe('Jade Tomb');
    expect(mapNameFromTerrain('unknown_terrain')).toBeNull();
  });

  it('identifies the two factions from unit-token frequency', () => {
    const facs = extractFactions(withText(esfHeader(), `${army('ksl', 20)} ${army('skv', 18)} wh2_main_lzd_inf_stray_0`));
    expect(new Set(facs)).toEqual(new Set(['kislev', 'skaven']));
  });

  it('treats a lone faction (with only stray tokens) as a mirror match', () => {
    const facs = extractFactions(withText(esfHeader(), `${army('cth', 30)} wh2_main_lzd_inf_stray_0`));
    expect(facs).toEqual(['grand_cathay', 'grand_cathay']);
  });

  it('maps a daemons army with god-flavoured units to daemons_of_chaos via the designation slug', () => {
    // dark_elves opponent (def) + a daemons player fielding many Slaanesh units + the dae designation
    const facs = extractFactions(withText(esfHeader(),
      `${army('def', 20)} ${army('sla', 8)} wh3_main_dae_daemons wh3_main_dae_daemon_prince`));
    expect(new Set(facs)).toEqual(new Set(['dark_elves', 'daemons_of_chaos']));
  });

  it('keeps a mono-god faction as the god (designation), not daemons — slug-primary', () => {
    // A Nurgle faction (nur_nurgle designation) fielding some shared daemon units vs Kislev.
    const facs = extractFactions(withText(esfHeader(),
      `${army('ksl', 20)} ${army('nur', 16)} wh3_main_nur_nurgle wh3_main_ksl_kislev wh3_main_dae_inf_plaguebearers_0`));
    expect(new Set(facs)).toEqual(new Set(['kislev', 'nurgle']));
  });

  it('finds a player display name (UTF-16, case-insensitive)', () => {
    const buf = Buffer.concat([esfHeader(), Buffer.from('pan_sarin', 'utf16le')]);
    expect(replayContainsName(buf, 'PAN_SARIN')).toBe(true);
    expect(replayContainsName(buf, 'someone_else')).toBe(false);
  });

  it('has all 24 factions in the token map', () => {
    expect(new Set(Object.values(TOKEN_TO_FACTION)).size).toBe(24);
  });

  it('attributes a faction to a player by the nearest faction display name', () => {
    // Two player blocks: [Skaven … Reck1355] [Lizardmen … Ti_Elle] as UTF-16 strings.
    const u16 = (s: string) => Buffer.from(s, 'utf16le');
    const gap = Buffer.alloc(200);
    const buf = Buffer.concat([
      u16('Skaven'), gap, u16('Reck1355'), gap, gap, gap,
      u16('Lizardmen'), gap, u16('Ti_Elle'),
    ]);
    expect(attributeFaction(buf, 'Reck1355')).toBe('skaven');
    expect(attributeFaction(buf, 'Ti_Elle')).toBe('lizardmen');
    expect(attributeFaction(buf, 'NotPresent')).toBeNull();
  });
});
