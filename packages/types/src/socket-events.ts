// Typed Socket.io event contracts shared between backend emit helpers and frontend hooks.
// Populated in M1.3+. M1.1 stub establishes the shape.

import type { PublicDraftState } from './draft.js';

export type TournamentStatusLiteral =
  | 'DRAFT'
  | 'OPEN_REGISTRATION'
  | 'REGISTRATION_CLOSED'
  | 'ONGOING'
  | 'COMPLETED';

export type DraftStatusLiteralSocket = 'PENDING' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';

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
  // M4 Draft events
  draft_started: (payload: {
    draftId: string;
    matchId: string;
    presetId: string;
    turnSeconds: number;
    hostUserId: string;
    guestUserId: string;
  }) => void;
  turn_started: (payload: {
    draftId: string;
    turnIndex: number;
    actor: 'host' | 'guest' | 'admin';
    action: string;
    isHidden: boolean;
    isParallel: boolean;
    asOpponent: boolean;
    category: string;
    availableFactions: string[];
    timerExpiresAt: string;
  }) => void;
  action_committed: (payload: {
    draftId: string;
    turnIndex: number;
    actor: 'host' | 'guest' | 'admin' | 'system';
    action: string;
    factionId: string | null;
    isAutoSelected: boolean;
    isHiddenFromYou: boolean;
  }) => void;
  draft_state_sync: (payload: {
    draftId: string;
    state: PublicDraftState;
    currentTurn: number;
    timerExpiresAt: string | null;
    status: DraftStatusLiteralSocket;
  }) => void;
  draft_complete: (payload: {
    draftId: string;
    matchId: string;
    finalFactions: { host: string[]; guest: string[] };
  }) => void;
}

export interface ClientToServerEvents {
  join_tournament: (tournamentId: string) => void;
  leave_tournament: (tournamentId: string) => void;
  // M4 Draft events
  join_draft: (draftId: string) => void;
  leave_draft: (draftId: string) => void;
  watch_draft: (draftId: string) => void;
  draft_action: (payload: { draftId: string; factionId: string }) => void;
}

export interface InterServerEvents {
  // Reserved for future cross-instance events
}

export interface SocketData {
  userId: string;
  username: string;
}
