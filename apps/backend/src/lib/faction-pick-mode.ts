import type { $Enums } from '@rizzotto/db';

/**
 * The faction step a match runs: its tournament's mode; an Open Play match's mode stamped at creation (pick_mode:
 * MATRIX for a 1v1 Bo3 in Land Battle or Conquest); else Open Play's blind pick (BPT, or BPT_2V2 for 2v2).
 */
export function factionPickMode(match: {
  tournament?: { mode: $Enums.TournamentMode } | null;
  pick_mode?: $Enums.TournamentMode | null;
  competitor_format?: $Enums.CompetitorFormat | null;
}): $Enums.TournamentMode {
  return match.tournament?.mode ?? match.pick_mode ?? (match.competitor_format === 'TWO_V_TWO' ? 'BPT_2V2' : 'BPT');
}
