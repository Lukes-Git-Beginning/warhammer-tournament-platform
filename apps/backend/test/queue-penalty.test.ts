/**
 * Unit tests for the queue-abuse penalty decision logic (#14).
 * Pure helpers only — the Redis wiring is exercised in integration.
 */

import { describe, it, expect } from 'vitest';
import {
  isShortStint,
  reachedAbuseThreshold,
  timeoutMsForLevel,
  decayedLevel,
  SHORT_STINT_MS,
  ABUSE_THRESHOLD,
  SEVEN_DAYS_MS,
  PERMANENT_TIMEOUT_MS,
  DECAY_PERIOD_MS,
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

  it('level 4 is 7 days, level 5+ is permanent (until an admin lifts it)', () => {
    expect(timeoutMsForLevel(4)).toBe(SEVEN_DAYS_MS);
    expect(timeoutMsForLevel(5)).toBe(PERMANENT_TIMEOUT_MS);
    expect(timeoutMsForLevel(9)).toBe(PERMANENT_TIMEOUT_MS);
  });
});

describe('decayedLevel — one step forgiven per clean decay period', () => {
  const t = 1_000_000_000;

  it('does not decay before a full period passes', () => {
    expect(decayedLevel(3, t, t)).toBe(3);
    expect(decayedLevel(3, t, t + DECAY_PERIOD_MS - 1)).toBe(3);
  });

  it('drops one level per full period', () => {
    expect(decayedLevel(3, t, t + DECAY_PERIOD_MS)).toBe(2);
    expect(decayedLevel(3, t, t + 2 * DECAY_PERIOD_MS)).toBe(1);
  });

  it('floors at 0 and reflects the "25 clean days → back to warning" case', () => {
    // level 1, then ~25 clean days (> 3 periods) → fully decayed
    expect(decayedLevel(1, t, t + 25 * 24 * 60 * 60 * 1000)).toBe(0);
    expect(decayedLevel(3, t, t + 100 * DECAY_PERIOD_MS)).toBe(0);
  });

  it('is a no-op for a clean slate', () => {
    expect(decayedLevel(0, t, t + 5 * DECAY_PERIOD_MS)).toBe(0);
  });
});
