import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';
import type { ServerToClientEvents } from '@rizzotto/types';

/**
 * Joins the match_decision Socket.IO room and subscribes to all decision and
 * game-update events. Invalidates match-games + match-decision query caches on
 * any event so components re-render with fresh data.
 */
export function useMatchDecisionSocket(matchId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!matchId) return;

    const socket = getSocket();
    if (!socket.connected) socket.connect();

    socket.emit('join_match_decision', matchId);

    const invalidate = () => {
      void queryClient.invalidateQueries({ queryKey: ['match-games', matchId] });
      void queryClient.invalidateQueries({ queryKey: ['match-decision', matchId] });
    };

    const onGameUpdated: ServerToClientEvents['match.game.updated'] = (payload) => {
      if (payload.matchId !== matchId) return;
      invalidate();
    };

    const onDecisionUpdate: ServerToClientEvents['match.decision.update'] = (payload) => {
      if (payload.matchId !== matchId) return;
      invalidate();
    };

    const onDecisionComplete: ServerToClientEvents['match.decision.complete'] = (payload) => {
      if (payload.matchId !== matchId) return;
      invalidate();
    };

    const onBlindPickUpdate: ServerToClientEvents['match.blind-pick.update'] = (payload) => {
      if (payload.matchId !== matchId) return;
      invalidate();
    };

    socket.on('match.game.updated', onGameUpdated);
    socket.on('match.decision.update', onDecisionUpdate);
    socket.on('match.decision.complete', onDecisionComplete);
    socket.on('match.blind-pick.update', onBlindPickUpdate);

    return () => {
      socket.emit('leave_match_decision', matchId);
      socket.off('match.game.updated', onGameUpdated);
      socket.off('match.decision.update', onDecisionUpdate);
      socket.off('match.decision.complete', onDecisionComplete);
      socket.off('match.blind-pick.update', onBlindPickUpdate);
    };
  }, [matchId, queryClient]);
}
