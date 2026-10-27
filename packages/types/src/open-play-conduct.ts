/**
 * Open Play's automatic penalties, shared so the code of conduct on the site (Open Play, How to Play)
 * shows exactly what the backend enforces (lib/queue-penalty.ts, lib/blind-pick-auto-resolve.ts).
 *
 * Two offences give a strike, and they share one record:
 *  · leaving the queue soon after joining, several times within a rolling window (queue ghosting);
 *  · not picking a faction in an Open Play match before the deadline (the match is cancelled).
 * Each strike raises the level by one; the level drops by one per clean `decayDays`.
 */
export const OPEN_PLAY_CONDUCT = {
  /** Leaving the queue within this many minutes of joining counts as a short stint. */
  shortStintMinutes: 5,
  /** This many short stints within the window give one strike. */
  shortStintsPerStrike: 3,
  /** Rolling window for the short stints, in hours. */
  shortStintWindowHours: 24,
  /**
   * Minutes to pick a faction: after the opponent picked, or after the match was created when
   * neither has. Then the match is cancelled and whoever hasn't picked gets a strike.
   */
  pickDeadlineMinutes: 5,
  /** One level is forgiven per this many days without a strike. */
  decayDays: 7,
  /**
   * Queue cooldown in hours for strike level 1, 2, 3, …; 0 = a warning only, null = until an admin
   * lifts it. The last entry applies to every higher level.
   */
  cooldownHoursByLevel: [0, 1, 24, 7 * 24, null] as readonly (number | null)[],
} as const;

/** The cooldown for a strike level (1-based), in hours: 0 = warning only, null = until an admin lifts it. */
export function openPlayCooldownHours(level: number): number | null {
  const ladder = OPEN_PLAY_CONDUCT.cooldownHoursByLevel;
  if (level < 1) return 0;
  return ladder[Math.min(level, ladder.length) - 1] ?? null;
}
