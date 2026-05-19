import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  parseArmySetup,
  parseArmySetupSafe,
  ArmySetupParseError,
} from '../src/lib/army-setup-parser.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures', 'sample.army_setup');

// ---------- Helpers ----------

/**
 * Build a minimal valid .army_setup buffer for testing.
 *
 * Format:
 *   uint32 header + uint16 faction_len + faction + uint16 battle_type_len + battle_type
 *   + 0x00 separator + uint32 unit_count (0)
 */
function buildMinimalBuffer(faction = 'test_faction', battleType = 'domination'): Buffer {
  const factionBuf = Buffer.from(faction, 'ascii');
  const btBuf = Buffer.from(battleType, 'ascii');
  const buf = Buffer.allocUnsafe(4 + 2 + factionBuf.length + 2 + btBuf.length + 1 + 4);

  let pos = 0;
  buf.writeUInt32LE(8, pos); pos += 4;
  buf.writeUInt16LE(factionBuf.length, pos); pos += 2;
  factionBuf.copy(buf, pos); pos += factionBuf.length;
  buf.writeUInt16LE(btBuf.length, pos); pos += 2;
  btBuf.copy(buf, pos); pos += btBuf.length;
  buf.writeUInt8(0x00, pos); pos += 1;
  buf.writeUInt32LE(0, pos); // unit count = 0

  return buf;
}

/** Build a unit-key string in TWW2/3 format. */
function makeUnitKey(unitKey: string, faction: string, upgradeLevel = 0): string {
  return `${unitKey}:${faction}:${upgradeLevel}`;
}

/** Append a uint16-length-prefixed ASCII string to an existing buffer. */
function appendU16String(base: Buffer, str: string): Buffer {
  const strBuf = Buffer.from(str, 'ascii');
  const extra = Buffer.allocUnsafe(2 + strBuf.length);
  extra.writeUInt16LE(strBuf.length, 0);
  strBuf.copy(extra, 2);
  return Buffer.concat([base, extra]);
}

// ---------- parseArmySetup — real fixture ----------

describe('parseArmySetup — real fixture', () => {
  it('parses sample.army_setup and detects High Elves faction', () => {
    const buf = readFileSync(FIXTURE_PATH);
    const result = parseArmySetup(buf);

    expect(result.faction).toBe('wh2_main_hef_high_elves');
  });

  it('detects known units (Eltharion, Silver Helms, Fireborn)', () => {
    const buf = readFileSync(FIXTURE_PATH);
    const result = parseArmySetup(buf);

    const names = result.units.map((u) => u.name);
    expect(names.some((n) => n.includes('eltharion'))).toBe(true);
    expect(names.some((n) => n.includes('silver_helms'))).toBe(true);
    expect(names.some((n) => n.includes('fireborn'))).toBe(true);
  });

  it('aggregates duplicate units (Silver Helms x3)', () => {
    const buf = readFileSync(FIXTURE_PATH);
    const result = parseArmySetup(buf);

    const silverHelms = result.units.find((u) => u.name.includes('silver_helms'));
    expect(silverHelms).toBeDefined();
    expect(silverHelms!.count).toBe(3);
  });

  it('returns total_points as null (not encoded in format)', () => {
    const buf = readFileSync(FIXTURE_PATH);
    const result = parseArmySetup(buf);

    expect(result.total_points).toBeNull();
  });

  it('returns raw_strings as a non-empty array', () => {
    const buf = readFileSync(FIXTURE_PATH);
    const result = parseArmySetup(buf);

    expect(result.raw_strings.length).toBeGreaterThan(0);
  });
});

// ---------- parseArmySetup — minimal buffer ----------

describe('parseArmySetup — synthetic buffers', () => {
  it('parses a minimal buffer with faction and no units', () => {
    const buf = buildMinimalBuffer('wh2_main_hef_high_elves');
    const result = parseArmySetup(buf);

    expect(result.faction).toBe('wh2_main_hef_high_elves');
    expect(result.units).toHaveLength(0);
    expect(result.total_points).toBeNull();
  });

  it('detects unit keys embedded after the header', () => {
    let buf = buildMinimalBuffer('wh2_main_hef_high_elves');
    const unitKey = makeUnitKey(
      'wh2_main_hef_cav_silver_helms_0',
      'wh2_main_hef_high_elves',
      0,
    );
    buf = appendU16String(buf, unitKey);
    buf = appendU16String(buf, unitKey);

    const result = parseArmySetup(buf);
    const silverHelms = result.units.find((u) => u.name.includes('silver_helms'));
    expect(silverHelms).toBeDefined();
    expect(silverHelms!.count).toBe(2);
  });

  it('throws ArmySetupParseError on buffer shorter than 8 bytes', () => {
    const buf = Buffer.alloc(4);
    expect(() => parseArmySetup(buf)).toThrow(ArmySetupParseError);
  });

  it('throws ArmySetupParseError on truncated faction string', () => {
    // Write a faction-length larger than remaining buffer
    const buf = Buffer.alloc(8);
    buf.writeUInt32LE(8, 0);
    buf.writeUInt16LE(200, 4); // claims 200 bytes but buffer is only 8
    expect(() => parseArmySetup(buf)).toThrow(ArmySetupParseError);
  });

  it('includes the buffer sample in the error', () => {
    const buf = Buffer.alloc(4);
    try {
      parseArmySetup(buf);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ArmySetupParseError);
      expect((err as ArmySetupParseError).bufferSample).toBeDefined();
    }
  });
});

// ---------- parseArmySetupSafe ----------

describe('parseArmySetupSafe', () => {
  it('returns faction="unknown" and empty units for an empty buffer — no crash', () => {
    const result = parseArmySetupSafe(Buffer.alloc(0));

    expect(result.faction).toBe('unknown');
    expect(result.units).toHaveLength(0);
    expect(result.total_points).toBeNull();
    expect(result.raw_strings).toEqual([]);
  });

  it('extracts units from a corrupt-header but valid-body buffer', () => {
    // Start with garbage header bytes, then embed valid unit keys
    const garbage = Buffer.alloc(16, 0xff);
    let buf = garbage;
    const unitKey = makeUnitKey(
      'wh3_main_chs_cha_archaon_the_everchosen_0',
      'wh3_main_chs_warriors_of_chaos',
      1,
    );
    buf = appendU16String(buf, unitKey);

    const result = parseArmySetupSafe(buf);
    // Should detect the embedded unit key without crashing
    const unit = result.units.find((u) => u.name.includes('archaon'));
    expect(unit).toBeDefined();
  });

  it('works correctly on the real fixture too', () => {
    const buf = readFileSync(FIXTURE_PATH);
    const result = parseArmySetupSafe(buf);

    expect(result.faction).toBe('wh2_main_hef_high_elves');
    expect(result.units.length).toBeGreaterThan(0);
  });
});
