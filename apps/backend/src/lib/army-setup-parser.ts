/**
 * army-setup-parser.ts
 *
 * Decoder for Total War: Warhammer 2/3 `.army_setup` binary export files.
 *
 * File format (little-endian):
 *   [uint32]  header / army-slot count
 *   [uint16]  faction_string_length
 *   [bytes]   faction_string (ASCII, e.g. "wh2_main_hef_high_elves")
 *   [uint16]  battle_type_string_length
 *   [bytes]   battle_type_string (ASCII, e.g. "domination")
 *   [uint8]   separator (0x00)
 *   [uint32]  unit_count  ← number of unit-slot records
 *   ... (complex nested binary for each unit slot: unit-key string, abilities, equipment)
 *
 * Unit-key strings follow the pattern:
 *   <unit_key>:<faction_key>:<upgrade_level>
 * e.g. "wh2_main_hef_cav_silver_helms_0:wh2_main_hef_high_elves:0"
 *
 * Because the nested unit-slot binary is undocumented and complex, the parser
 * takes a two-phase approach:
 *   1. Parse the structured header (faction, battle type, unit count).
 *   2. Scan the remaining buffer for uint16-length-prefixed ASCII strings and
 *      identify unit-key records via regex, then aggregate duplicate unit_keys
 *      into { name, count } pairs.
 *
 * This makes the parser robust against future format changes in the ability/
 * equipment sub-records while still extracting all actionable unit data.
 */

// ---------- Types ----------

export interface ParsedUnit {
  name: string;  // unit_key portion before the first colon
  count: number;
}

export interface ParsedArmyList {
  faction: string;          // detected faction slug (e.g. "wh2_main_hef_high_elves") or "unknown"
  units: ParsedUnit[];
  total_points: number | null;  // always null — not encoded in .army_setup format
  raw_strings: string[];        // all discovered ASCII strings as a fallback view
}

// ---------- Errors ----------

export class ArmySetupParseError extends Error {
  constructor(
    message: string,
    public readonly bufferSample: string,
  ) {
    super(message);
    this.name = 'ArmySetupParseError';
  }
}

// ---------- Internal helpers ----------

/**
 * Read a uint16-LE-length-prefixed ASCII string from `buf` at `offset`.
 * Returns { value, nextOffset } or null if the data is not a valid ASCII string.
 */
function readU16String(
  buf: Buffer,
  offset: number,
): { value: string; nextOffset: number } | null {
  if (offset + 2 > buf.length) return null;
  const len = buf.readUInt16LE(offset);
  if (len === 0 || len > 512) return null;
  if (offset + 2 + len > buf.length) return null;
  const candidate = buf.slice(offset + 2, offset + 2 + len);
  const str = candidate.toString('ascii');
  // Reject strings with non-printable characters (allow space 0x20 to tilde 0x7e)
  if (!/^[\x20-\x7e]+$/.test(str)) return null;
  return { value: str, nextOffset: offset + 2 + len };
}

/**
 * Scan the entire buffer for uint16-length-prefixed ASCII strings (length 4–512).
 * Returns every unique position where such a string is found.
 * This is intentionally brute-force to be resilient against binary padding.
 */
function scanAllU16Strings(buf: Buffer): string[] {
  const results: string[] = [];
  for (let i = 0; i < buf.length - 2; i++) {
    const r = readU16String(buf, i);
    if (r && r.value.length >= 4) {
      results.push(r.value);
    }
  }
  return results;
}

/**
 * Pattern for TWW2/TWW3 unit-key strings:
 *   <unit_key>:<faction_key>:<upgrade_level>
 * e.g. "wh2_main_hef_cav_silver_helms_0:wh2_main_hef_high_elves:0"
 */
const UNIT_KEY_RE = /^(wh[23]_[a-z0-9_]+:[a-z0-9_]+:\d+)$/;

/** Extract the human-readable unit name from a unit-key string. */
function unitKeyToName(unitKey: string): string {
  // unit_key is the portion before the first colon
  const part = unitKey.split(':')[0] ?? unitKey;
  return part;
}

/** Derive the faction slug from a unit-key's embedded faction field. */
function factionFromUnitKey(unitKey: string): string {
  const parts = unitKey.split(':');
  // parts[1] is the faction key, e.g. "wh2_main_hef_high_elves"
  return parts[1] ?? 'unknown';
}

// ---------- Public API ----------

/**
 * Parse a `.army_setup` binary buffer.
 *
 * @throws {ArmySetupParseError} if the buffer is too short or the header cannot be decoded.
 */
export function parseArmySetup(buffer: Buffer): ParsedArmyList {
  if (buffer.length < 8) {
    throw new ArmySetupParseError(
      `Buffer too short (${buffer.length} bytes) — not a valid .army_setup file`,
      buffer.slice(0, 16).toString('hex'),
    );
  }

  let pos = 0;

  // --- Header (uint32) ---
  const _header = buffer.readUInt32LE(pos);
  pos += 4;

  // --- Faction string (uint16 length + ASCII) ---
  const factionResult = readU16String(buffer, pos);
  if (!factionResult) {
    throw new ArmySetupParseError(
      'Failed to read faction string from header',
      buffer.slice(0, 32).toString('hex'),
    );
  }
  const faction = factionResult.value;
  pos = factionResult.nextOffset;

  // --- Battle-type string (uint16 length + ASCII) ---
  const battleTypeResult = readU16String(buffer, pos);
  if (!battleTypeResult) {
    throw new ArmySetupParseError(
      'Failed to read battle-type string from header',
      buffer.slice(0, 48).toString('hex'),
    );
  }
  pos = battleTypeResult.nextOffset;

  // --- Separator byte ---
  if (pos >= buffer.length) {
    throw new ArmySetupParseError(
      'Unexpected end of buffer after battle-type string',
      buffer.slice(0, 64).toString('hex'),
    );
  }
  pos += 1; // skip 0x00 separator

  // --- Unit count (uint32) ---
  if (pos + 4 > buffer.length) {
    throw new ArmySetupParseError(
      'Buffer too short to read unit count',
      buffer.slice(0, 64).toString('hex'),
    );
  }
  // Read declared unit count for structural validation (not used further — we rely on string scan)
  void buffer.readUInt32LE(pos);

  // --- Scan for unit-key strings in the remainder of the buffer ---
  // We use the full-buffer scan rather than sequential parsing because
  // the ability/equipment sub-records have undocumented variable-length layouts.
  const allStrings = scanAllU16Strings(buffer);
  const unitKeys = allStrings.filter((s) => UNIT_KEY_RE.test(s));

  // Aggregate duplicate unit keys (same unit type appearing multiple times = multiple copies)
  const unitCounts = new Map<string, number>();
  for (const key of unitKeys) {
    const name = unitKeyToName(key);
    unitCounts.set(name, (unitCounts.get(name) ?? 0) + 1);
  }

  const units: ParsedUnit[] = Array.from(unitCounts.entries()).map(([name, count]) => ({
    name,
    count,
  }));

  // Determine faction from header (already parsed) or from first unit key as fallback
  const resolvedFaction =
    faction.length > 0
      ? faction
      : unitKeys.length > 0
        ? factionFromUnitKey(unitKeys[0]!)
        : 'unknown';

  return {
    faction: resolvedFaction,
    units,
    total_points: null,
    raw_strings: allStrings,
  };
}

/**
 * Safe variant — never throws.
 * Extracts as many ASCII strings as possible and returns a best-effort result.
 * Useful as a last-resort fallback when the binary is partially corrupt.
 */
export function parseArmySetupSafe(buffer: Buffer): ParsedArmyList {
  try {
    return parseArmySetup(buffer);
  } catch {
    // Fall back to raw string scan only
    const raw = scanAllU16Strings(buffer);
    const unitKeys = raw.filter((s) => UNIT_KEY_RE.test(s));
    const unitCounts = new Map<string, number>();
    for (const key of unitKeys) {
      const name = unitKeyToName(key);
      unitCounts.set(name, (unitCounts.get(name) ?? 0) + 1);
    }
    const units: ParsedUnit[] = Array.from(unitCounts.entries()).map(([name, count]) => ({
      name,
      count,
    }));
    const faction = unitKeys.length > 0 ? factionFromUnitKey(unitKeys[0]!) : 'unknown';
    return {
      faction,
      units,
      total_points: null,
      raw_strings: raw,
    };
  }
}
