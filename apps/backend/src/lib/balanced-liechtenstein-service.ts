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
import {
  planPairings,
  formDivisionPools,
  divisionPlayoffFormat,
  targetPoolSizeFromFormat,
  DEFAULT_BAND,
} from './balanced-liechtenstein.js';
import { computeSwissStandings, sortSwissStandings, type CompletedMatchRecord } from './swiss.js';
import { getPlayerClassification } from './skill-classification-service.js';
import { autoSwissConfig } from './auto-swiss-service.js';
import { emitBracketUpdate } from './emit.js';
import { notifyMatchesCreated } from './discord-notify.js';

const LOCK_TTL_SECONDS = 15;
const MAX_ITERATIONS = 30; // safety cap for bye cascades (create → crystallise → reclaim) in a single tick
const RELEASE_LOCK =
  "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end";

/** Match statuses that count as a played (advancing) round toward a player's depth.
 *  PENDING_BYE advances provisionally (it crystallises into BYE/CATCHUP_BYE once the
 *  holder is paired forward, and a final-round bye is scored outright), so a complete
 *  player never carries an unresolved one. */
const BL_ADVANCING = new Set(['COMPLETED', 'BYE', 'FORFEIT', 'NO_CONTEST', 'CATCHUP_BYE', 'PENDING_BYE']);
/** Non-terminal statuses: the player is assigned/playing, not finished. */
const BL_ACTIVE = new Set(['PENDING', 'ONGOING', 'AWAITING_CONFIRMATION', 'DISPUTED']);

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
 * Derive the round count + playoff format from the total check-in count at start,
 * exactly like Auto Swiss (thresholds 4 / 8 / 16). The stored `playoff_format` is
 * only a "playoffs exist" flag for the UI — the real per-division bracket size is
 * chosen from each division's own size in startBalancedPlayoffs. Below 4 players a
 * minimal fallback keeps the tournament runnable. Called once at Start.
 */
export async function applyBalancedStartConfig(
  fastify: FastifyInstance,
  tournamentId: string,
): Promise<void> {
  // A fixed-round Balanced tournament (auto_sizing = false) keeps the host's
  // stored rounds_count + playoff_format — only auto-sized tournaments derive
  // them from the check-in count here. Balanced defaults auto_sizing ON.
  const t = await fastify.prisma.tournament.findFirst({
    where: { id: tournamentId, deleted_at: null },
    select: { auto_sizing: true },
  });
  if (t && !t.auto_sizing) return;

  const roster = await fastify.prisma.tournamentParticipant.findMany({
    where: {
      tournament_id: tournamentId,
      deleted_at: null,
      status: { in: ['REGISTERED', 'CHECKED_IN'] },
    },
    select: { status: true },
  });
  const anyCheckedIn = roster.some((p) => p.status === 'CHECKED_IN');
  const count = anyCheckedIn ? roster.filter((p) => p.status === 'CHECKED_IN').length : roster.length;

  const config = autoSwissConfig(count);
  const rounds = config?.rounds ?? Math.max(1, Math.min(3, count - 1));
  const playoffFormat = config?.playoffFormat ?? 'TOP2';

  await fastify.prisma.tournament.update({
    where: { id: tournamentId },
    data: { rounds_count: rounds, playoff_format: playoffFormat },
  });
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
    // True once any row was created OR a PENDING_BYE was reclaimed/crystallised, so a
    // tick that only resolves byes still pushes a live bracket update to the clients.
    let mutated = false;

    for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
      const [roster, matches] = await Promise.all([
        fastify.prisma.tournamentParticipant.findMany({
          where: {
            tournament_id: tournamentId,
            deleted_at: null,
            status: { in: ['REGISTERED', 'CHECKED_IN'] },
          },
          select: { user_id: true, skill_band: true, status: true, late_joined: true },
        }),
        fastify.prisma.match.findMany({
          where: { tournament_id: tournamentId, deleted_at: null },
          select: {
            id: true,
            round: true,
            player1_id: true,
            player2_id: true,
            status: true,
            match_number: true,
          },
        }),
      ]);
      const lateJoinedSet = new Set(roster.filter((p) => p.late_joined).map((p) => p.user_id));

      // Mirror the start handler's roster rule: once anyone has checked in, only
      // checked-in players compete; otherwise the whole registered field does.
      const anyCheckedIn = roster.some((p) => p.status === 'CHECKED_IN');
      const participants = anyCheckedIn
        ? roster.filter((p) => p.status === 'CHECKED_IN')
        : roster;

      // A PENDING_BYE can no longer be reclaimed once its holder has been paired forward
      // (has any live match at a later round) — from then on it simply scores.
      const movedOn = (userId: string, round: number): boolean =>
        matches.some(
          (m) =>
            (m.player1_id === userId || m.player2_id === userId) &&
            m.round > round &&
            m.status !== 'CANCELLED',
        );
      // 0-point rule (marker-based): a late joiner (persistent late_joined marker) who
      // has not yet played a real game only ever gets 0-point CATCHUP_BYEs, never a
      // scoring bye — closes the "reward for being late" hole independent of registered_at.
      const byeStatusFor = (userId: string): { status: MatchStatus; winner: string | null } => {
        const hasPlayedReal = matches.some(
          (m) => (m.player1_id === userId || m.player2_id === userId) && m.status === 'COMPLETED',
        );
        const isCatchup = lateJoinedSet.has(userId) && !hasPlayedReal;
        return isCatchup
          ? { status: 'CATCHUP_BYE' as MatchStatus, winner: null }
          : { status: 'BYE' as MatchStatus, winner: userId };
      };

      // Step A — crystallise any PENDING_BYE whose holder has moved on: it can no longer be
      // reclaimed into a real match, so it becomes a scored bye (or a 0-point catch-up bye
      // for a late joiner with no real game yet). Re-loop so the plan sees the fresh data.
      const toCrystallise = matches.filter(
        (m) => m.status === 'PENDING_BYE' && m.player1_id !== null && movedOn(m.player1_id, m.round),
      );
      if (toCrystallise.length > 0) {
        for (const m of toCrystallise) {
          const { status, winner } = byeStatusFor(m.player1_id!);
          await fastify.prisma.match.update({ where: { id: m.id }, data: { status, winner_id: winner } });
        }
        mutated = true;
        continue;
      }

      const plan = planPairings(
        participants.map((p) => ({ userId: p.user_id, band: p.skill_band })),
        matches.map((m) => ({
          round: m.round,
          player1_id: m.player1_id,
          player2_id: m.player2_id,
          status: m.status,
        })),
        roundsCount,
        tournamentId,
      );
      if (plan.pairings.length === 0 && plan.byes.length === 0) break;

      // Step B — RECLAIM: rather than sit a fresh same-depth player on a bye, fill an
      // existing still-reclaimable PENDING_BYE at that round with them (turn it into a real
      // match, pulling the holder back to that round). Cause-agnostic: covers every way a
      // same-depth player appears — late-join, drop->void survivor, host reset.
      const reclaimUsed = new Set<string>();
      const reclaimUpdates: Array<{ id: string; player1_id: string; player2_id: string; round: number }> = [];
      const freshByes: typeof plan.byes = [];
      for (const b of plan.byes) {
        const pb = matches.find(
          (m) =>
            m.status === 'PENDING_BYE' &&
            m.round === b.round &&
            m.player1_id !== null &&
            m.player1_id !== b.player_id &&
            !reclaimUsed.has(m.id) &&
            !movedOn(m.player1_id, m.round),
        );
        if (pb) {
          reclaimUsed.add(pb.id);
          reclaimUpdates.push({ id: pb.id, player1_id: pb.player1_id!, player2_id: b.player_id, round: pb.round });
        } else {
          freshByes.push(b);
        }
      }
      if (reclaimUpdates.length > 0) {
        for (const u of reclaimUpdates) {
          await fastify.prisma.match.update({
            where: { id: u.id },
            data: { player2_id: u.player2_id, status: 'PENDING' as MatchStatus },
          });
          // Notify + live-update the reclaimed pair like any freshly created match.
          createdMatches.push({ id: u.id, round: u.round, player1_id: u.player1_id, player2_id: u.player2_id });
        }
        mutated = true;
        continue; // re-plan: the pulled-back holders now pair at their bye round
      }

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
      for (const b of freshByes) {
        // A non-final bye is PROVISIONAL (PENDING_BYE): it can still be pulled into a real
        // match if a same-depth opponent turns up (Step B). A final-round bye has no next
        // round to reclaim into, so it scores immediately.
        if (b.round >= roundsCount) {
          const { status, winner } = byeStatusFor(b.player_id);
          rows.push({
            id: randomUUID(),
            tournament_id: tournamentId,
            round: b.round,
            match_number: nextNumber++,
            player1_id: b.player_id,
            player2_id: null,
            status,
            winner_id: winner,
            phase: null as MatchPhase | null,
          });
        } else {
          rows.push({
            id: randomUUID(),
            tournament_id: tournamentId,
            round: b.round,
            match_number: nextNumber++,
            player1_id: b.player_id,
            player2_id: null,
            status: 'PENDING_BYE' as MatchStatus,
            winner_id: null,
            phase: null as MatchPhase | null,
          });
        }
      }
      if (rows.length === 0) break;
      await fastify.prisma.match.createMany({ data: rows });
      mutated = true;
    }

    if (mutated) emitBracketUpdate(fastify.io, tournamentId);
    if (createdMatches.length > 0) {
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

    // After every tick, attempt per-division playoff generation. startBalancedPlayoffs
    // is idempotent: it generates each division once its own (and any borrowed) bands
    // are complete and skips already-generated ones — so the top division can start
    // while lower divisions are still playing, and a fully-generated tournament is a
    // cheap no-op. (Runs on every tick, not just dry ones, so a division that finishes
    // in a tick that also pairs another division still launches immediately.)
    const playoffResult = await startBalancedPlayoffs(fastify, tournamentId);
    if (!('error' in playoffResult) && playoffResult.finals > 0) {
      emitBracketUpdate(fastify.io, tournamentId);
      fastify.log.info({ tournamentId, ...playoffResult }, 'balanced division playoffs generated');
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

/**
 * Admit a single late joiner into a running Balanced Liechtenstein tournament:
 * 1. Assigns their skill band (mirrors assignSkillBandsForTournament for one player).
 * 2. Creates A-1 CATCHUP_BYE placeholder rows for rounds 1..A-1 so that their
 *    depth matches the earliest-active round, preventing a bye-flood from planPairings.
 * 3. Triggers a pairing tick so they are immediately slotted into round A.
 *
 * Entry round A = clamp(max(earliestActiveRound, frontier - 1), 1, rounds_count).
 * All catch-up rounds score 0 (CATCHUP_BYE — distinct from a scoring BYE).
 * Non-fatal on skill-band assignment failure. No-op for wrong format/status.
 */
export async function admitBalancedLateJoiner(
  fastify: FastifyInstance,
  tournamentId: string,
  userId: string,
): Promise<void> {
  const tournament = await fastify.prisma.tournament.findFirst({
    where: { id: tournamentId, deleted_at: null },
    select: { format: true, status: true, rounds_count: true },
  });
  if (!tournament || tournament.format !== 'BALANCED_LIECHTENSTEIN' || tournament.status !== 'ONGOING') {
    return;
  }
  const roundsCount = tournament.rounds_count ?? 5;

  // Step 1 — mark as a late joiner and assign their skill band. The late_joined marker
  // is the persistent signal (not registered_at) for the 0-point catch-up-bye rule, and
  // is set even if band classification fails — a classification hiccup must never turn a
  // late joiner into a scoring-bye farmer.
  const participant = await fastify.prisma.tournamentParticipant.findFirst({
    where: { tournament_id: tournamentId, user_id: userId, deleted_at: null },
    select: { id: true, requested_band: true },
  });
  if (participant) {
    let effective = participant.requested_band ?? 0;
    try {
      const season = await fastify.prisma.season.findFirst({
        where: { is_active: true },
        select: { id: true },
      });
      if (season) {
        const cls = await getPlayerClassification(fastify.prisma, fastify.redis, season.id, userId);
        effective = Math.max(effective, cls.matchmakingBand);
      }
    } catch (err) {
      fastify.log.warn({ err, userId, tournamentId }, 'admitBalancedLateJoiner: skill-band classification failed (non-fatal)');
    }
    await fastify.prisma.tournamentParticipant.update({
      where: { id: participant.id },
      data: { late_joined: true, ...(effective > 0 ? { skill_band: effective } : {}) },
    });
  }

  // Step 2 — compute entry round A.
  const allMatches = await fastify.prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null },
    select: { round: true, status: true, match_number: true },
  });

  const frontier = allMatches.reduce((mx, m) => Math.max(mx, m.round), 0);

  if (frontier === 0) {
    // No matches yet — entry at round 1; no placeholders needed.
    await runBalancedPairingTick(fastify, tournamentId);
    emitBracketUpdate(fastify.io, tournamentId);
    return;
  }

  // Enter at the FRONTIER — the current deepest round — so the late joiner sits at the
  // same depth as the leaders and is paired against a genuine peer, never dropped into a
  // still-open EARLY round where the others have already advanced (which handed out a
  // free scored bye, #5). Rounds 1..A-1 become 0-point CATCHUP_BYE placeholders.
  const A = Math.min(Math.max(frontier, 1), roundsCount);

  // Step 3 — create A-1 CATCHUP_BYE rows for rounds 1..A-1.
  if (A > 1) {
    let next = allMatches.reduce((mx, m) => Math.max(mx, m.match_number), 0) + 1;
    const rows: Array<{
      tournament_id: string;
      round: number;
      match_number: number;
      player1_id: string;
      player2_id: null;
      winner_id: null;
      status: 'CATCHUP_BYE';
      phase: null;
    }> = [];
    for (let r = 1; r < A; r++) {
      rows.push({
        tournament_id: tournamentId,
        round: r,
        match_number: next++,
        player1_id: userId,
        player2_id: null,
        winner_id: null,
        status: 'CATCHUP_BYE',
        phase: null,
      });
    }
    await fastify.prisma.match.createMany({ data: rows });
  }

  // Step 4 — trigger pairing tick (pairs the late joiner from round A onward).
  await runBalancedPairingTick(fastify, tournamentId);
  emitBracketUpdate(fastify.io, tournamentId);
}

export interface BalancedPlayoffResult {
  pools: number;
  finals: number;
}

type PlayoffPhase = 'PLAYOFF_QF' | 'PLAYOFF_SF' | 'PLAYOFF_FINAL' | 'PLAYOFF_THIRD_PLACE';

/**
 * Build the playoff match rows for ONE division from its seed order. The bracket
 * size follows the division size (divisionPlayoffFormat): TOP2 = final only,
 * TOP4 = SF→final, TOP8 = QF→SF→final — each with a third-place match. All rounds
 * are created up front with next_match_id / loser_next_match_id wiring, so
 * completeMatch() advances winners (and SF losers into the small final) on its own
 * (Nicht-DE fills the first empty slot). Seeding is standard: 1v4, and 1v8/4v5/3v6/2v7.
 */
export function buildDivisionBracket(
  seeds: string[],
  tournamentId: string,
  playoffRound: number,
  startMatchNumber: number,
): {
  rows: Prisma.MatchCreateManyInput[];
  playable: Array<{ id: string; round: number; player1_id: string; player2_id: string }>;
  nextMatchNumber: number;
} {
  const fmt = divisionPlayoffFormat(seeds.length);
  const rows: Prisma.MatchCreateManyInput[] = [];
  let n = startMatchNumber;

  const row = (
    id: string,
    round: number,
    player1_id: string | null,
    player2_id: string | null,
    phase: PlayoffPhase,
    next_match_id: string | null,
    loser_next_match_id: string | null,
  ): Prisma.MatchCreateManyInput => ({
    id,
    tournament_id: tournamentId,
    round,
    match_number: n++,
    player1_id,
    player2_id,
    status: 'PENDING' as MatchStatus,
    phase: phase as MatchPhase,
    next_match_id,
    loser_next_match_id,
  });

  if (fmt === 'TOP2') {
    rows.push(row(randomUUID(), playoffRound, seeds[0] ?? null, seeds[1] ?? null, 'PLAYOFF_FINAL', null, null));
    if (seeds[2] && seeds[3]) {
      rows.push(row(randomUUID(), playoffRound, seeds[2], seeds[3], 'PLAYOFF_THIRD_PLACE', null, null));
    }
  } else if (fmt === 'TOP4') {
    const gfId = randomUUID();
    const thirdId = randomUUID();
    rows.push(
      row(randomUUID(), playoffRound, seeds[0]!, seeds[3]!, 'PLAYOFF_SF', gfId, thirdId),
      row(randomUUID(), playoffRound, seeds[1]!, seeds[2]!, 'PLAYOFF_SF', gfId, thirdId),
      row(gfId, playoffRound + 1, null, null, 'PLAYOFF_FINAL', null, null),
      row(thirdId, playoffRound + 1, null, null, 'PLAYOFF_THIRD_PLACE', null, null),
    );
  } else {
    // TOP8 — QF (round N), SF (N+1), GF + 3rd (N+2). Seeding 1v8 / 4v5 / 3v6 / 2v7.
    const gfId = randomUUID();
    const thirdId = randomUUID();
    const sf1Id = randomUUID();
    const sf2Id = randomUUID();
    rows.push(
      row(randomUUID(), playoffRound, seeds[0]!, seeds[7]!, 'PLAYOFF_QF', sf1Id, null),
      row(randomUUID(), playoffRound, seeds[3]!, seeds[4]!, 'PLAYOFF_QF', sf1Id, null),
      row(randomUUID(), playoffRound, seeds[1]!, seeds[6]!, 'PLAYOFF_QF', sf2Id, null),
      row(randomUUID(), playoffRound, seeds[2]!, seeds[5]!, 'PLAYOFF_QF', sf2Id, null),
      row(sf1Id, playoffRound + 1, null, null, 'PLAYOFF_SF', gfId, thirdId),
      row(sf2Id, playoffRound + 1, null, null, 'PLAYOFF_SF', gfId, thirdId),
      row(gfId, playoffRound + 2, null, null, 'PLAYOFF_FINAL', null, null),
      row(thirdId, playoffRound + 2, null, null, 'PLAYOFF_THIRD_PLACE', null, null),
    );
  }

  const playable = rows
    .filter((r) => r.player1_id && r.player2_id)
    .map((r) => ({
      id: r.id as string,
      round: r.round,
      player1_id: r.player1_id as string,
      player2_id: r.player2_id as string,
    }));

  return { rows, playable, nextMatchNumber: n };
}

/**
 * Start the division playoffs once a Balanced Liechtenstein group phase is done:
 * rank players by Swiss standing, form skill-division pools (>=4, filled top-down
 * per §7), and create ONE playoff bracket per division whose size follows the
 * division size (TOP2/TOP4/TOP8, each with a third-place match). Returns an
 * `{ error }` on precondition failure; guarded against double-generation.
 */
export async function startBalancedPlayoffs(
  fastify: FastifyInstance,
  tournamentId: string,
): Promise<BalancedPlayoffResult | { error: string }> {
  const tournament = await fastify.prisma.tournament.findFirst({
    where: { id: tournamentId, deleted_at: null },
    select: { format: true, status: true, rounds_count: true, playoff_format: true },
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
  // Playoffs generate per division (see the loop below), so existing playoff matches
  // no longer block a call — divisions that are still ungenerated can be added.

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

  // No global completeness gate: each division is generated as soon as it (and any
  // band it borrows down into) is complete — see the per-division gate below.

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
    tournamentId,
  );

  const bandByUser = new Map(roster.map((p) => [p.user_id, p.skill_band ?? DEFAULT_BAND]));
  // Only real contenders seed the playoff pools. A participant who is REGISTERED but
  // never CHECKED_IN (or who withdrew) is not a contender and must not appear in a
  // division bracket — this is the "Big Bees" phantom-finalist fix.
  const contenderIds = new Set(contenders.map((p) => p.user_id));
  const ranked = sorted
    .filter((s) => contenderIds.has(s.userId) && !withdrawnIds.has(s.userId))
    .map((s, i) => ({
      userId: s.userId,
      band: bandByUser.get(s.userId) ?? DEFAULT_BAND,
      rank: i + 1,
      rawScore: s.score,
    }));

  const pools = formDivisionPools(
    ranked,
    roundsCount,
    targetPoolSizeFromFormat(tournament.playoff_format),
  );

  // Per-division readiness. A contender is complete once they have played all rounds
  // with no active match; a band is complete once all its contenders are. A division
  // is generated only when every band its pool draws from (its own + any borrowed
  // below) is complete — so its membership + seeding can no longer shift.
  const completedByUser = new Map<string, number>();
  const activeUsers = new Set<string>();
  for (const m of matches) {
    if (m.phase && m.phase !== 'SWISS') continue; // group phase only
    for (const uid of [m.player1_id, m.player2_id]) {
      if (!uid) continue;
      if (BL_ADVANCING.has(m.status)) completedByUser.set(uid, (completedByUser.get(uid) ?? 0) + 1);
      else if (BL_ACTIVE.has(m.status)) activeUsers.add(uid);
    }
  }
  const contenderIsComplete = (uid: string) =>
    (completedByUser.get(uid) ?? 0) >= roundsCount && !activeUsers.has(uid);
  const contendersByBand = new Map<number, string[]>();
  for (const c of contenders) {
    const b = bandByUser.get(c.user_id) ?? DEFAULT_BAND;
    const list = contendersByBand.get(b) ?? [];
    list.push(c.user_id);
    contendersByBand.set(b, list);
  }
  const bandComplete = (b: number) => (contendersByBand.get(b) ?? []).every(contenderIsComplete);

  // A player already seeded into a real playoff match ⇒ their division was generated.
  const alreadyInPlayoff = new Set<string>();
  for (const m of matches) {
    if (m.phase && m.phase !== 'SWISS') {
      if (m.player1_id) alreadyInPlayoff.add(m.player1_id);
      if (m.player2_id) alreadyInPlayoff.add(m.player2_id);
    }
  }

  // Playoff round follows the last GROUP round (stable as more divisions are added);
  // match numbers follow the global max so they never collide with existing rows.
  const groupRounds = matches.filter((m) => m.phase === null || m.phase === 'SWISS');
  const playoffRound = groupRounds.reduce((mx, m) => Math.max(mx, m.round), 0) + 1;
  let nextNumber = matches.reduce((mx, m) => Math.max(mx, m.match_number), 0) + 1;
  const rows: Prisma.MatchCreateManyInput[] = [];
  const allPlayable: Array<{ id: string; round: number; player1_id: string; player2_id: string }> = [];
  let brackets = 0;

  // One playoff bracket per division, generated once it is ready and not already done.
  for (const pool of pools) {
    if (pool.seeds.length < 2) continue; // a lone champion needs no bracket
    if (pool.seeds.some((s) => alreadyInPlayoff.has(s))) continue; // already generated
    const spanBands = new Set(pool.players.map((p) => p.band));
    if (![...spanBands].every(bandComplete)) continue; // wait for borrowed bands to finish
    const built = buildDivisionBracket(pool.seeds, tournamentId, playoffRound, nextNumber);
    rows.push(...built.rows);
    allPlayable.push(...built.playable);
    nextNumber = built.nextMatchNumber;
    brackets += 1;
  }

  if (rows.length > 0) {
    await fastify.prisma.match.createMany({ data: rows });
    emitBracketUpdate(fastify.io, tournamentId);
    // Announce only the first playoff round's ready matches (both players present).
    const firstRound = Math.min(...allPlayable.map((m) => m.round));
    const firstRoundPlayable = allPlayable.filter((m) => m.round === firstRound);
    if (firstRoundPlayable.length > 0) {
      await notifyMatchesCreated(tournamentId, firstRound, firstRoundPlayable);
    }
  }

  return { pools: pools.length, finals: brackets };
}
