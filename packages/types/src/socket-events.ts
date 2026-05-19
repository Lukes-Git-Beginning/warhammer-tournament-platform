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
  // M5 Beta: match report flow (Q4/Q12)
  match_reported: (payload: {
    tournamentId: string;
    matchId: string;
    reporterId: string;
    state: 'AWAITING_OPPONENT' | 'AGREED' | 'DISPUTED';
  }) => void;
  match_disputed: (payload: {
    tournamentId: string;
    matchId: string;
  }) => void;
  match_completed: (payload: {
    tournamentId: string;
    matchId: string;
    result: string;
    winnerId: string | null;
    nextMatchId: string | null;
  }) => void;
  // Q3 — Army-list lock
  'tournament:lists-locked': (payload: {
    tournament_id: string;
    locked_at: string;
    affected_participants: number;
  }) => void;
  // Welle 2 — Match-Decision flow
  'match.decision.started': (payload: {
    matchId: string;
    mode: 'RANDOM' | 'PICK_BAN';
    topPlayerId: string;
    bottomPlayerId: string;
    seed: string;
    pickedMapId?: string | null; // set immediately for RANDOM mode
  }) => void;
  'match.decision.update': (payload: {
    matchId: string;
    bansTop: string[];
    bansBottom: string[];
    pickedMapId: string | null;
    decidedAt: string | null;
  }) => void;
  'match.decision.complete': (payload: {
    matchId: string;
    pickedMapId: string;
    decidedAt: string;
  }) => void;
  'match.blind-pick.update': (payload: {
    matchId: string;
    player1Locked: boolean;
    player2Locked: boolean;
    revealedAt: string | null;
    player1FactionId: string | null; // null until reveal
    player2FactionId: string | null;
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
