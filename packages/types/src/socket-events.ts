// Typed Socket.io event contracts shared between backend emit helpers and frontend hooks.
// Populated in M1.3+. M1.1 stub establishes the shape.

export interface ServerToClientEvents {
  bracket_update: (payload: { tournamentId: string }) => void;
  match_result: (payload: { matchId: string; winnerId: string; score: string }) => void;
  tournament_status_change: (payload: { tournamentId: string; status: string }) => void;
}

export interface ClientToServerEvents {
  join_tournament: (tournamentId: string) => void;
  leave_tournament: (tournamentId: string) => void;
}

export interface InterServerEvents {
  // Reserved for future cross-instance events
}

export interface SocketData {
  userId: string;
  username: string;
}
