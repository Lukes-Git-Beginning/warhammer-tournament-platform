// Bracket-node types shared between backend pairing engine and frontend SVG renderer.

import type { MatchResultType } from './match.js';

export interface BracketNode {
  matchId: string;
  round: number;
  matchNumber: number;
  player1Id: string | null;
  player2Id: string | null;
  winnerId: string | null;
  score: string | null;
  result: MatchResultType | null;
  player1Points: number | null;
  player2Points: number | null;
  status:
    | 'PENDING'
    | 'ONGOING'
    | 'COMPLETED'
    | 'BYE'
    | 'FORFEIT'
    | 'DISPUTED'
    | 'CANCELLED'
    | 'CATCHUP_BYE'
    | 'PENDING_BYE';
  nextMatchId: string | null;
  loserNextMatchId: string | null;
  bracketSide: 'WINNERS' | 'LOSERS' | 'GRAND_FINAL' | null;
  player1FactionId: string | null;
  player2FactionId: string | null;
  matchFormat?: string | null;
  player1GameWins: number;
  player2GameWins: number;
  pickedMapId?: string | null;
  draft_id?: string | null;
  draft_status?: 'PENDING' | 'ONGOING' | 'COMPLETED' | 'CANCELLED' | null;
  phase?: 'SWISS' | 'PLAYOFF_QF' | 'PLAYOFF_SF' | 'PLAYOFF_FINAL' | 'PLAYOFF_THIRD_PLACE' | null;
  /** Set when a player in this match has withdrawn; drives the "opponent withdrew" banner. */
  withdrawnPlayerId?: string | null;
}

export interface SwissStandingEntry {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  factionId: string | null;
  score: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  gamesLost: number;
  buchholz: number;
  solkoff: number;
  /** True when this player withdrew mid-tournament (FORFEIT loss) */
  dropped?: boolean;
  /** Skill division 1..5 (BALANCED_LIECHTENSTEIN only) — drives level colouring. */
  skillBand?: number | null;
}

export interface SwissMeta {
  recommendedRounds: number;
  currentRound: number;
  standings: SwissStandingEntry[];
}

export interface BracketResponse {
  tournamentId: string;
  rounds: number;
  matches: BracketNode[];
  /** Tournament mode (e.g. 'SFT', 'ONE_V_ONE', 'BPT') — drives conditional UI like faction column */
  mode?: string;
  /** Tournament status — used to gate placement badges */
  status?: string;
  /** Present only for SWISS format tournaments */
  swiss?: SwissMeta;
}
