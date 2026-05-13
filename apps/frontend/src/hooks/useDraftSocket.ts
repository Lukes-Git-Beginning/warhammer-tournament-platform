import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';
import type { ServerToClientEvents } from '@tww3/types';

export interface UseDraftSocketOptions {
  draftId: string;
  viewer: 'player' | 'spectator';
}

/**
 * Joins the appropriate draft Socket.IO room and keeps TanStack Query cache
 * in sync with live draft events.
 *
 * - player:    joins the player room via `join_draft`
 * - spectator: joins the spec room via `watch_draft`
 *
 * On unmount the hook leaves the room and removes all listeners.
 */
export function useDraftSocket({ draftId, viewer }: UseDraftSocketOptions): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!draftId) return;

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const joinEvent = viewer === 'spectator' ? 'watch_draft' : 'join_draft';
    socket.emit(joinEvent, draftId);

    const handleStateSync: ServerToClientEvents['draft_state_sync'] = (payload) => {
      if (payload.draftId !== draftId) return;
      queryClient.setQueryData(
        ['draft', draftId],
        (prev: Record<string, unknown> | undefined) =>
          prev
            ? {
                ...prev,
                state: payload.state,
                current_turn: payload.currentTurn,
                timer_expires_at: payload.timerExpiresAt,
                status: payload.status,
              }
            : prev,
      );
    };

    const handleTurnStarted: ServerToClientEvents['turn_started'] = (payload) => {
      if (payload.draftId !== draftId) return;
      queryClient.setQueryData(
        ['draft', draftId],
        (prev: Record<string, unknown> | undefined) =>
          prev
            ? {
                ...prev,
                current_turn: payload.turnIndex,
                timer_expires_at: payload.timerExpiresAt,
              }
            : prev,
      );
      queryClient.setQueryData(['draft', draftId, 'available'], payload.availableFactions);
    };

    const handleActionCommitted: ServerToClientEvents['action_committed'] = (payload) => {
      if (payload.draftId !== draftId) return;
      // Server has the truth — invalidate to re-fetch full state
      void queryClient.invalidateQueries({ queryKey: ['draft', draftId] });
      void queryClient.invalidateQueries({ queryKey: ['draft', draftId, 'events'] });
    };

    const handleDraftComplete: ServerToClientEvents['draft_complete'] = (payload) => {
      if (payload.draftId !== draftId) return;
      void queryClient.invalidateQueries({ queryKey: ['draft', draftId] });
    };

    socket.on('draft_state_sync', handleStateSync);
    socket.on('turn_started', handleTurnStarted);
    socket.on('action_committed', handleActionCommitted);
    socket.on('draft_complete', handleDraftComplete);

    return () => {
      socket.emit('leave_draft', draftId);
      socket.off('draft_state_sync', handleStateSync);
      socket.off('turn_started', handleTurnStarted);
      socket.off('action_committed', handleActionCommitted);
      socket.off('draft_complete', handleDraftComplete);
    };
  }, [draftId, viewer, queryClient]);
}

/**
 * Fire-and-forget helper to submit a draft action via Socket.IO.
 * Call from a button-click handler in DraftLobby.
 */
export function sendDraftAction(draftId: string, factionId: string): void {
  const socket = getSocket();
  socket.emit('draft_action', { draftId, factionId });
}
