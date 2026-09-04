import type { Tournament } from './api';

// Tournament calendar-block duration: 30 minutes per game (Alex's heuristic), where
// "games" is the worst-case number the deepest player plays. Bo1 BaLi with 4 rounds
// + Top 4 = 4 swiss + 2 playoff = 6 games = 3h, which matches his reference example.

type Fmt = 'BO1' | 'BO2' | 'BO3' | 'BO5' | null | undefined;
const gamesPerMatch = (f: Fmt): number => (f === 'BO5' ? 5 : f === 'BO3' ? 3 : f === 'BO2' ? 2 : 1);

export interface DurationFields {
  format: string;
  rounds_count?: number | null;
  playoff_format?: string | null;
  swiss_match_format?: Fmt;
  playoff_match_format?: Fmt;
  finale_match_format?: Fmt;
  /** Field size (for elimination / round-robin, where rounds depend on it). */
  participants?: number;
}

/** Worst-case games the deepest player plays — the tournament runs about this long. */
export function estimateTournamentGames(t: DurationFields): number {
  const swiss = gamesPerMatch(t.swiss_match_format);
  const playoff = gamesPerMatch(t.playoff_match_format);
  const finale = gamesPerMatch(t.finale_match_format);
  // Playoff rounds a finalist plays: TOP2 = final (1), TOP4 = semi+final (2), TOP8 = quarter+semi+final (3).
  const playoffExtra =
    t.playoff_format === 'TOP2'
      ? finale
      : t.playoff_format === 'TOP4'
        ? playoff + finale
        : t.playoff_format === 'TOP8'
          ? 2 * playoff + finale
          : 0;
  const p = Math.max(2, t.participants ?? 8);
  switch (t.format) {
    case 'SWISS':
    case 'AUTO_SWISS':
    case 'LIECHTENSTEIN':
    case 'BALANCED_LIECHTENSTEIN':
      return (t.rounds_count ?? 4) * swiss + playoffExtra;
    case 'ROUND_ROBIN':
      return (p - 1) * swiss + playoffExtra;
    case 'SINGLE_ELIMINATION':
      return Math.ceil(Math.log2(p)) * swiss;
    case 'DOUBLE_ELIMINATION':
      return 2 * Math.ceil(Math.log2(p)) * swiss;
    default:
      return (t.rounds_count ?? 4) * swiss;
  }
}

/** Calendar block length in whole hours: 30 min per game, rounded up, minimum 1h. */
export function estimateDurationHours(t: DurationFields): number {
  return Math.max(1, Math.ceil(estimateTournamentGames(t) * 0.5));
}

/** Duration for an existing Tournament object (uses its participant count). */
export function tournamentDurationHours(t: Tournament): number {
  return estimateDurationHours({
    format: t.format,
    rounds_count: t.rounds_count,
    playoff_format: t.playoff_format,
    swiss_match_format: t.swiss_match_format,
    playoff_match_format: t.playoff_match_format,
    finale_match_format: t.finale_match_format,
    participants: t.participantCount,
  });
}

/** Do two [start, start+hours) intervals overlap? */
export function intervalsOverlap(aStart: Date, aHours: number, bStart: Date, bHours: number): boolean {
  const aEnd = aStart.getTime() + aHours * 3_600_000;
  const bEnd = bStart.getTime() + bHours * 3_600_000;
  return aStart.getTime() < bEnd && bStart.getTime() < aEnd;
}

/** "Name (Sat 13 Sep, 18:00)" — for clash warnings, since a clash can fall outside the visible week. */
export function describeClash(t: { name: string; start: Date }): string {
  const when = t.start.toLocaleString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${t.name} (${when})`;
}
