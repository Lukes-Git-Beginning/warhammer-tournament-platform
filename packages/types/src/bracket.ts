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
}

export interface BracketResponse {
  tournamentId: string;
  rounds: number;
  matches: BracketNode[];
}
