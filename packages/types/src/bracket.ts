// Bracket-node types shared between backend pairing engine and frontend SVG renderer.
// Populated in M1.5/M1.8. M1.1 stub.

export interface BracketNode {
  matchId: string;
  round: number;
  matchNumber: number;
  player1Id: string | null;
  player2Id: string | null;
  winnerId: string | null;
  nextMatchId: string | null;
}
