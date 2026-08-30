import { describe, it, expect } from 'vitest';
import { firstExceededLayer } from '../src/lib/discord-notify.js';

const LAYERS = [
  { windowMs: 60_000, max: 3, label: '3/min' },
  { windowMs: 600_000, max: 5, label: '5/10min' },
  { windowMs: 1_800_000, max: 10, label: '10/30min' },
  { windowMs: 86_400_000, max: 100, label: '100/day' },
];
const NOW = 1_000_000_000_000;

describe('firstExceededLayer (layered DM rate caps)', () => {
  it('allows when under every layer', () => {
    expect(firstExceededLayer([], NOW, LAYERS)).toBeNull();
    expect(firstExceededLayer([NOW - 1_000, NOW - 2_000], NOW, LAYERS)).toBeNull();
  });

  it('trips the minute layer at 3 within 60s', () => {
    const ts = [NOW - 1_000, NOW - 2_000, NOW - 3_000];
    expect(firstExceededLayer(ts, NOW, LAYERS)?.label).toBe('3/min');
  });

  it('trips the 10-min layer when the minute is clear but 5 fell in 10 min', () => {
    // 5 sends spread across ~9 min, none in the last minute.
    const ts = [NOW - 120_000, NOW - 240_000, NOW - 360_000, NOW - 480_000, NOW - 540_000];
    expect(firstExceededLayer(ts, NOW, LAYERS)?.label).toBe('5/10min');
  });

  it('trips the daily layer at 100 within 24h while short windows stay clear', () => {
    // 100 sends ~14 min apart → only ~2 land in any 30-min window, but 100 in 24h.
    const ts = Array.from({ length: 100 }, (_, i) => NOW - (i + 1) * 850_000);
    expect(firstExceededLayer(ts, NOW, LAYERS)?.label).toBe('100/day');
  });

  it('ignores sends older than their window', () => {
    // Three sends, but each just outside the minute window → minute layer clear.
    const ts = [NOW - 61_000, NOW - 62_000, NOW - 63_000];
    expect(firstExceededLayer(ts, NOW, LAYERS)).toBeNull();
  });
});
