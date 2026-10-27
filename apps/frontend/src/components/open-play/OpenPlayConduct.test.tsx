import { describe, it, expect } from 'vitest';
import { cooldownLabel, strikeDecay, strikeLadder, strikeOffences } from './OpenPlayConduct';

describe('Open Play code of conduct — the texts follow OPEN_PLAY_CONDUCT', () => {
  it('lists the strike ladder from a warning to an admin lift', () => {
    expect(strikeLadder()).toEqual([
      '1st strike: a warning by DM.',
      '2nd strike: no queueing for 1 hour.',
      '3rd strike: no queueing for 24 hours.',
      '4th strike: no queueing for 7 days.',
      '5th and every further strike: no queueing until an admin lifts it.',
    ]);
  });

  it('names both offences with their numbers, and the decay', () => {
    const [queue, pick] = strikeOffences();
    expect(queue).toContain('3 times within 24 hours, each within 5 minutes of joining');
    expect(pick).toContain('5 minutes after your opponent picked');
    expect(strikeDecay()).toBe('Every 7 days without a new strike, one strike is taken off.');
  });

  it('writes cooldowns in hours or whole days', () => {
    expect(cooldownLabel(1)).toBe('1 hour');
    expect(cooldownLabel(24)).toBe('24 hours');
    expect(cooldownLabel(168)).toBe('7 days');
  });
});
