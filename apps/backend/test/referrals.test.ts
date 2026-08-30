import { describe, it, expect } from 'vitest';
import { slugifyRef, isValidRef } from '../src/lib/referrals.js';

describe('slugifyRef', () => {
  it('lowercases and hyphenates', () => {
    expect(slugifyRef('The RizzOttoverse')).toBe('the-rizzottoverse');
  });

  it('strips diacritics', () => {
    expect(slugifyRef('Türnier Café')).toBe('turnier-cafe');
  });

  it('collapses runs of non-alphanumerics and trims edges', () => {
    expect(slugifyRef('  --Foo!! & Bar__  ')).toBe('foo-bar');
  });

  it('caps length at 40 chars', () => {
    expect(slugifyRef('a'.repeat(80)).length).toBe(40);
  });

  it('falls back to "ref" when nothing survives', () => {
    expect(slugifyRef('!!!')).toBe('ref');
    expect(slugifyRef('')).toBe('ref');
  });
});

describe('isValidRef', () => {
  it('accepts typical ref codes', () => {
    expect(isValidRef('tw-official')).toBe(true);
    expect(isValidRef('reddit2')).toBe(true);
    expect(isValidRef('A')).toBe(true);
  });

  it('rejects empty, leading hyphen, and illegal chars', () => {
    expect(isValidRef('')).toBe(false);
    expect(isValidRef('-lead')).toBe(false);
    expect(isValidRef('has space')).toBe(false);
    expect(isValidRef('semi;colon')).toBe(false);
  });

  it('rejects overly long tokens', () => {
    expect(isValidRef('a'.repeat(65))).toBe(false);
  });
});
