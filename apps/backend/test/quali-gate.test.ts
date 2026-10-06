/**
 * Quarterly qualifier gate: one game per competitive day elapsed in the quarter — no cap, no floor
 * (Alex, 2026-10-06; previously min(90, days), so a full quarter demanded 90 instead of 92).
 */
import { describe, expect, it } from 'vitest';
import { qualiGate, resolveQuarter } from '../src/lib/competition.js';

const q4 = resolveQuarter('2026-Q4', new Map())!;
const DAY = 86_400_000;

describe('qualiGate', () => {
  it('is 0 at the very start of the quarter (no floor)', () => {
    expect(qualiGate(q4, q4.from)).toBe(0);
  });

  it('counts one game per elapsed day mid-quarter', () => {
    expect(qualiGate(q4, new Date(q4.from.getTime() + 10 * DAY + 3_600_000))).toBe(10);
  });

  it('a fully elapsed quarter demands every day of it — above the old 90 cap (no ceiling)', () => {
    const afterEnd = new Date(q4.to.getTime() + 30 * DAY);
    const gate = qualiGate(q4, afterEnd);
    expect(gate).toBe(Math.floor((q4.to.getTime() - q4.from.getTime()) / DAY));
    expect(gate).toBeGreaterThan(90);
  });

  it('the launch quarter only counts days since launch', () => {
    const q3 = resolveQuarter('2026-Q3', new Map())!;
    // Launch 2026-06-27 → 2026-07-11 is 14 days after launch but only ~10 into Q3.
    expect(qualiGate(q3, new Date('2026-07-11T12:00:00Z'))).toBe(10);
  });
});
