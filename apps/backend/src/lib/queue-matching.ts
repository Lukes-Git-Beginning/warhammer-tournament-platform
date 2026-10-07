// Pure Open Play queue matching rules (no Redis / DB) — shared by the matchmaking tick, the queue
// routes and the Discord availability offers.

export const ALL_BATTLE_TYPES = ['DOMINATION', 'CONQUEST', 'SIEGE'] as const;
export type QueueBattleType = (typeof ALL_BATTLE_TYPES)[number];
export type QueueCompetitorFormat = 'ONE_V_ONE' | 'TWO_V_TWO';
/** Series lengths a player can ask for in Open Play (Bo5 is not offered). */
export const ALL_QUEUE_MATCH_FORMATS = ['BO1', 'BO3'] as const;
export type QueueMatchFormat = (typeof ALL_QUEUE_MATCH_FORMATS)[number];
/** Series length an Open Play queue match can end up with. Siege is always Bo2. */
export type QueueSeriesFormat = 'BO1' | 'BO2' | 'BO3';

export interface QueuePrefs {
  format: QueueCompetitorFormat;
  battleTypes: QueueBattleType[];
  /** Series lengths accepted. Ignored for Siege (always Bo2). */
  matchFormats: QueueMatchFormat[];
}

export interface QueueEntry {
  id: string;
  prefs: QueuePrefs;
}

/** What a pair of queuers can play together: one battle type + the resulting series length. */
export interface QueuePairing {
  battleType: QueueBattleType;
  matchFormat: QueueSeriesFormat;
}

function filterKnown<T extends string>(value: unknown, known: readonly T[]): T[] {
  return Array.isArray(value) ? value.filter((v): v is T => (known as readonly string[]).includes(v as string)) : [];
}

/** Parse a stored prefs value; a missing/invalid one defaults to 1v1 across all battle types
 *  and both series lengths (so legacy joins still match anyone). */
export function parseQueuePrefs(raw: string | null | undefined): QueuePrefs {
  if (raw) {
    try {
      const p = JSON.parse(raw) as { format?: unknown; battleTypes?: unknown; matchFormats?: unknown };
      const format: QueueCompetitorFormat = p.format === 'TWO_V_TWO' ? 'TWO_V_TWO' : 'ONE_V_ONE';
      const battleTypes = filterKnown(p.battleTypes, ALL_BATTLE_TYPES);
      const matchFormats = filterKnown(p.matchFormats, ALL_QUEUE_MATCH_FORMATS);
      if (battleTypes.length > 0) {
        return {
          format,
          battleTypes,
          matchFormats: matchFormats.length > 0 ? matchFormats : [...ALL_QUEUE_MATCH_FORMATS],
        };
      }
    } catch {
      /* fall through to default */
    }
  }
  return { format: 'ONE_V_ONE', battleTypes: [...ALL_BATTLE_TYPES], matchFormats: [...ALL_QUEUE_MATCH_FORMATS] };
}

/**
 * Series length two format selections agree on: the intersection must be non-empty, and when it
 * holds both Bo1 and Bo3 the match is Bo1 (queue health). Null = no common format.
 */
export function resolveQueueFormat(
  a: readonly QueueMatchFormat[],
  b: readonly QueueMatchFormat[],
): QueueMatchFormat | null {
  const common = a.filter((f) => b.includes(f));
  if (common.length === 0) return null;
  return common.includes('BO1') ? 'BO1' : common[0]!;
}

/**
 * Every battle type + series length two queuers can play, in `a`'s battle-type order. Empty when
 * the team sizes differ. Siege ignores the format selections and is always Bo2; every other
 * battle type needs a shared format.
 */
export function compatiblePairings(a: QueuePrefs, b: QueuePrefs): QueuePairing[] {
  if (a.format !== b.format) return [];
  const out: QueuePairing[] = [];
  for (const battleType of a.battleTypes) {
    if (!b.battleTypes.includes(battleType)) continue;
    if (battleType === 'SIEGE') {
      out.push({ battleType, matchFormat: 'BO2' });
      continue;
    }
    const f = resolveQueueFormat(a.matchFormats, b.matchFormats);
    if (f) out.push({ battleType, matchFormat: f });
  }
  return out;
}

/**
 * FIFO-fair compatible pairing: the oldest queuer is matched with the earliest later queuer
 * they can play with (same team size, overlapping battle types and formats). The chosen battle
 * type is the oldest queuer's first preference that works for both.
 */
export function findCompatiblePair(entries: QueueEntry[]): {
  a: string;
  b: string;
  battleType: QueueBattleType;
  format: QueueCompetitorFormat;
  matchFormat: QueueSeriesFormat;
} | null {
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      const A = entries[i]!;
      const B = entries[j]!;
      const pairing = compatiblePairings(A.prefs, B.prefs)[0];
      if (pairing) {
        return {
          a: A.id,
          b: B.id,
          battleType: pairing.battleType,
          format: A.prefs.format,
          matchFormat: pairing.matchFormat,
        };
      }
    }
  }
  return null;
}

/** An availability-DM offer: a waiting match the recipient could join right now (no names). */
export interface QueueOffer {
  battleType: QueueBattleType;
  size: 1 | 2;
  matchFormat: QueueSeriesFormat;
}

/**
 * The distinct offers a recipient with `prefs` gets from the currently waiting entries: one per
 * (battle type, team size, series length) that at least one waiting entry can play with them.
 */
export function buildOffers(prefs: QueuePrefs, waiting: QueueEntry[]): QueueOffer[] {
  const seen = new Set<string>();
  const offers: QueueOffer[] = [];
  const size: 1 | 2 = prefs.format === 'TWO_V_TWO' ? 2 : 1;
  for (const entry of waiting) {
    for (const p of compatiblePairings(prefs, entry.prefs)) {
      const key = `${p.battleType}:${p.matchFormat}`;
      if (seen.has(key)) continue;
      seen.add(key);
      offers.push({ battleType: p.battleType, size, matchFormat: p.matchFormat });
    }
  }
  return offers;
}

const BT_LABEL: Record<QueueBattleType, string> = { DOMINATION: 'Domination', CONQUEST: 'Conquest', SIEGE: 'Siege' };
const BT_CODE: Record<QueueBattleType, string> = { DOMINATION: 'D', CONQUEST: 'C', SIEGE: 'S' };
const FORMAT_LABEL: Record<QueueSeriesFormat, string> = { BO1: 'Bo1', BO2: 'Bo2', BO3: 'Bo3' };

/** "Conquest 1v1 Bo1" — used for the offer button label; the DM bullet adds separators. */
export function offerLabel(o: QueueOffer): string {
  return `${BT_LABEL[o.battleType]} ${o.size}v${o.size} ${FORMAT_LABEL[o.matchFormat]}`;
}

export function offerBullet(o: QueueOffer): string {
  return `${BT_LABEL[o.battleType]} · ${o.size}v${o.size} · ${FORMAT_LABEL[o.matchFormat]}`;
}

/** Compact Discord custom-id tail for an offer: `<battle type letter>:<format digit>:<size>`. */
export function encodeOffer(o: QueueOffer): string {
  return `${BT_CODE[o.battleType]}:${o.matchFormat.slice(2)}:${o.size}`;
}

export function decodeOffer(parts: readonly (string | undefined)[]): QueueOffer | null {
  const [bt, fmt, size] = parts;
  const battleType = (ALL_BATTLE_TYPES as readonly QueueBattleType[]).find((b) => BT_CODE[b] === bt);
  const matchFormat = (['BO1', 'BO2', 'BO3'] as const).find((f) => f.slice(2) === fmt);
  if (!battleType || !matchFormat || (size !== '1' && size !== '2')) return null;
  return { battleType, matchFormat, size: size === '2' ? 2 : 1 };
}
