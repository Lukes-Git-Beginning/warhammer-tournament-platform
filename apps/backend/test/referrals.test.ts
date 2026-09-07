import { describe, it, expect } from 'vitest';
import {
  slugifyRef,
  isValidRef,
  destinationRef,
  mergeRefCounts,
  mergeTournamentSources,
} from '../src/lib/referrals.js';

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

describe('destinationRef', () => {
  it('uses an explicit ref as-is (only trimmed), matching the sign-up link rule', () => {
    expect(destinationRef({ ref: '  tt-selfpromo ', name: 'Total Tavern (self-promo)' })).toBe('tt-selfpromo');
  });

  it('derives from the name when the ref is empty', () => {
    expect(destinationRef({ ref: '', name: 'The RizzOttoverse' })).toBe('the-rizzottoverse');
    expect(destinationRef({ ref: '   ', name: 'Official TW Discord' })).toBe('official-tw-discord');
  });
});

describe('mergeRefCounts', () => {
  it('lists every destination, including ones with no recorded events (count 0)', () => {
    const rows = mergeRefCounts(
      [
        { ref: 'tw-official', name: 'Official TW Discord' },
        { ref: '', name: 'The RizzOttoverse' }, // ref derived from name
      ],
      [{ ref: 'tw-official', count: 5 }],
    );
    expect(rows).toEqual([
      { ref: 'tw-official', name: 'Official TW Discord', count: 5 },
      { ref: 'the-rizzottoverse', name: 'The RizzOttoverse', count: 0 },
    ]);
  });

  it('keeps event refs with no matching destination as orphaned rows (name null)', () => {
    const rows = mergeRefCounts([{ ref: 'tw-official', name: 'Official TW Discord' }], [
      { ref: 'tw-official', count: 2 },
      { ref: 'legacy-reddit', count: 9 },
    ]);
    expect(rows[0]).toEqual({ ref: 'legacy-reddit', name: null, count: 9 });
    expect(rows[1]).toEqual({ ref: 'tw-official', name: 'Official TW Discord', count: 2 });
  });

  it('sorts by count desc, then by label ascending', () => {
    const rows = mergeRefCounts(
      [
        { ref: 'b', name: 'Bravo' },
        { ref: 'a', name: 'Alpha' },
      ],
      [
        { ref: 'a', count: 3 },
        { ref: 'b', count: 3 },
      ],
    );
    expect(rows.map((r) => r.ref)).toEqual(['a', 'b']);
  });
});

describe('mergeTournamentSources', () => {
  it('bases rows on destinations and computes conversion from clicks/signups', () => {
    const rows = mergeTournamentSources(
      [
        { ref: 'tw-official', name: 'Official TW Discord' },
        { ref: 'rtk', name: 'Round Table Knights' },
      ],
      [
        { ref: 'tw-official', count: 10 },
        { ref: 'rtk', count: 4 },
      ],
      [{ ref: 'tw-official', count: 3 }],
    );
    const tw = rows.find((r) => r.ref === 'tw-official')!;
    const rtk = rows.find((r) => r.ref === 'rtk')!;
    expect(tw).toEqual({ ref: 'tw-official', name: 'Official TW Discord', clicks: 10, signups: 3, conversion: 0.3 });
    // 4 clicks, 0 signups → 0 % conversion (null is reserved for zero clicks).
    expect(rtk).toEqual({ ref: 'rtk', name: 'Round Table Knights', clicks: 4, signups: 0, conversion: 0 });
  });

  it('shows a brand-new destination with all zeroes and null conversion', () => {
    const rows = mergeTournamentSources([{ ref: 'new-server', name: 'Fresh Server' }], [], []);
    expect(rows).toEqual([{ ref: 'new-server', name: 'Fresh Server', clicks: 0, signups: 0, conversion: null }]);
  });

  it('keeps signup sources without a destination as orphaned rows', () => {
    const rows = mergeTournamentSources([], [], [{ ref: 'word-of-mouth', count: 2 }]);
    expect(rows).toEqual([
      { ref: 'word-of-mouth', name: null, clicks: 0, signups: 2, conversion: null },
    ]);
  });
});
