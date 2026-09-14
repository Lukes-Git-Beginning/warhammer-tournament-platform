import { describe, expect, it } from 'vitest';
import { parseQueuePrefs, findCompatiblePair, type QueueEntry } from '../src/lib/matchmaking-tick.js';

describe('parseQueuePrefs', () => {
  it('defaults to 1v1 across all battle types for missing/invalid input', () => {
    for (const raw of [null, undefined, 'not json', '{}', '{"battleTypes":[]}']) {
      expect(parseQueuePrefs(raw)).toEqual({
        format: 'ONE_V_ONE',
        battleTypes: ['DOMINATION', 'CONQUEST', 'SIEGE'],
      });
    }
  });

  it('keeps a valid selection and drops unknown battle types', () => {
    expect(parseQueuePrefs('{"format":"ONE_V_ONE","battleTypes":["SIEGE","BOGUS","CONQUEST"]}')).toEqual({
      format: 'ONE_V_ONE',
      battleTypes: ['SIEGE', 'CONQUEST'],
    });
  });

  it('preserves the team-size format', () => {
    expect(parseQueuePrefs('{"format":"TWO_V_TWO","battleTypes":["DOMINATION"]}').format).toBe('TWO_V_TWO');
  });
});

describe('findCompatiblePair', () => {
  const e = (id: string, format: 'ONE_V_ONE' | 'TWO_V_TWO', battleTypes: string[]): QueueEntry => ({
    id,
    prefs: { format, battleTypes: battleTypes as QueueEntry['prefs']['battleTypes'] },
  });

  it('returns null with fewer than two entries', () => {
    expect(findCompatiblePair([])).toBeNull();
    expect(findCompatiblePair([e('a', 'ONE_V_ONE', ['DOMINATION'])])).toBeNull();
  });

  it('pairs the oldest two when battle types overlap', () => {
    const pair = findCompatiblePair([
      e('a', 'ONE_V_ONE', ['DOMINATION']),
      e('b', 'ONE_V_ONE', ['DOMINATION', 'SIEGE']),
    ]);
    expect(pair).toEqual({ a: 'a', b: 'b', battleType: 'DOMINATION', format: 'ONE_V_ONE' });
  });

  it('never pairs across team sizes', () => {
    expect(
      findCompatiblePair([e('a', 'ONE_V_ONE', ['DOMINATION']), e('b', 'TWO_V_TWO', ['DOMINATION'])]),
    ).toBeNull();
  });

  it('skips a non-overlapping neighbour and matches the next compatible one (FIFO)', () => {
    const pair = findCompatiblePair([
      e('a', 'ONE_V_ONE', ['SIEGE']),
      e('b', 'ONE_V_ONE', ['DOMINATION']),
      e('c', 'ONE_V_ONE', ['SIEGE', 'CONQUEST']),
    ]);
    // a (SIEGE) can't play b (DOMINATION) but can play c (SIEGE) — a stays oldest.
    expect(pair).toEqual({ a: 'a', b: 'c', battleType: 'SIEGE', format: 'ONE_V_ONE' });
  });

  it('uses the oldest queuer’s preference order for the chosen battle type', () => {
    const pair = findCompatiblePair([
      e('a', 'ONE_V_ONE', ['CONQUEST', 'DOMINATION']),
      e('b', 'ONE_V_ONE', ['DOMINATION', 'CONQUEST']),
    ]);
    expect(pair?.battleType).toBe('CONQUEST'); // a's first shared preference
  });

  it('returns null when no pair overlaps', () => {
    expect(
      findCompatiblePair([e('a', 'ONE_V_ONE', ['SIEGE']), e('b', 'ONE_V_ONE', ['DOMINATION'])]),
    ).toBeNull();
  });

  it('pairs two 2v2 teams and reports the 2v2 format', () => {
    const pair = findCompatiblePair([
      e('t1', 'TWO_V_TWO', ['DOMINATION', 'SIEGE']),
      e('t2', 'TWO_V_TWO', ['SIEGE']),
    ]);
    expect(pair).toEqual({ a: 't1', b: 't2', battleType: 'SIEGE', format: 'TWO_V_TWO' });
  });
});
