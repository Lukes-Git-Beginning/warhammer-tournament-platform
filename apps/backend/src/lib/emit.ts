import type { Server } from 'socket.io';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '@rizzotto/types';

type Io = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

type MatchResultPayload = Parameters<ServerToClientEvents['match_result']>[0];
type StatusChangePayload = Parameters<ServerToClientEvents['tournament_status_change']>[0];
type ParticipantChangePayload = Parameters<ServerToClientEvents['participant_change']>[0];

export function tournamentRoom(tournamentId: string): string {
  return `tournament_${tournamentId}`;
}

export function emitMatchResult(io: Io | undefined, payload: MatchResultPayload): void {
  if (!io) return;
  io.to(tournamentRoom(payload.tournamentId)).emit('match_result', payload);
}

export function emitBracketUpdate(io: Io | undefined, tournamentId: string): void {
  if (!io) return;
  io.to(tournamentRoom(tournamentId)).emit('bracket_update', { tournamentId });
}

export function emitStatusChange(io: Io | undefined, payload: StatusChangePayload): void {
  if (!io) return;
  io.to(tournamentRoom(payload.tournamentId)).emit('tournament_status_change', payload);
}

export function emitParticipantChange(
  io: Io | undefined,
  payload: ParticipantChangePayload,
): void {
  if (!io) return;
  io.to(tournamentRoom(payload.tournamentId)).emit('participant_change', payload);
}
