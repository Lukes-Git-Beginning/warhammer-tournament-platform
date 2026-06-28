import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getSocket } from '@/lib/socket';

export function useLiveBracket(tournamentId: string): void {
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
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
    };

    const handleBracketUpdate = (payload: { tournamentId: string }) => {
      if (payload.tournamentId !== tournamentId) return;
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
    };

    // Status change (e.g. tournament starts → ONGOING): refresh the tournament
    // query so the page flips live without a manual reload.
    const handleStatusChange = (payload: { tournamentId: string }) => {
      if (payload.tournamentId !== tournamentId) return;
      void queryClient.invalidateQueries({ queryKey: ['tournament'] });
      void queryClient.invalidateQueries({ queryKey: ['tournaments'] });
      void queryClient.invalidateQueries({ queryKey: ['bracket'] });
    };

    socket.on('match_result', handleMatchResult);
    socket.on('bracket_update', handleBracketUpdate);
    socket.on('tournament_status_change', handleStatusChange);

    return () => {
      socket.emit('leave_tournament', tournamentId);
      socket.off('match_result', handleMatchResult);
      socket.off('bracket_update', handleBracketUpdate);
      socket.off('tournament_status_change', handleStatusChange);
    };
  }, [tournamentId, queryClient]);
}
