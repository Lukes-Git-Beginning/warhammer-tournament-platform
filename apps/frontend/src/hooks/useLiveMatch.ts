import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket.js';

/**
 * Joins the tournament room and invalidates `['match', matchId]` (+ scoring
 * breakdown) whenever the backend emits a `match_result` or `bracket_update`
 * event that concerns this match.
 *
 * Uses the tournament-level room because there is no dedicated per-match
 * Socket.IO room for result events; the tournament room is the source of truth
 * for bracket/match state changes.
 */
export function useLiveMatch(matchId: string, tournamentId: string | undefined): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!tournamentId) return;

    const socket = getSocket();
    if (!socket.connected) {
      socket.connect();
    }

    socket.emit('join_tournament', tournamentId);

    const handleMatchResult = (payload: {
      tournamentId: string;
      matchId: string;
      winnerId: string | null;
      score: string | null;
      nextMatchId: string | null;
    }) => {
      if (payload.tournamentId !== tournamentId) return;
      // Invalidate the specific match (and its breakdown) when any result in
      // this tournament fires — narrow guard on matchId for the breakdown.
      void queryClient.invalidateQueries({ queryKey: ['match', matchId] });
      if (payload.matchId === matchId) {
        void queryClient.invalidateQueries({ queryKey: ['match-scoring-breakdown', matchId] });
      }
    };

    const handleBracketUpdate = (payload: { tournamentId: string }) => {
      if (payload.tournamentId !== tournamentId) return;
      void queryClient.invalidateQueries({ queryKey: ['match', matchId] });
    };

    socket.on('match_result', handleMatchResult);
    socket.on('bracket_update', handleBracketUpdate);

    return () => {
      socket.emit('leave_tournament', tournamentId);
      socket.off('match_result', handleMatchResult);
      socket.off('bracket_update', handleBracketUpdate);
    };
  }, [matchId, tournamentId, queryClient]);
}
