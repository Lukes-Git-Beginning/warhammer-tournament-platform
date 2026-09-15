/**
 * Quarterly Final size formula + ladder size + raffle — pure logic (no DB).
 * N = min(pow2 ≤ active/4, pow2 ≤ qualified/2), hard floor Top 16 (Alex 2026-09-15).
 */
import { describe, expect, it } from 'vitest';
import {
  largestPow2AtMost,
  quarterlyFinalSize,
  pickRaffleWinner,
} from '../src/lib/competitive-finals.js';

describe('largestPow2AtMost', () => {
  it('floors to a power of two', () => {
    expect(largestPow2AtMost(16)).toBe(16);
    expect(largestPow2AtMost(17)).toBe(16);
    expect(largestPow2AtMost(31)).toBe(16);
    expect(largestPow2AtMost(32)).toBe(32);
    expect(largestPow2AtMost(1)).toBe(1);
  });
  it('is 0 below one', () => {
    expect(largestPow2AtMost(0.75)).toBe(0);
    expect(largestPow2AtMost(0)).toBe(0);
    expect(largestPow2AtMost(-5)).toBe(0);
  });
});

describe('quarterlyFinalSize — doubling tiers + hard Top-16 floor', () => {
  it('hits the locked tiers at their thresholds', () => {
    expect(quarterlyFinalSize(64, 32)).toBe(16); // Top 16
    expect(quarterlyFinalSize(128, 64)).toBe(32); // Top 32
    expect(quarterlyFinalSize(256, 128)).toBe(64); // Top 64
  });

  it('returns 0 below the floor (both thresholds must be met)', () => {
    expect(quarterlyFinalSize(63, 32)).toBe(0); // active/4 → pow2(15.75)=8 < 16
    expect(quarterlyFinalSize(64, 31)).toBe(0); // qualified/2 → pow2(15.5)=8 < 16
    expect(quarterlyFinalSize(231, 26)).toBe(0); // live snapshot at full gate: 26 qualified → 8 → none
    expect(quarterlyFinalSize(0, 0)).toBe(0);
  });

  it('takes the MIN of the two ceilings', () => {
    // Plenty active, but qualified caps it: 200/4 → 32, 100/2 → 32 → 32.
    expect(quarterlyFinalSize(200, 100)).toBe(32);
    // Community ceiling binds: 300 active → pow2(75)=64, but only 64 qualified → pow2(32)=32.
    expect(quarterlyFinalSize(300, 64)).toBe(32);
  });
});

describe('pickRaffleWinner', () => {
  it('returns null for an empty field', () => {
    expect(pickRaffleWinner([])).toBeNull();
  });
  it('is deterministic with an explicit index', () => {
    expect(pickRaffleWinner(['a', 'b', 'c'], 1)).toBe('b');
    expect(pickRaffleWinner(['a', 'b', 'c'], 0)).toBe('a');
  });
  it('clamps an out-of-range index', () => {
    expect(pickRaffleWinner(['a', 'b'], 9)).toBe('b');
  });
  it('picks a member of the field when random', () => {
    const field = ['x', 'y', 'z'];
    expect(field).toContain(pickRaffleWinner(field));
  });
});
