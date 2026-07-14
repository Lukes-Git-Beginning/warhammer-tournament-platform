/**
 * Unit tests for the queue-abuse penalty decision logic (#14).
 * Pure helpers only — the Redis wiring is exercised in integration.
 */

import { describe, it, expect } from 'vitest';
import {
  isShortStint,
  reachedAbuseThreshold,
  timeoutMsForLevel,
  SHORT_STINT_MS,
  ABUSE_THRESHOLD,
  MAX_TIMEOUT_MS,
} from '../src/lib/queue-penalty.js';

describe('isShortStint', () => {
  it('is true when the player leaves within the short window', () => {
    const joined = 1_000_000;
    expect(isShortStint(joined, joined + 60_000)).toBe(true); // 1 min
    expect(isShortStint(joined, joined + SHORT_STINT_MS - 1)).toBe(true);
  });

  it('is false at or beyond the window', () => {
    const joined = 1_000_000;
    expect(isShortStint(joined, joined + SHORT_STINT_MS)).toBe(false);
    expect(isShortStint(joined, joined + 10 * 60_000)).toBe(false);
  });

  it('is false for a non-positive duration (clock skew guard)', () => {
    expect(isShortStint(1_000_000, 999_000)).toBe(false);
  });
});

describe('reachedAbuseThreshold', () => {
  it('trips only at or above the threshold', () => {
    expect(reachedAbuseThreshold(ABUSE_THRESHOLD - 1)).toBe(false);
    expect(reachedAbuseThreshold(ABUSE_THRESHOLD)).toBe(true);
    expect(reachedAbuseThreshold(ABUSE_THRESHOLD + 5)).toBe(true);
  });
});

describe('timeoutMsForLevel — education-first escalation', () => {
  it('level 1 is a warning only (no cooldown)', () => {
    expect(timeoutMsForLevel(1)).toBe(0);
    expect(timeoutMsForLevel(0)).toBe(0);
  });

  it('level 2 is 1 hour, level 3 is 24 hours', () => {
    expect(timeoutMsForLevel(2)).toBe(60 * 60 * 1000);
    expect(timeoutMsForLevel(3)).toBe(24 * 60 * 60 * 1000);
  });

  it('level 4+ is the long stand-in until an admin lifts it', () => {
    expect(timeoutMsForLevel(4)).toBe(MAX_TIMEOUT_MS);
    expect(timeoutMsForLevel(9)).toBe(MAX_TIMEOUT_MS);
  });
});
