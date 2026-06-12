// 3×3 Faction Matrix — shared state type between backend and frontend.

export interface FactionMatrixState {
  gameId: string;
  matchId: string;
  topPlayerId: string;      // coin-flip winner — bans first
  bottomPlayerId: string;   // coin-flip loser — makes the final pick
  // Blind-pick phase
  p1Locked: boolean;        // match.player1_id has locked their 3 factions
  p2Locked: boolean;
  firstLockedAt: string | null;  // for frontend countdown timer
  revealedAt: string | null;     // set when both locked; factions visible from here
  // Factions: null/empty until reveal, then 3 IDs each
  p1Factions: string[];
  p2Factions: string[];
  // Ban/pick phase (active after reveal)
  bans: string[];               // "row,col" strings, e.g. ["0,1","2,2"]
  pickedCell: string | null;    // "row,col" of the chosen matchup
  lastActionAt: string | null;  // for 15s per-action countdown
  decidedAt: string | null;
  // Resolved factions after decidedAt
  p1FactionId: string | null;   // p1Factions[row] of pickedCell
  p2FactionId: string | null;   // p2Factions[col] of pickedCell
}
