/**
 * Naïver TXT-Parser für Total War Warhammer 3 Army-Listen.
 *
 * Best-effort — erkennt typische Patterns ("Lord:", "Hero:", "Units:") und
 * splittet Lines. Bei PDF: Header-Magic-Check, kein Parsing.
 *
 * Schema des output `parsed_data`:
 * { battle_type?: string, lord?: string, heroes?: string[], units?: string[] }
 */

export interface ParsedArmyData {
  battle_type?: string;
  lord?: string;
  heroes?: string[];
  units?: string[];
}

const BATTLE_TYPE_PATTERNS = [
  /domination\s*battle/i,
  /quest\s*battle/i,
  /land\s*battle/i,
  /siege\s*battle/i,
];

const LORD_LINE = /^lord[\s:]+(.+)$/im;
const HERO_LINE = /^hero[\s:]+(.+)$/gim;
const UNIT_SECTION = /units?\s*:?\s*\n((?:.+\n?)+)/i;

export function parseTxtArmyList(content: string): ParsedArmyData | null {
  if (!content || content.trim().length === 0) return null;

  const result: ParsedArmyData = {};

  // Battle type
  for (const pattern of BATTLE_TYPE_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      result.battle_type = match[0].trim();
      break;
    }
  }

  // Lord (single)
  const lordMatch = content.match(LORD_LINE);
  if (lordMatch) result.lord = lordMatch[1]!.trim();

  // Heroes (multiple)
  const heroes: string[] = [];
  let heroMatch;
  // Reset lastIndex since the regex is /gim and may carry state
  HERO_LINE.lastIndex = 0;
  while ((heroMatch = HERO_LINE.exec(content)) !== null) {
    heroes.push(heroMatch[1]!.trim());
  }
  if (heroes.length > 0) result.heroes = heroes;

  // Units (single block or per-line)
  const unitsMatch = content.match(UNIT_SECTION);
  if (unitsMatch) {
    const unitsBlock = unitsMatch[1]!;
    const unitLines = unitsBlock
      .split(/\n+/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && !/^(lord|hero|battle)/i.test(l));
    if (unitLines.length > 0) result.units = unitLines;
  }

  // Return null if nothing recognized
  if (!result.battle_type && !result.lord && !result.heroes && !result.units) return null;
  return result;
}

const PDF_MAGIC = Buffer.from('%PDF-');

export function isPdf(buffer: Buffer): boolean {
  if (buffer.length < 5) return false;
  return buffer.subarray(0, 5).equals(PDF_MAGIC);
}

export function isTxt(buffer: Buffer): boolean {
  // Heuristic: first 512 bytes are mostly printable ASCII / common UTF-8
  const sample = buffer.subarray(0, Math.min(512, buffer.length));
  let printable = 0;
  for (const byte of sample) {
    if ((byte >= 0x20 && byte <= 0x7e) || byte === 0x09 || byte === 0x0a || byte === 0x0d)
      printable++;
  }
  return printable / sample.length > 0.85;
}
