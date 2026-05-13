/**
 * Draft-Emit helpers — pure I/O functions, no DB/Redis.
 *
 * Hidden-masking strategy:
 *   - host/guest: sees own hidden arrays, opponent's hidden replaced with
 *     placeholders of equal length ('?')
 *   - spectator: sees neither side's hidden arrays
 */
import type { AppIOServer } from '../plugins/socket.js';
import type { DraftState, PublicDraftState } from '@tww3/types';

// ---------------------------------------------------------------------------
// Room helpers
// ---------------------------------------------------------------------------

export function draftRoom(draftId: string): string {
  return `draft_${draftId}`;
}

export function draftPlayerRoom(draftId: string, userId: string): string {
  return `draft_${draftId}:player_${userId}`;
}

export function draftSpectatorRoom(draftId: string): string {
  return `draft_${draftId}:spec`;
}

// ---------------------------------------------------------------------------
// Hidden masking
// ---------------------------------------------------------------------------

/**
 * Returns a DraftState view appropriate for the given viewer.
 * Opponent's hidden_picks / hidden_bans are replaced with arrays of '?'
 * (one per hidden entry) so the viewer knows HOW MANY are hidden, not what.
 */
export function maskStateForViewer(
  state: DraftState,
  viewer: 'host' | 'guest' | 'spectator',
): PublicDraftState {
  if (viewer === 'spectator') {
    return {
      ...state,
      hidden_picks: { host: [], guest: [] },
      hidden_bans: { host: [], guest: [] },
      hidden_pick_variants: { host: [], guest: [] },
      hidden_ban_variants: { host: [], guest: [] },
    };
  }

  const opp: 'host' | 'guest' = viewer === 'host' ? 'guest' : 'host';

  // Replace opponent's hidden picks with '?' placeholders
  const maskedHiddenPicks = {
    [viewer]: state.hidden_picks[viewer],
    [opp]: state.hidden_picks[opp].map(() => '?'),
  } as { host: string[]; guest: string[] };

  const maskedHiddenBans = {
    [viewer]: state.hidden_bans[viewer],
    [opp]: state.hidden_bans[opp].map(() => '?'),
  } as { host: string[]; guest: string[] };

  // Mask variant arrays too (opponent's variants are meaningless to them anyway)
  const maskedHiddenPickVariants = {
    [viewer]: state.hidden_pick_variants[viewer],
    [opp]: state.hidden_pick_variants[opp].map(() => '?'),
  } as { host: string[]; guest: string[] };

  const maskedHiddenBanVariants = {
    [viewer]: state.hidden_ban_variants[viewer],
    [opp]: state.hidden_ban_variants[opp].map(() => '?'),
  } as { host: string[]; guest: string[] };

  return {
    ...state,
    hidden_picks: maskedHiddenPicks,
    hidden_bans: maskedHiddenBans,
    hidden_pick_variants: maskedHiddenPickVariants,
    hidden_ban_variants: maskedHiddenBanVariants,
  };
}

// ---------------------------------------------------------------------------
// Emit functions
// ---------------------------------------------------------------------------

export interface DraftStartedPayload {
  draftId: string;
  matchId: string;
  presetId: string;
  turnSeconds: number;
  hostUserId: string;
  guestUserId: string;
}

export function emitDraftStarted(
  io: AppIOServer | undefined,
  draftId: string,
  hostUserId: string,
  guestUserId: string,
  payload: DraftStartedPayload,
): void {
  if (!io) return;
  io.to(draftRoom(draftId)).emit('draft_started', payload);
  io.to(draftPlayerRoom(draftId, hostUserId)).emit('draft_started', payload);
  io.to(draftPlayerRoom(draftId, guestUserId)).emit('draft_started', payload);
  io.to(draftSpectatorRoom(draftId)).emit('draft_started', payload);
}

export interface TurnStartedPayload {
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
}

export function emitTurnStarted(
  io: AppIOServer | undefined,
  draftId: string,
  payload: TurnStartedPayload,
): void {
  if (!io) return;
  io.to(draftRoom(draftId)).emit('turn_started', payload);
}

export interface ActionCommittedPayloadBase {
  draftId: string;
  turnIndex: number;
  actor: 'host' | 'guest' | 'admin' | 'system';
  action: string;
  isAutoSelected: boolean;
  isHiddenFromYou: boolean;
}

/**
 * Emit action_committed with correct hidden-masking per room.
 *
 * - If hiddenFactionId is non-null AND the turn was hidden:
 *     host-player room gets actual factionId (or null if guest was the actor)
 *     guest-player room gets actual factionId (or null if host was the actor)
 *     spectators get null
 * - If factionId is not hidden, everyone gets the actual factionId.
 */
export function emitActionCommitted(
  io: AppIOServer | undefined,
  draftId: string,
  hostUserId: string,
  guestUserId: string,
  payloadBase: ActionCommittedPayloadBase,
  factionId: string | null,
  isHidden: boolean,
  actorRole: 'host' | 'guest' | 'admin' | 'system',
): void {
  if (!io) return;

  if (!isHidden || factionId === null) {
    // Visible action — broadcast to all rooms
    const payload = { ...payloadBase, factionId };
    io.to(draftRoom(draftId)).emit('action_committed', payload);
    io.to(draftSpectatorRoom(draftId)).emit('action_committed', payload);
    return;
  }

  // Hidden action: actor sees their own factionId, opponent and spectators see null
  const hostPayload = {
    ...payloadBase,
    factionId: actorRole === 'host' ? factionId : null,
    isHiddenFromYou: actorRole !== 'host',
  };
  const guestPayload = {
    ...payloadBase,
    factionId: actorRole === 'guest' ? factionId : null,
    isHiddenFromYou: actorRole !== 'guest',
  };
  const specPayload = { ...payloadBase, factionId: null, isHiddenFromYou: true };

  io.to(draftPlayerRoom(draftId, hostUserId)).emit('action_committed', hostPayload);
  io.to(draftPlayerRoom(draftId, guestUserId)).emit('action_committed', guestPayload);
  io.to(draftSpectatorRoom(draftId)).emit('action_committed', specPayload);
}

export interface DraftStateSyncPayload {
  draftId: string;
  state: PublicDraftState;
  currentTurn: number;
  timerExpiresAt: string | null;
  status: 'PENDING' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';
}

export function emitDraftStateSync(
  io: AppIOServer | undefined,
  target: string, // room name or socket id
  payload: DraftStateSyncPayload,
): void {
  if (!io) return;
  io.to(target).emit('draft_state_sync', payload);
}

export interface DraftCompletePayload {
  draftId: string;
  matchId: string;
  finalFactions: { host: string[]; guest: string[] };
}

export function emitDraftComplete(
  io: AppIOServer | undefined,
  draftId: string,
  payload: DraftCompletePayload,
): void {
  if (!io) return;
  io.to(draftRoom(draftId)).emit('draft_complete', payload);
  io.to(draftSpectatorRoom(draftId)).emit('draft_complete', payload);
}
