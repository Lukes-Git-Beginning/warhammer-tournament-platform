import { describe, expect, it } from 'vitest';
import { isPdf, isTxt, parseTxtArmyList } from '../src/lib/army-parser.js';

// ---------------------------------------------------------------------------
// parseTxtArmyList
// ---------------------------------------------------------------------------

describe('parseTxtArmyList', () => {
  it('parses a standard list with Lord, Heroes and Units', () => {
    const content = `
Land Battle

Lord: Karl Franz
Hero: Balthasar Gelt
Hero: Ludwig Schwarzhelm

Units:
Reiksguard
Greatswords
Demigryph Knights
`.trim();

    const result = parseTxtArmyList(content);
    expect(result).not.toBeNull();
    expect(result!.battle_type).toMatch(/land\s*battle/i);
    expect(result!.lord).toBe('Karl Franz');
    expect(result!.heroes).toEqual(['Balthasar Gelt', 'Ludwig Schwarzhelm']);
    expect(result!.units).toContain('Reiksguard');
    expect(result!.units).toContain('Greatswords');
  });

  it('returns null for an empty string', () => {
    expect(parseTxtArmyList('')).toBeNull();
    expect(parseTxtArmyList('   \n  ')).toBeNull();
  });

  it('returns only battle_type when that is the only recognizable field', () => {
    const content = 'Domination Battle\nSome random description text.';
    const result = parseTxtArmyList(content);
    expect(result).not.toBeNull();
    expect(result!.battle_type).toMatch(/domination/i);
    expect(result!.lord).toBeUndefined();
    expect(result!.heroes).toBeUndefined();
    expect(result!.units).toBeUndefined();
  });

  it('returns null for garbage text without any recognizable keywords', () => {
    const content = 'ajskdlasjd qweqwe 12312 random nonsense here\nnothing useful at all';
    expect(parseTxtArmyList(content)).toBeNull();
  });

  it('parses a list with only Lord and Units (no heroes, no battle type)', () => {
    const content = `Lord: Tyrion\nUnits:\nSwordmasters of Hoeth\nSpearmen`;
    const result = parseTxtArmyList(content);
    expect(result).not.toBeNull();
    expect(result!.lord).toBe('Tyrion');
    expect(result!.heroes).toBeUndefined();
    expect(result!.units).toContain('Swordmasters of Hoeth');
  });

  it('handles multiple hero lines correctly', () => {
    const content = `Lord: Grimgor Ironhide\nHero: Wurrzag\nHero: Azhag the Slaughterer`;
    const result = parseTxtArmyList(content);
    expect(result!.heroes).toHaveLength(2);
    expect(result!.heroes).toContain('Wurrzag');
    expect(result!.heroes).toContain('Azhag the Slaughterer');
  });
});

// ---------------------------------------------------------------------------
// isPdf / isTxt
// ---------------------------------------------------------------------------

describe('isPdf', () => {
  it('returns true for a buffer starting with %PDF-', () => {
    const buf = Buffer.concat([Buffer.from('%PDF-'), Buffer.from('1.4 rest of pdf')]);
    expect(isPdf(buf)).toBe(true);
  });

  it('returns false for a TXT buffer', () => {
    expect(isPdf(Buffer.from('Lord: Karl Franz'))).toBe(false);
  });

  it('returns false for a buffer shorter than 5 bytes', () => {
    expect(isPdf(Buffer.from('%PDF'))).toBe(false);
  });
});

describe('isTxt', () => {
  it('returns true for printable ASCII content', () => {
    const buf = Buffer.from('Lord: Karl Franz\nHero: Balthasar Gelt\n');
    expect(isTxt(buf)).toBe(true);
  });

  it('returns false for a binary buffer (mostly non-printable bytes)', () => {
    const buf = Buffer.alloc(512, 0x00); // all null bytes
    expect(isTxt(buf)).toBe(false);
  });

  it('returns false for a PDF magic buffer', () => {
    const buf = Buffer.concat([Buffer.from('%PDF-'), Buffer.alloc(507, 0x00)]);
    expect(isTxt(buf)).toBe(false);
  });
});
