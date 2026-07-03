// ---------------------------------------------------------------------------
// Balanced Liechtenstein — pairing tick (DB + Redis side of the pure planner).
//
// Runs the incremental pairing for a Balanced Liechtenstein tournament: reads the
// current participants + matches, asks `planPairings()` what to create now, and
// writes the new match rows (Swiss-style bare Match rows — the map/faction flow
// is created on demand when players open the match, exactly like Swiss).
//
// Triggered at tournament start (pairs round 1) and after every match completion
// (pairs the freed players into their next round). A per-tournament Redis lock
// serialises concurrent ticks; a bounded loop resolves bye cascades within a tick.
// ---------------------------------------------------------------------------

import type { FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { Prisma, MatchStatus, MatchPhase } from '@rizzotto/db';
import { planPairings, formDivisionPools, DEFAULT_BAND } from './balanced-liechtenstein.js';
import { computeSwissStandings, sortSwissStandings, type CompletedMatchRecord } from './swiss.js';
import { getPlayerClassification } from './skill-classification-service.js';
import { emitBracketUpdate } from './emit.js';
import { notifyMatchesCreated } from './discord-notify.js';

const LOCK_TTL_SECONDS = 15;
const MAX_ITERATIONS = 12; // safety cap for bye cascades in a single tick
const RELEASE_LOCK =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/**
 * Fix every participant's skill division (matchmakingBand 1..5) on the tournament
 * for skill-based pairing + division playoffs. Called at start (authoritative,
 * before round 1 is paired) so it captures any calibration done up to that point.
 * The hierarchical rating model is fitted once per season and cached, so the
 * per-player classification calls are cheap after the first.
 */
export async function assignSkillBandsForTournament(
  fastify: FastifyInstance,
  tournamentId: string,
): Promise<void> {
  const season = await fastify.prisma.season.findFirst({
    where: { is_active: true },
    select: { id: true },
  });

  const participants = await fastify.prisma.tournamentParticipant.findMany({
    where: {
      tournament_id: tournamentId,
      deleted_at: null,
      status: { in: ['REGISTERED', 'CHECKED_IN'] },
    },
    select: { id: true, user_id: true, requested_band: true },
  });

  for (const p of participants) {
    try {
      // Computed band from the classification (needs an active season); when there
      // is none, fall back to the player's own choice.
      let computed = 0;
      if (season) {
        const cls = await getPlayerClassification(fastify.prisma, fastify.redis, season.id, p.user_id);
        computed = cls.matchmakingBand;
      }
      // Effective band = the higher of the computed band and the requested one —
      // play-up only, so a player can enter a higher division but never a lower one.
      const effective = Math.max(computed, p.requested_band ?? 0);
      if (effective > 0) {
        await fastify.prisma.tournamentParticipant.update({
          where: { id: p.id },
          data: { skill_band: effective },
        });
      }
    } catch (err) {
      fastify.log.warn({ err, userId: p.user_id }, 'balanced skill-band assignment failed');
    }
  }
}

/**
 * Generate whatever Balanced Liechtenstein pairings are now possible for a
 * tournament and persist them. Idempotent + safe to call spuriously: it no-ops
 * for the wrong format/status and when nothing new can be paired.
 */
export async function runBalancedPairingTick(
  fastify: FastifyInstance,
  tournamentId: string,
): Promise<void> {
  // Cheap format/status guard first — the completion hook calls this for every
  // tournament match, so bail before touching Redis for non-balanced tournaments.
  const tournament = await fastify.prisma.tournament.findFirst({
    where: { id: tournamentId, deleted_at: null },
    select: { format: true, status: true, rounds_count: true },
  });
  if (
    !tournament ||
    tournament.format !== 'BALANCED_LIECHTENSTEIN' ||
    tournament.status !== 'ONGOING'
  ) {
    return;
  }
  const roundsCount = tournament.rounds_count ?? 5;

  const redis = fastify.redis;
  const lockKey = `rizzotto:bl:tick:${tournamentId}:lock`;
  const token = randomUUID();

  if (redis) {
    const acquired = await redis.set(lockKey, token, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (acquired !== 'OK') return; // another tick is already running for this tournament
  }

  try {

    const createdMatches: Array<{
      id: string;
      round: number;
      player1_id: string;
      player2_id: string;
    }> = [];

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const [roster, matches] = await Promise.all([
        fastify.prisma.tournamentParticipant.findMany({
          where: {
            tournament_id: tournamentId,
            deleted_at: null,
            status: { in: ['REGISTERED', 'CHECKED_IN'] },
          },
          select: { user_id: true, skill_band: true, status: true },
        }),
        fastify.prisma.match.findMany({
          where: { tournament_id: tournamentId, deleted_at: null },
          select: {
            round: true,
            player1_id: true,
            player2_id: true,
            status: true,
            match_number: true,
          },
        }),
      ]);

      // Mirror the start handler's roster rule: once anyone has checked in, only
      // checked-in players compete; otherwise the whole registered field does.
      const anyCheckedIn = roster.some((p) => p.status === 'CHECKED_IN');
      const participants = anyCheckedIn
        ? roster.filter((p) => p.status === 'CHECKED_IN')
        : roster;

      const plan = planPairings(
        participants.map((p) => ({ userId: p.user_id, band: p.skill_band })),
        matches.map((m) => ({
          round: m.round,
          player1_id: m.player1_id,
          player2_id: m.player2_id,
          status: m.status,
        })),
        roundsCount,
      );
      if (plan.pairings.length === 0 && plan.byes.length === 0) break;

      let nextNumber = matches.reduce((mx, m) => Math.max(mx, m.match_number), 0) + 1;
      const rows: Prisma.MatchCreateManyInput[] = [];
      for (const p of plan.pairings) {
        const id = randomUUID();
        rows.push({
          id,
          tournament_id: tournamentId,
          round: p.round,
          match_number: nextNumber++,
          player1_id: p.player1_id,
          player2_id: p.player2_id,
          status: 'PENDING' as MatchStatus,
          phase: null as MatchPhase | null,
        });
        createdMatches.push({
          id,
          round: p.round,
          player1_id: p.player1_id,
          player2_id: p.player2_id,
        });
      }
      for (const b of plan.byes) {
        rows.push({
          id: randomUUID(),
          tournament_id: tournamentId,
          round: b.round,
          match_number: nextNumber++,
          player1_id: b.player_id,
          player2_id: null,
          status: 'BYE' as MatchStatus,
          winner_id: b.player_id,
          phase: null as MatchPhase | null,
        });
      }
      await fastify.prisma.match.createMany({ data: rows });
    }

    if (createdMatches.length > 0) {
      emitBracketUpdate(fastify.io, tournamentId);
      const byRound = new Map<number, typeof createdMatches>();
      for (const m of createdMatches) {
        const list = byRound.get(m.round) ?? [];
        list.push(m);
        byRound.set(m.round, list);
      }
      for (const [round, ms] of byRound) {
        await notifyMatchesCreated(
          tournamentId,
          round,
          ms.map((m) => ({ id: m.id, player1_id: m.player1_id, player2_id: m.player2_id })),
        );
      }
    }
  } catch (err) {
    fastify.log.error({ err, tournamentId }, 'balanced pairing tick failed');
  } finally {
    if (redis) {
      try {
        await redis.eval(RELEASE_LOCK, 1, lockKey, token);
      } catch {
        /* lock will expire on its own */
      }
    }
  }
}

export interface BalancedPlayoffResult {
  pools: number;
  finals: number;
}

/**
 * Start the division playoffs once a Balanced Liechtenstein group phase is done:
 * rank players by Swiss standing, form skill-division pools (>=4, filled top-down
 * per §7), and create one PLAYOFF_FINAL per division between its top 2. Returns an
 * `{ error }` on precondition failure; guarded against double-generation.
 */
export async function startBalancedPlayoffs(
  fastify: FastifyInstance,
  tournamentId: string,
): Promise<BalancedPlayoffResult | { error: string }> {
  const tournament = await fastify.prisma.tournament.findFirst({
    where: { id: tournamentId, deleted_at: null },
    select: { format: true, status: true, rounds_count: true },
  });
  if (!tournament || tournament.format !== 'BALANCED_LIECHTENSTEIN') {
    return { error: 'Not a Balanced Liechtenstein tournament' };
  }
  if (tournament.status !== 'ONGOING') return { error: 'Tournament is not ONGOING' };
  const roundsCount = tournament.rounds_count ?? 5;

  const matches = await fastify.prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null },
    select: {
      round: true,
      match_number: true,
      player1_id: true,
      player2_id: true,
      winner_id: true,
      status: true,
      phase: true,
      games: { select: { status: true, winner_id: true } },
    },
  });
  if (matches.some((m) => m.phase && m.phase !== 'SWISS')) {
    return { error: 'Playoffs have already been generated' };
  }

  const roster = await fastify.prisma.tournamentParticipant.findMany({
    where: {
      tournament_id: tournamentId,
      deleted_at: null,
      status: { in: ['REGISTERED', 'CHECKED_IN', 'WITHDREW'] },
    },
    select: { user_id: true, skill_band: true, status: true },
  });
  const withdrawnIds = new Set(roster.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id));
  const active = roster.filter((p) => p.status !== 'WITHDREW');
  const anyCheckedIn = active.some((p) => p.status === 'CHECKED_IN');
  const contenders = anyCheckedIn ? active.filter((p) => p.status === 'CHECKED_IN') : active;

  // The group phase must be complete: every contender has played all rounds.
  const plan = planPairings(
    contenders.map((p) => ({ userId: p.user_id, band: p.skill_band })),
    matches.map((m) => ({
      round: m.round,
      player1_id: m.player1_id,
      player2_id: m.player2_id,
      status: m.status,
    })),
    roundsCount,
  );
  if (!plan.complete) return { error: 'Group phase is not complete yet' };

  // Final Swiss standings → global rank (best = 1).
  const participantIds = roster.map((p) => p.user_id);
  const completed: CompletedMatchRecord[] = matches
    .filter(
      (m) =>
        (m.status === 'COMPLETED' || m.status === 'BYE' || m.status === 'FORFEIT' || m.status === 'NO_CONTEST') &&
        (m.phase === null || m.phase === 'SWISS'),
    )
    .map((m) => ({
      round: m.round,
      player1_id: m.player1_id,
      player2_id: m.player2_id,
      winner_id: m.winner_id,
      status: m.status,
      player1_game_wins: m.games.some((g) => g.status === 'COMPLETED')
        ? m.games.filter((g) => g.winner_id === m.player1_id && g.status === 'COMPLETED').length
        : undefined,
      player2_game_wins: m.games.some((g) => g.status === 'COMPLETED')
        ? m.games.filter((g) => g.winner_id === m.player2_id && g.status === 'COMPLETED').length
        : undefined,
    }));
  const sorted = sortSwissStandings(
    computeSwissStandings(participantIds, completed, withdrawnIds),
    completed,
  );

  const bandByUser = new Map(roster.map((p) => [p.user_id, p.skill_band ?? DEFAULT_BAND]));
  const ranked = sorted
    .filter((s) => !withdrawnIds.has(s.userId))
    .map((s, i) => ({ userId: s.userId, band: bandByUser.get(s.userId) ?? DEFAULT_BAND, rank: i + 1 }));

  const pools = formDivisionPools(ranked);

  const playoffRound = matches.reduce((mx, m) => Math.max(mx, m.round), 0) + 1;
  let nextNumber = matches.reduce((mx, m) => Math.max(mx, m.match_number), 0) + 1;
  const rows: Prisma.MatchCreateManyInput[] = [];
  const created: Array<{ id: string; player1_id: string; player2_id: string }> = [];
  for (const pool of pools) {
    if (!pool.finalists) continue; // a lone champion needs no final
    const id = randomUUID();
    rows.push({
      id,
      tournament_id: tournamentId,
      round: playoffRound,
      match_number: nextNumber++,
      player1_id: pool.finalists[0],
      player2_id: pool.finalists[1],
      status: 'PENDING' as MatchStatus,
      phase: 'PLAYOFF_FINAL' as MatchPhase,
    });
    created.push({ id, player1_id: pool.finalists[0], player2_id: pool.finalists[1] });
  }

  if (rows.length > 0) {
    await fastify.prisma.match.createMany({ data: rows });
    emitBracketUpdate(fastify.io, tournamentId);
    await notifyMatchesCreated(tournamentId, playoffRound, created);
  }

  return { pools: pools.length, finals: rows.length };
}
