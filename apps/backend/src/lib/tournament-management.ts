/**
 * tournament-management.ts
 *
 * Shared operative tournament-management actions (add a late participant, set a
 * participant's faction, create a manual match). Each returns a plain
 * `{ status, body }` result so the same logic can back both the ADMIN-scoped
 * `/api/admin/...` routes and the canManage-gated host routes
 * (`/api/tournaments/:slug/...`) without drifting (B12).
 */

import type { PrismaClient } from '@rizzotto/db';
import { z } from 'zod';
import { createLateJoinerBye } from './tournament-utils.js';
import { emitBracketUpdate } from './emit.js';

type Io = Parameters<typeof emitBracketUpdate>[0];

export interface OpResult {
  status: number;
  body: unknown;
}

interface OpLogger {
  warn: (obj: unknown, msg?: string) => void;
}

export const AddLateSchema = z.object({
  userId: z.string().uuid(),
  faction_id: z.string().min(1).optional(),
});
export const SetFactionSchema = z.object({ faction_id: z.string().min(1) });
export const CreateMatchSchema = z.object({
  player1Id: z.string().uuid(),
  player2Id: z.string().uuid().optional(), // B18: omit → BYE node
  round: z.number().int().min(1),
});

/** Add a participant after the tournament has closed registration / started. */
export async function addLateParticipant(
  prisma: PrismaClient,
  io: Io,
  slug: string,
  body: unknown,
  log: OpLogger,
): Promise<OpResult> {
  const parsed = AddLateSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { error: 'BadRequest', message: parsed.error.message, statusCode: 400 } };
  }

  const tournament = await prisma.tournament.findUnique({
    where: { slug, deleted_at: null },
    select: { id: true, status: true, mode: true, faction_allowlist: { select: { faction_id: true } } },
  });
  if (!tournament) return { status: 404, body: { error: 'NotFound', message: 'Tournament not found', statusCode: 404 } };
  // B21: also allow adding participants in the pre-start phase (registration
  // closed, not yet started) — not only mid-tournament.
  if (tournament.status !== 'ONGOING' && tournament.status !== 'REGISTRATION_CLOSED') {
    return { status: 422, body: { error: 'UnprocessableEntity', message: 'Tournament must be ongoing or registration-closed to add a participant', statusCode: 422 } };
  }

  const user = await prisma.user.findUnique({ where: { id: parsed.data.userId }, select: { id: true, username: true } });
  if (!user) return { status: 404, body: { error: 'NotFound', message: 'User not found', statusCode: 404 } };

  const existing = await prisma.tournamentParticipant.findUnique({
    where: { tournament_id_user_id: { tournament_id: tournament.id, user_id: parsed.data.userId } },
    select: { status: true },
  });
  if (existing) {
    return { status: 409, body: { error: 'Conflict', message: `${user.username} is already a participant (status: ${existing.status})`, statusCode: 409 } };
  }

  if (parsed.data.faction_id) {
    const faction = await prisma.faction.findUnique({ where: { id: parsed.data.faction_id }, select: { id: true } });
    if (!faction) {
      return { status: 400, body: { error: 'BadRequest', message: `Faction "${parsed.data.faction_id}" does not exist`, statusCode: 400 } };
    }
    const allowlist = tournament.faction_allowlist.map((f) => f.faction_id);
    if (allowlist.length > 0 && !allowlist.includes(parsed.data.faction_id)) {
      return { status: 400, body: { error: 'BadRequest', message: `Faction "${parsed.data.faction_id}" is not in the tournament allowlist`, statusCode: 400 } };
    }
  }

  const participant = await prisma.tournamentParticipant.create({
    data: { tournament_id: tournament.id, user_id: parsed.data.userId, status: 'CHECKED_IN', faction_id: parsed.data.faction_id },
    select: { id: true, status: true, faction_id: true, user: { select: { id: true, username: true } } },
  });

  // Late joiner mid-tournament: give them a BYE in the current Swiss round so
  // they're folded into subsequent rounds (Swiss / Auto Swiss). Non-fatal.
  // Pre-start (REGISTRATION_CLOSED) there is no round yet — just add them.
  if (tournament.status === 'ONGOING') {
    try {
      const bye = await createLateJoinerBye(prisma, tournament.id, parsed.data.userId);
      if (bye) emitBracketUpdate(io, tournament.id);
    } catch (err) {
      log.warn({ err, slug }, 'Failed to create late-joiner BYE');
    }
  }

  return { status: 201, body: { participant } };
}

/** Set (or change) a participant's faction pick. */
export async function setParticipantFactionOp(
  prisma: PrismaClient,
  slug: string,
  userId: string,
  body: unknown,
): Promise<OpResult> {
  const parsed = SetFactionSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { error: 'BadRequest', message: parsed.error.message, statusCode: 400 } };
  }

  const tournament = await prisma.tournament.findUnique({
    where: { slug, deleted_at: null },
    select: { id: true, faction_allowlist: { select: { faction_id: true } } },
  });
  if (!tournament) return { status: 404, body: { error: 'NotFound', message: 'Tournament not found', statusCode: 404 } };

  const faction = await prisma.faction.findUnique({ where: { id: parsed.data.faction_id }, select: { id: true } });
  if (!faction) {
    return { status: 400, body: { error: 'BadRequest', message: `Faction "${parsed.data.faction_id}" does not exist`, statusCode: 400 } };
  }
  const allowlist = tournament.faction_allowlist.map((f) => f.faction_id);
  if (allowlist.length > 0 && !allowlist.includes(parsed.data.faction_id)) {
    return { status: 400, body: { error: 'BadRequest', message: `Faction "${parsed.data.faction_id}" is not in the tournament allowlist`, statusCode: 400 } };
  }

  const participant = await prisma.tournamentParticipant.update({
    where: { tournament_id_user_id: { tournament_id: tournament.id, user_id: userId } },
    data: { faction_id: parsed.data.faction_id },
    select: { id: true, user_id: true, faction_id: true, status: true },
  });

  return { status: 200, body: { participant } };
}

/** Create a manual PENDING Swiss match (B18: omit player2 → BYE node). */
export async function createManualMatch(
  prisma: PrismaClient,
  io: Io,
  slug: string,
  body: unknown,
): Promise<OpResult> {
  const parsed = CreateMatchSchema.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: 'BadRequest', message: parsed.error.message, statusCode: 400 } };

  const tournament = await prisma.tournament.findFirst({
    where: { slug, deleted_at: null },
    select: { id: true, status: true },
  });
  if (!tournament) return { status: 404, body: { error: 'NotFound', message: 'Tournament not found', statusCode: 404 } };

  const { round, player1Id, player2Id } = parsed.data;
  const agg = await prisma.match.aggregate({
    where: { tournament_id: tournament.id, round },
    _max: { match_number: true },
  });
  const nextMatchNumber = (agg._max.match_number ?? 0) + 1;

  const match = await prisma.match.create({
    data: {
      tournament_id: tournament.id,
      round,
      match_number: nextMatchNumber,
      player1_id: player1Id,
      player2_id: player2Id ?? null,
      // B18: no second player → BYE node (1.0 to player1, no opponent).
      status: player2Id ? 'PENDING' : 'BYE',
      phase: 'SWISS',
    },
    select: { id: true, round: true, match_number: true },
  });
  emitBracketUpdate(io, tournament.id);
  return { status: 201, body: { match } };
}
