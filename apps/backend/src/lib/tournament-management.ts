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
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { createLateJoinerBye, blockBalancedManualPairing } from './tournament-utils.js';
import { emitBracketUpdate } from './emit.js';
import { admitBalancedLateJoiner } from './balanced-liechtenstein-service.js';
import { recordTournamentEvent } from './tournament-events.js';

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
export const SetFactionSchema = z.object({ faction_id: z.string().min(1).nullable() });
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
  fastify?: FastifyInstance,
): Promise<OpResult> {
  const parsed = AddLateSchema.safeParse(body);
  if (!parsed.success) {
    return { status: 400, body: { error: 'BadRequest', message: parsed.error.message, statusCode: 400 } };
  }

  const tournament = await prisma.tournament.findUnique({
    where: { slug, deleted_at: null },
    select: { id: true, status: true, format: true, mode: true, faction_allowlist: { select: { faction_id: true } } },
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

  // Late joiner mid-tournament: route through the format-specific admission path.
  // Pre-start (REGISTRATION_CLOSED) there is no round yet — just add them.
  if (tournament.status === 'ONGOING') {
    if (tournament.format === 'BALANCED_LIECHTENSTEIN' && fastify) {
      // BaLi: assign skill band + create CATCHUP_BYE placeholders + trigger pairing tick.
      try {
        await admitBalancedLateJoiner(fastify, tournament.id, parsed.data.userId);
      } catch (err) {
        log.warn({ err, slug }, 'Failed to admit balanced late joiner');
      }
    } else {
      // Swiss / Auto Swiss: give them a CATCHUP_BYE (0 pts) for the current round.
      try {
        const bye = await createLateJoinerBye(prisma, tournament.id, parsed.data.userId);
        if (bye) emitBracketUpdate(io, tournament.id);
      } catch (err) {
        log.warn({ err, slug }, 'Failed to create late-joiner CATCHUP_BYE');
      }
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
    select: { id: true, mode: true, faction_allowlist: { select: { faction_id: true } } },
  });
  if (!tournament) return { status: 404, body: { error: 'NotFound', message: 'Tournament not found', statusCode: 404 } };

  // #29: null = set the player to "Free Pick" / pick-later (no fixed faction).
  if (parsed.data.faction_id !== null) {
    const faction = await prisma.faction.findUnique({ where: { id: parsed.data.faction_id }, select: { id: true } });
    if (!faction) {
      return { status: 400, body: { error: 'BadRequest', message: `Faction "${parsed.data.faction_id}" does not exist`, statusCode: 400 } };
    }
    const allowlist = tournament.faction_allowlist.map((f) => f.faction_id);
    if (allowlist.length > 0 && !allowlist.includes(parsed.data.faction_id)) {
      return { status: 400, body: { error: 'BadRequest', message: `Faction "${parsed.data.faction_id}" is not in the tournament allowlist`, statusCode: 400 } };
    }
    // FACTION_WAR: a faction is globally exclusive — reject if another active player
    // already holds it (the target player is excluded so a re-assign to the same is a no-op).
    if (tournament.mode === 'FACTION_WAR') {
      const claimed = await prisma.tournamentParticipant.findFirst({
        where: {
          tournament_id: tournament.id,
          faction_id: parsed.data.faction_id,
          status: { in: ['REGISTERED', 'CHECKED_IN'] },
          deleted_at: null,
          NOT: { user_id: userId },
        },
        select: { id: true },
      });
      if (claimed) {
        return { status: 409, body: { error: 'Conflict', message: 'This faction is already claimed by another player in this tournament', statusCode: 409 } };
      }
    }
  }

  const participant = await prisma.tournamentParticipant.update({
    where: { tournament_id_user_id: { tournament_id: tournament.id, user_id: userId } },
    data: { faction_id: parsed.data.faction_id },
    select: { id: true, user_id: true, faction_id: true, status: true },
  });

  return { status: 200, body: { participant } };
}

/**
 * Create a manual PENDING match for any format (B18: omit player2 → BYE node).
 * The phase is stamped per format so a manually-added match/bye never damages a
 * non-Swiss tournament (see the create call below).
 */
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
    select: { id: true, status: true, format: true },
  });
  if (!tournament) return { status: 404, body: { error: 'NotFound', message: 'Tournament not found', statusCode: 404 } };

  // BaLi owns its own pairing — a manual node desyncs the count model. Admin-only route,
  // so block unless an explicit confirm flag is set (host reach is impossible here anyway).
  const balancedBlock = blockBalancedManualPairing(
    tournament.format,
    'ADMIN',
    (body as { confirmBalancedOverride?: boolean } | null)?.confirmBalancedOverride === true,
  );
  if (balancedBlock) return { status: balancedBlock.status, body: balancedBlock.body };

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
      // B18: no second player → BYE node: award it to player1 (a bye is a free win,
      // and both Swiss and Balanced Liechtenstein need a winner to count the round).
      status: player2Id ? 'PENDING' : 'BYE',
      winner_id: player2Id ? null : player1Id,
      // Stamp the format-correct phase (mirror bracket.ts): only Swiss group matches
      // are 'SWISS'; every other format (Balanced Liechtenstein, Elimination, RR,
      // Liechtenstein) uses null. Writing 'SWISS' unconditionally damaged non-Swiss
      // tournaments — a manual Balanced Liechtenstein match/bye landed outside the
      // division group and fooled the auto-playoff guard into never generating playoffs.
      phase: tournament.format === 'SWISS' ? 'SWISS' : null,
    },
    select: { id: true, round: true, match_number: true },
  });
  void recordTournamentEvent({
    tournamentId: tournament.id,
    type: 'match_created',
    actor: 'host',
    payload: { phase: 'manual', player1Id, player2Id: player2Id ?? null },
  });
  emitBracketUpdate(io, tournament.id);
  // Return the tournament id so the caller can run a pairing tick (Balanced Liechtenstein:
  // a manually-added node / bye may complete the field → generate playoffs).
  return { status: 201, body: { match, tournamentId: tournament.id } };
}
