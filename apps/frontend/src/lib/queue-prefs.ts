import type { BattleType, QueueMatchFormat, QueuePrefs } from './api';

/** What a brand-new player (no stored settings yet) queues with. */
export const DEFAULT_QUEUE_PREFS: QueuePrefs = {
  battleTypes: ['DOMINATION', 'CONQUEST', 'SIEGE'],
  matchFormats: ['BO1', 'BO3'],
  competitorFormat: 'ONE_V_ONE',
  teamId: null,
};

export const NARROW_SELECTION_HINT = 'Very narrow selection: it may take longer to find a match.';

/**
 * True when the selection is so narrow that matches will be rare: exactly one battle type (not
 * Siege, which ignores the format and is always Bo2) AND exactly one series length.
 */
export function isNarrowQueueSelection(battleTypes: readonly BattleType[], matchFormats: readonly QueueMatchFormat[]): boolean {
  return battleTypes.length === 1 && battleTypes[0] !== 'SIEGE' && matchFormats.length === 1;
}

/** Toggle one entry of a multi-select that must keep at least one value. */
export function toggleAtLeastOne<T>(list: readonly T[], value: T): T[] {
  if (list.includes(value)) return list.length > 1 ? list.filter((x) => x !== value) : [...list];
  return [...list, value];
}
