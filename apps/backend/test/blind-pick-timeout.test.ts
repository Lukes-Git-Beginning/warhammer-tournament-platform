import { describe, it, expect } from 'vitest';
import {
  OPEN_PLAY_BLIND_PICK_TIMEOUT_MS,
  TOURNAMENT_BLIND_PICK_TIMEOUT_MS,
} from '../src/lib/blind-pick-auto-resolve.js';

/**
 * Regression: these two were once a single shared constant. Raising it to 5 min for the Open Play
 * (ladder) cancel-on-no-show behaviour wrongly extended the *tournament* deadline to 5 min too.
 * The ladder gets the longer, forgiving deadline (then cancel); a Blind Pick Tournament keeps the
 * stricter original deadline (then random-pick) so the bracket keeps moving.
 */
describe('blind-pick timeouts', () => {
  it('Open Play (ladder) = 5 min, Blind Pick Tournament = 2 min (stricter)', () => {
    expect(OPEN_PLAY_BLIND_PICK_TIMEOUT_MS).toBe(5 * 60 * 1000);
    expect(TOURNAMENT_BLIND_PICK_TIMEOUT_MS).toBe(2 * 60 * 1000);
    expect(TOURNAMENT_BLIND_PICK_TIMEOUT_MS).toBeLessThan(OPEN_PLAY_BLIND_PICK_TIMEOUT_MS);
  });
});
