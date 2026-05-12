// Typed Socket.io event contracts shared between backend emit helpers and frontend hooks.
// Populated in M1.3+. M1.1 stub establishes the shape.

export type TournamentStatusLiteral =
  | 'DRAFT'
  | 'OPEN_REGISTRATION'
  | 'REGISTRATION_CLOSED'
  | 'ONGOING'
  | 'COMPLETED';

export interface ServerToClientEvents {
  bracket_update: (payload: { tournamentId: string }) => void;
  match_result: (payload: {
    tournamentId: string;
    matchId: string;
    winnerId: string | null;
    score: string | null;
    nextMatchId: string | null;
  }) => void;
  tournament_status_change: (payload: {
    tournamentId: string;
    status: TournamentStatusLiteral;
  }) => void;
  participant_change: (payload: {
    tournamentId: string;
    userId: string;
    action: 'registered' | 'withdrew' | 'checked_in' | 'disqualified';
  }) => void;
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
