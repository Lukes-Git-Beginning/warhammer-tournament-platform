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

    socket.on('match_result', handleMatchResult);
    socket.on('bracket_update', handleBracketUpdate);

    return () => {
      socket.emit('leave_tournament', tournamentId);
      socket.off('match_result', handleMatchResult);
      socket.off('bracket_update', handleBracketUpdate);
    };
  }, [tournamentId, queryClient]);
}
