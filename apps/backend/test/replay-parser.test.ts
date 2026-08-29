import { describe, it, expect } from 'vitest';
import {
  isEsf, readRecordedAt, extractMapTerrain, extractFactions, replayContainsName, extractReplayPlayers, TOKEN_TO_FACTION,
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

  it('returns [] for a non-ESF buffer (fail-open, never throws)', () => {
    expect(extractReplayPlayers(Buffer.from([0xff, 0xd8, 0xff]))).toEqual([]); // jpg
    expect(extractReplayPlayers(Buffer.alloc(4))).toEqual([]);
    expect(extractReplayPlayers(esfHeader())).toEqual([]); // valid signature, no tree
  });
  // Full player↔faction pairing is validated against real replays (8/8 labelled, 229/233 prod),
  // not synthesised here: the ESF tree/string-pool layout is impractical to hand-craft in a unit test.

  // Regression: rizzotto.gg incident 2026-08-28. A real, player-uploaded replay carried a record
  // whose CAULEB128 group count decoded to 7.45e18 for a 29-byte block. The group loop did no work
  // per iteration (the inner cursor was already past the block) but still counted to that value —
  // an effectively infinite synchronous loop. It ran inside the result-report request handler, so
  // it blocked the event loop: the process stayed up while every request 502'd for 35 minutes.
  it('bounds a record whose group count is absurd (does not hang) — incident 2026-08-28', () => {
    // Big-endian 7-bit groups, high bit = continuation (mirrors the parser's cauleb128).
    const hugeVarint = Buffer.from([0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0x7f]); // ≈2^63

    const buf = Buffer.alloc(128);
    buf[0] = 0xcb; buf[1] = 0xab;
    buf.writeUInt32LE(1785014439, 8);
    buf.writeUInt32LE(64, 12);          // string-pool table offset

    // Root record at 0x10: nested, unknown name index → RN[…] undefined, exactly as in the incident.
    buf[16] = 0xc0;                     // 0x80 record | 0x40 HAS_NESTED
    buf.writeUInt16LE(0xffff, 17);      // name index outside the record-name table
    buf[19] = 0;                        // version
    buf[20] = 20;                       // block size → block ends at 41
    hugeVarint.copy(buf, 21);           // group count, read at p=21 → p=30
    // 30..40 stay zero: each group reads a 0-length entry, advancing the cursor one byte at a time.

    buf.writeUInt16LE(1, 64);           // record-name table: 1 entry
    buf.writeUInt16LE(1, 66); buf.write('X', 68, 'ascii');
    buf.writeUInt32LE(0, 69);           // empty UTF-16 pool
    buf.writeUInt32LE(0, 73);           // empty UTF-8 pool

    const started = Date.now();
    expect(extractReplayPlayers(buf)).toEqual([]); // fail-open, as for any unreadable tree
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
