import { describe, expect, it } from 'vitest';
import {
  parseQueuePrefs,
  findCompatiblePair,
  compatiblePairings,
  resolveQueueFormat,
  buildOffers,
  encodeOffer,
  decodeOffer,
  offerLabel,
  offerBullet,
  type QueueEntry,
  type QueueMatchFormat,
} from '../src/lib/matchmaking-tick.js';

const BOTH: QueueMatchFormat[] = ['BO1', 'BO3'];

describe('parseQueuePrefs', () => {
  it('defaults to 1v1 across all battle types and both formats for missing/invalid input', () => {
    for (const raw of [null, undefined, 'not json', '{}', '{"battleTypes":[]}']) {
      expect(parseQueuePrefs(raw)).toEqual({
        format: 'ONE_V_ONE',
        battleTypes: ['DOMINATION', 'CONQUEST', 'SIEGE'],
        matchFormats: ['BO1', 'BO3'],
      });
    }
  });

  it('keeps a valid selection and drops unknown battle types / formats', () => {
    expect(
      parseQueuePrefs('{"format":"ONE_V_ONE","battleTypes":["SIEGE","BOGUS","CONQUEST"],"matchFormats":["BO3","BO5"]}'),
    ).toEqual({ format: 'ONE_V_ONE', battleTypes: ['SIEGE', 'CONQUEST'], matchFormats: ['BO3'] });
  });

  it('treats legacy entries without matchFormats as accepting both formats', () => {
    expect(parseQueuePrefs('{"format":"ONE_V_ONE","battleTypes":["DOMINATION"]}').matchFormats).toEqual(BOTH);
  });

  it('preserves the team-size format', () => {
    expect(parseQueuePrefs('{"format":"TWO_V_TWO","battleTypes":["DOMINATION"]}').format).toBe('TWO_V_TWO');
  });
});

describe('resolveQueueFormat', () => {
  it('needs a shared format', () => {
    expect(resolveQueueFormat(['BO1'], ['BO3'])).toBeNull();
  });
  it('picks the single shared format', () => {
    expect(resolveQueueFormat(['BO3'], BOTH)).toBe('BO3');
    expect(resolveQueueFormat(BOTH, ['BO1'])).toBe('BO1');
  });
  it('resolves to Bo1 when both formats are shared', () => {
    expect(resolveQueueFormat(BOTH, BOTH)).toBe('BO1');
  });
});

describe('findCompatiblePair', () => {
  const e = (
    id: string,
    format: 'ONE_V_ONE' | 'TWO_V_TWO',
    battleTypes: string[],
    matchFormats: QueueMatchFormat[] = BOTH,
  ): QueueEntry => ({
    id,
    prefs: { format, battleTypes: battleTypes as QueueEntry['prefs']['battleTypes'], matchFormats },
  });

  it('returns null with fewer than two entries', () => {
    expect(findCompatiblePair([])).toBeNull();
    expect(findCompatiblePair([e('a', 'ONE_V_ONE', ['DOMINATION'])])).toBeNull();
  });

  it('pairs the oldest two when battle types overlap (both formats shared -> Bo1)', () => {
    const pair = findCompatiblePair([
      e('a', 'ONE_V_ONE', ['DOMINATION']),
      e('b', 'ONE_V_ONE', ['DOMINATION', 'SIEGE']),
    ]);
    expect(pair).toEqual({ a: 'a', b: 'b', battleType: 'DOMINATION', format: 'ONE_V_ONE', matchFormat: 'BO1' });
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
    expect(pair).toMatchObject({ a: 'a', b: 'c', battleType: 'SIEGE', format: 'ONE_V_ONE' });
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
    expect(pair).toMatchObject({ a: 't1', b: 't2', battleType: 'SIEGE', format: 'TWO_V_TWO' });
  });

  it('does not pair players whose formats are disjoint', () => {
    expect(
      findCompatiblePair([e('a', 'ONE_V_ONE', ['DOMINATION'], ['BO1']), e('b', 'ONE_V_ONE', ['DOMINATION'], ['BO3'])]),
    ).toBeNull();
  });

  it('plays the single shared format when only one is common', () => {
    expect(
      findCompatiblePair([e('a', 'ONE_V_ONE', ['CONQUEST'], ['BO3']), e('b', 'ONE_V_ONE', ['CONQUEST'], BOTH)]),
    ).toMatchObject({ battleType: 'CONQUEST', matchFormat: 'BO3' });
  });

  it('Siege ignores the format selection and is always Bo2', () => {
    expect(
      findCompatiblePair([e('a', 'ONE_V_ONE', ['SIEGE'], ['BO1']), e('b', 'ONE_V_ONE', ['SIEGE'], ['BO3'])]),
    ).toMatchObject({ battleType: 'SIEGE', matchFormat: 'BO2' });
  });

  it('falls through to Siege when the non-Siege formats are disjoint', () => {
    const pair = findCompatiblePair([
      e('a', 'ONE_V_ONE', ['DOMINATION', 'SIEGE'], ['BO1']),
      e('b', 'ONE_V_ONE', ['DOMINATION', 'SIEGE'], ['BO3']),
    ]);
    expect(pair).toMatchObject({ battleType: 'SIEGE', matchFormat: 'BO2' });
  });
});

describe('compatiblePairings / buildOffers', () => {
  const prefs = (format: 'ONE_V_ONE' | 'TWO_V_TWO', battleTypes: string[], matchFormats: QueueMatchFormat[] = BOTH) => ({
    format,
    battleTypes: battleTypes as QueueEntry['prefs']['battleTypes'],
    matchFormats,
  });

  it('lists every shared (battle type, format) in the first side’s order', () => {
    expect(
      compatiblePairings(prefs('ONE_V_ONE', ['CONQUEST', 'SIEGE', 'DOMINATION']), prefs('ONE_V_ONE', ['DOMINATION', 'SIEGE', 'CONQUEST'], ['BO3'])),
    ).toEqual([
      { battleType: 'CONQUEST', matchFormat: 'BO3' },
      { battleType: 'SIEGE', matchFormat: 'BO2' },
      { battleType: 'DOMINATION', matchFormat: 'BO3' },
    ]);
  });

  it('builds de-duplicated offers from the waiting entries', () => {
    const waiting: QueueEntry[] = [
      { id: 'w1', prefs: prefs('ONE_V_ONE', ['CONQUEST']) },
      { id: 'w2', prefs: prefs('ONE_V_ONE', ['CONQUEST', 'SIEGE']) },
      { id: 'w3', prefs: prefs('ONE_V_ONE', ['DOMINATION'], ['BO3']) },
      { id: 't1', prefs: prefs('TWO_V_TWO', ['DOMINATION']) },
    ];
    const offers = buildOffers(prefs('ONE_V_ONE', ['DOMINATION', 'CONQUEST', 'SIEGE']), waiting);
    expect(offers.map(offerBullet)).toEqual([
      'Conquest · 1v1 · Bo1',
      'Siege · 1v1 · Bo2',
      'Domination · 1v1 · Bo3',
    ]);
  });

  it('offers nothing when the recipient’s settings fit no waiting entry', () => {
    const waiting: QueueEntry[] = [{ id: 'w1', prefs: prefs('ONE_V_ONE', ['CONQUEST'], ['BO1']) }];
    expect(buildOffers(prefs('ONE_V_ONE', ['CONQUEST'], ['BO3']), waiting)).toEqual([]);
    expect(buildOffers(prefs('TWO_V_TWO', ['CONQUEST']), waiting)).toEqual([]);
  });

  it('labels offers by team size', () => {
    const offers = buildOffers(prefs('TWO_V_TWO', ['CONQUEST']), [{ id: 't', prefs: prefs('TWO_V_TWO', ['CONQUEST']) }]);
    expect(offers.map(offerLabel)).toEqual(['Conquest 2v2 Bo1']);
  });

  it('round-trips offers through the compact button id', () => {
    for (const o of [
      { battleType: 'CONQUEST', size: 1, matchFormat: 'BO1' },
      { battleType: 'SIEGE', size: 2, matchFormat: 'BO2' },
      { battleType: 'DOMINATION', size: 1, matchFormat: 'BO3' },
    ] as const) {
      const id = `av_offer:123456789012345678:${encodeOffer(o)}`;
      expect(id.length).toBeLessThan(100);
      expect(decodeOffer(id.split(':').slice(2))).toEqual(o);
    }
    expect(decodeOffer(['X', '1', '1'])).toBeNull();
    expect(decodeOffer(['C', '9', '1'])).toBeNull();
  });
});
