import { describe, expect, it } from 'vitest';
import { isNarrowQueueSelection, toggleAtLeastOne, DEFAULT_QUEUE_PREFS } from './queue-prefs';

describe('isNarrowQueueSelection', () => {
  it('flags exactly one non-Siege battle type with exactly one format', () => {
    expect(isNarrowQueueSelection(['CONQUEST'], ['BO3'])).toBe(true);
    expect(isNarrowQueueSelection(['DOMINATION'], ['BO1'])).toBe(true);
  });

  it('does not flag Siege-only (always Bo2, the format does not matter)', () => {
    expect(isNarrowQueueSelection(['SIEGE'], ['BO1'])).toBe(false);
    expect(isNarrowQueueSelection(['SIEGE'], ['BO1', 'BO3'])).toBe(false);
  });

  it('does not flag broader selections', () => {
    expect(isNarrowQueueSelection(['CONQUEST'], ['BO1', 'BO3'])).toBe(false);
    expect(isNarrowQueueSelection(['CONQUEST', 'SIEGE'], ['BO1'])).toBe(false);
    expect(isNarrowQueueSelection(DEFAULT_QUEUE_PREFS.battleTypes, DEFAULT_QUEUE_PREFS.matchFormats)).toBe(false);
  });
});

describe('toggleAtLeastOne', () => {
  it('adds and removes values but never empties the list', () => {
    expect(toggleAtLeastOne(['BO1'], 'BO3')).toEqual(['BO1', 'BO3']);
    expect(toggleAtLeastOne(['BO1', 'BO3'], 'BO1')).toEqual(['BO3']);
    expect(toggleAtLeastOne(['BO3'], 'BO3')).toEqual(['BO3']);
  });
});
