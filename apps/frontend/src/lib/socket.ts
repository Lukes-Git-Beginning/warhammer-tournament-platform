import { useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import type { ServerToClientEvents, ClientToServerEvents } from '@tww3/types';

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socketInstance: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socketInstance) {
    socketInstance = io({
      path: '/socket.io',
      withCredentials: true,
      autoConnect: false,
    });
  }
  return socketInstance;
}

export function useTournamentSocket(tournamentId: string): AppSocket {
  const socket = getSocket();

  useEffect(() => {
    if (!socket.connected) {
      socket.connect();
    }

    socket.emit('join_tournament', tournamentId);

    return () => {
      socket.emit('leave_tournament', tournamentId);
    };
  }, [socket, tournamentId]);

  return socket;
}
