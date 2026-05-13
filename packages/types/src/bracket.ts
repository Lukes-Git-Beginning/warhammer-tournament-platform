// Bracket-node types shared between backend pairing engine and frontend SVG renderer.

export interface BracketNode {
  matchId: string;
  round: number;
  matchNumber: number;
  player1Id: string | null;
  player2Id: string | null;
  winnerId: string | null;
  score: string | null;
  status: 'PENDING' | 'ONGOING' | 'COMPLETED' | 'BYE' | 'FORFEIT';
  nextMatchId: string | null;
  player1FactionId: string | null;
  player2FactionId: string | null;
  draft_id?: string | null;
  draft_status?: 'PENDING' | 'ONGOING' | 'COMPLETED' | 'CANCELLED' | null;
}

export interface SwissStandingEntry {
  userId: string;
  username: string | null;
  avatarUrl: string | null;
  score: number;
  wins: number;
  losses: number;
  draws: number;
  byes: number;
  buchholz: number;
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
  /** Present only for SWISS format tournaments */
  swiss?: SwissMeta;
}
