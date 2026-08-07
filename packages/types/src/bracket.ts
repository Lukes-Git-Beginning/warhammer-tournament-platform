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

/** One projected playoff bracket (a division for BaLi; a single bracket for other formats). */
export interface ProjectedDivision {
  size: number;
  format: 'NONE' | 'TOP2' | 'TOP4' | 'TOP8';
}

/**
 * The projected bracket structure for the CURRENT active field — how many group rounds and what
 * playoff shape are planned. Deterministic (same sizing rules as real generation) and recomputed
 * on every fetch, so the UI can show the full plan as placeholders that reshape on drops/joins.
 */
export interface BracketPlan {
  groupRounds: number;
  divisions: ProjectedDivision[];
}

/** One player reference in the playoff preview (host force tool). */
export interface PlayoffPreviewPlayer {
  userId: string;
  username: string;
}

/**
 * A real, seeded division in the Balanced Liechtenstein playoff preview — the host-force view.
 * Unlike ProjectedDivision (shape only) this carries the actual current seeds + a readiness verdict
 * so the host can force-generate a single division early, with a warning listing what still blocks it.
 */
export interface PlayoffPreviewDivision {
  /** The pool's own skill band (its identity for a force request). */
  band: number;
  size: number;
  format: 'NONE' | 'TOP2' | 'TOP4' | 'TOP8';
  /** Current seeds, best first (may still shift while blockers remain). */
  seeds: PlayoffPreviewPlayer[];
  /** True once every band this division draws from is complete → it would auto-generate. */
  ready: boolean;
  /** True once this division's bracket already exists (nothing left to force). */
  alreadyGenerated: boolean;
  /** Contenders in the spanned bands who are still playing — forcing now freezes seeding without them. */
  blockers: PlayoffPreviewPlayer[];
}

/** Response of GET /api/tournaments/:id/balanced-playoff-preview (host tool). */
export interface PlayoffPreview {
  divisions: PlayoffPreviewDivision[];
}

export interface SwissMeta {
  recommendedRounds: number;
  currentRound: number;
  standings: SwissStandingEntry[];
  /** Present for round-based formats — projected round count + playoff shape (placeholders). */
  plan?: BracketPlan;
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
