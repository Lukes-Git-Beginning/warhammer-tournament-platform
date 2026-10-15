/**
 * Quarterly qualifier gate: one game per competitive day elapsed in the quarter — no cap, no floor
 * from Q4 2026 on (Alex, 2026-10-06). Quarters before that keep the old min(90, days) (Alex,
 * 2026-10-15): Q3 2026 was qualified and its final invited under it.
 */
import { describe, expect, it } from 'vitest';
import { qualiGate, resolveQuarter } from '../src/lib/competition.js';

const q4 = resolveQuarter('2026-Q4', new Map())!;
const q3 = resolveQuarter('2026-Q3', new Map())!;
const DAY = 86_400_000;

describe('qualiGate', () => {
  it('is 0 at the very start of the quarter (no floor)', () => {
    expect(qualiGate(q4, q4.from)).toBe(0);
  });

  it('counts one game per elapsed day mid-quarter', () => {
    expect(qualiGate(q4, new Date(q4.from.getTime() + 10 * DAY + 3_600_000))).toBe(10);
  });

  it('a fully elapsed quarter from Q4 2026 on demands every day of it — above the old 90 cap', () => {
    const afterEnd = new Date(q4.to.getTime() + 30 * DAY);
    const gate = qualiGate(q4, afterEnd);
    expect(gate).toBe(Math.floor((q4.to.getTime() - q4.from.getTime()) / DAY));
    expect(gate).toBeGreaterThan(90);
  });

  it('Q3 2026 keeps the old cap of 90 although it has 92 days', () => {
    expect(qualiGate(q3, new Date(q3.to.getTime() + 30 * DAY))).toBe(90);
  });

  it('the cap follows the quarter, not its dates: an override shifting Q3 does not lift it', () => {
    const shifted = resolveQuarter('2026-Q3', new Map([['2026-Q3', { name: null, start_date: null, end_date: new Date('2026-10-20T22:00:00Z') }]]))!;
    expect(qualiGate(shifted, new Date('2026-11-30T00:00:00Z'))).toBe(90);
  });

  it('the launch quarter only counts days since launch', () => {
    // Launch 2026-06-27 → 2026-07-11 is 14 days after launch but only ~10 into Q3.
    expect(qualiGate(q3, new Date('2026-07-11T12:00:00Z'))).toBe(10);
  });
});
