// ---------------------------------------------------------------------------
// Liechtenstein ASAP engine (2026-09) — a Swiss/BaLi hybrid.
//
// Matches are generated ASAP (like BaLi: a player is paired the moment they + a
// suitable opponent are free), pairing is by Swiss points (planLiechtensteinPairings),
// and rematches are HARD-excluded. No skill bands. Each player plays `rounds_count`
// matches; then optional TOP-N playoffs (host choice), else standings are final.
//
// Unlike BaLi this needs NO PENDING_BYE placeholder / reclaim machinery: a "held"
// player simply has no open match and is re-considered on the next tick. Only real
// (scoring) byes and late-join catch-up byes create rows.
// ---------------------------------------------------------------------------

import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { MatchStatus } from '@rizzotto/db';
import {
  computeSwissStandings,
  sortSwissStandings,
  type CompletedMatchRecord,
} from './swiss.js';
import { planLiechtensteinPairings, type LPlayer } from './liechtenstein-pairing.js';
import { generatePlayoffBracket, InsufficientPlayersError } from './playoff-generator.js';
import { emitBracketUpdate } from './emit.js';
import { recordTournamentEvent } from './tournament-events.js';
import { notifyMatchesCreated } from './discord-notify.js';

const LOCK_TTL_SECONDS = 30;
const RELEASE_LOCK = `if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end`;
/** Statuses that occupy a slot but aren't finished — the player is "in-progress". */
const OPEN_STATUSES = new Set<MatchStatus>(['PENDING', 'ONGOING', 'AWAITING_CONFIRMATION', 'DISPUTED']);
/** Statuses to feed computeSwissStandings. */
const SCORING_STATUSES = new Set<string>(['COMPLETED', 'BYE', 'FORFEIT', 'NO_CONTEST', 'CATCHUP_BYE']);

interface TickMatch {
  id: string;
  round: number;
  match_number: number;
  player1_id: string | null;
  player2_id: string | null;
  winner_id: string | null;
  status: MatchStatus;
  phase: string | null;
  player1_game_wins: number;
  player2_game_wins: number;
}

/**
 * Run one ASAP pairing tick for a Liechtenstein tournament: pair every currently-free player it
 * can (score-optimal, no rematches), bye genuine dead-ends, and — once the whole field has played
 * its target rounds — generate the optional TOP-N playoffs. Idempotent + Redis-lock-guarded, so it
 * is safe to fire from every completion/forfeit/drop hook and from the reconciler cron.
 */
export async function runLiechtensteinPairingTick(
  fastify: FastifyInstance,
  tournamentId: string,
): Promise<void> {
  const redis = fastify.redis;
  const lockKey = `rizzotto:li:tick:${tournamentId}:lock`;
  const pendingKey = `rizzotto:li:tick:${tournamentId}:pending`;
  const token = randomUUID();
  let roundsCount: number;

  try {
    const tournament = await fastify.prisma.tournament.findFirst({
      where: { id: tournamentId, deleted_at: null },
      select: { format: true, status: true, rounds_count: true },
    });
    if (!tournament || tournament.format !== 'LIECHTENSTEIN' || tournament.status !== 'ONGOING') return;
    roundsCount = tournament.rounds_count ?? 5;

    if (redis) {
      const acquired = await redis.set(lockKey, token, 'EX', LOCK_TTL_SECONDS, 'NX');
      if (acquired !== 'OK') {
        await redis.set(pendingKey, '1', 'EX', LOCK_TTL_SECONDS); // flag a re-run for the holder
        return;
      }
      await redis.del(pendingKey);
    }
  } catch (err) {
    fastify.log.error({ err, tournamentId }, 'Liechtenstein tick: guard/lock failed');
    return;
  }

  try {
    const [roster, matchesRaw] = await Promise.all([
      fastify.prisma.tournamentParticipant.findMany({
        where: { tournament_id: tournamentId, deleted_at: null, status: { in: ['REGISTERED', 'CHECKED_IN'] } },
        select: { user_id: true, team_id: true, status: true, late_joined: true },
      }),
      fastify.prisma.match.findMany({
        where: { tournament_id: tournamentId, deleted_at: null },
        select: {
          id: true, round: true, match_number: true, player1_id: true, player2_id: true,
          winner_id: true, status: true, phase: true,
          games: { where: { status: 'COMPLETED' }, select: { winner_id: true } },
        },
      }),
    ]);

    // Identity = opaque competitor id (team for 2v2, else user) — engine is identity-agnostic.
    const participants = roster.map((p) => ({
      id: p.team_id ?? p.user_id,
      status: p.status,
      lateJoined: p.late_joined,
    }));
    const anyCheckedIn = participants.some((p) => p.status === 'CHECKED_IN');
    const active = anyCheckedIn ? participants.filter((p) => p.status === 'CHECKED_IN') : participants;
    const activeIds = new Set(active.map((p) => p.id));

    const matches: TickMatch[] = matchesRaw.map((m) => {
      let p1w = 0;
      let p2w = 0;
      for (const g of m.games) {
        if (g.winner_id === m.player1_id) p1w++;
        else if (g.winner_id === m.player2_id) p2w++;
      }
      return { ...m, status: m.status as MatchStatus, player1_game_wins: p1w, player2_game_wins: p2w };
    });

    // Per-competitor state. `committed` = advancing/open REAL rounds — it EXCLUDES a reclaimable
    // PENDING_BYE (a provisional "resting" marker at round committed+1). A held player rests on a
    // PENDING_BYE that either reclaims into a real match (a partner frees) or crystallises into a
    // scoring bye once the field moves past it — this is what stops the odd-one-out being starved.
    const committed = new Map<string, number>();
    const openMatch = new Set<string>();
    const played = new Map<string, Set<string>>();
    const receivedBye = new Set<string>();
    const restingBye = new Map<string, { id: string; round: number }>(); // holder → their PENDING_BYE row
    let maxAdvancedRound = 0;
    for (const id of activeIds) played.set(id, new Set());
    for (const m of matches) {
      if (m.status === 'CANCELLED') continue;
      if (m.status === 'PENDING_BYE') {
        if (m.player1_id) restingBye.set(m.player1_id, { id: m.id, round: m.round });
        continue; // provisional rest marker — not a completed round, not an opponent
      }
      maxAdvancedRound = Math.max(maxAdvancedRound, m.round);
      for (const pid of [m.player1_id, m.player2_id]) {
        if (pid && activeIds.has(pid)) committed.set(pid, (committed.get(pid) ?? 0) + 1);
      }
      if (OPEN_STATUSES.has(m.status)) {
        if (m.player1_id) openMatch.add(m.player1_id);
        if (m.player2_id) openMatch.add(m.player2_id);
      }
      // played = anyone paired with (real 2-player match), any non-cancelled status → hard rematch.
      if (m.player1_id && m.player2_id) {
        played.get(m.player1_id)?.add(m.player2_id);
        played.get(m.player2_id)?.add(m.player1_id);
      }
      if (m.status === 'BYE') {
        const b = m.player1_id ?? m.player2_id;
        if (b) receivedBye.add(b);
      }
    }

    // Crystallise: a PENDING_BYE the field has moved PAST (a real/scored match exists at a later
    // round) can no longer be reclaimed → it becomes a scored bye (the holder genuinely sat out).
    let mutatedByCrystallise = false;
    for (const [holder, bye] of [...restingBye]) {
      if (bye.round < maxAdvancedRound) {
        await fastify.prisma.match.update({ where: { id: bye.id }, data: { status: 'BYE', winner_id: holder } });
        committed.set(holder, (committed.get(holder) ?? 0) + 1);
        receivedBye.add(holder);
        restingBye.delete(holder);
        mutatedByCrystallise = true;
      }
    }

    // Standings (Swiss points) over the scoring matches — the pairing score + playoff seed.
    const scoringRecords: CompletedMatchRecord[] = matches
      .filter((m) => SCORING_STATUSES.has(m.status))
      .map((m) => ({
        round: m.round,
        player1_id: m.player1_id,
        player2_id: m.player2_id,
        winner_id: m.winner_id,
        status: m.status,
        player1_game_wins: m.player1_game_wins,
        player2_game_wins: m.player2_game_wins,
      }));
    const standings = computeSwissStandings([...activeIds], scoringRecords);
    const scoreOf = new Map(standings.map((s) => [s.userId, s.score]));

    // The pool = active players who still owe a match (committed < target). free = idle (no open match).
    const pool: LPlayer[] = active
      .filter((p) => (committed.get(p.id) ?? 0) < roundsCount)
      .map((p) => ({
        id: p.id,
        score: scoreOf.get(p.id) ?? 0,
        played: played.get(p.id) ?? new Set(),
        free: !openMatch.has(p.id),
        receivedBye: receivedBye.has(p.id),
      }));

    const plan = planLiechtensteinPairings(pool, tournamentId);

    // Next match_number per round (across existing rows + rows we add this tick).
    const nextMatchNo = new Map<number, number>();
    for (const m of matches) nextMatchNo.set(m.round, Math.max(nextMatchNo.get(m.round) ?? 0, m.match_number));
    const takeMatchNo = (round: number): number => {
      const n = (nextMatchNo.get(round) ?? 0) + 1;
      nextMatchNo.set(round, n);
      return n;
    };
    const roundFor = (a: string, b?: string): number =>
      Math.max(committed.get(a) ?? 0, b ? committed.get(b) ?? 0 : 0) + 1;

    const rows: Array<{
      id: string; tournament_id: string; round: number; match_number: number;
      player1_id: string; player2_id: string | null; status: MatchStatus; winner_id: string | null; phase: null;
    }> = [];
    const created: Array<{ id: string; round: number; player1_id: string; player2_id: string }> = [];
    const byesToDelete: string[] = []; // reclaimed PENDING_BYE rows (holder is now getting a real match)
    const byesToScore: string[] = [];  // PENDING_BYE rows to crystallise → scored BYE (resting player byed)

    for (const [a, b] of plan.pairs) {
      const round = roundFor(a, b);
      // Reclaim: if either player was resting on a PENDING_BYE, remove it — they play a real match now.
      const ra = restingBye.get(a);
      if (ra) byesToDelete.push(ra.id);
      const rb = restingBye.get(b);
      if (rb) byesToDelete.push(rb.id);
      const id = randomUUID();
      rows.push({ id, tournament_id: tournamentId, round, match_number: takeMatchNo(round), player1_id: a, player2_id: b, status: 'PENDING', winner_id: null, phase: null });
      created.push({ id, round, player1_id: a, player2_id: b });
    }
    // Held → provisional rest: a PENDING_BYE the player waits on (reclaimed/crystallised on a later
    // tick). No starvation: they always have a slot that either becomes a match or scores as a bye.
    for (const holderId of plan.held) {
      if (restingBye.has(holderId)) continue; // already resting → keep the existing marker
      const round = roundFor(holderId);
      rows.push({ id: randomUUID(), tournament_id: tournamentId, round, match_number: takeMatchNo(round), player1_id: holderId, player2_id: null, status: 'PENDING_BYE', winner_id: null, phase: null });
    }
    for (const byeId of plan.byes) {
      const existing = restingBye.get(byeId);
      if (existing) {
        byesToScore.push(existing.id); // a resting player with no partner left → their rest scores
      } else {
        const round = roundFor(byeId);
        rows.push({ id: randomUUID(), tournament_id: tournamentId, round, match_number: takeMatchNo(round), player1_id: byeId, player2_id: null, status: 'BYE', winner_id: byeId, phase: null });
      }
      committed.set(byeId, (committed.get(byeId) ?? 0) + 1);
    }

    let mutated = mutatedByCrystallise;
    if (byesToDelete.length > 0) {
      await fastify.prisma.match.deleteMany({ where: { id: { in: byesToDelete } } });
      mutated = true;
    }
    for (const id of byesToScore) {
      const holder = [...restingBye].find(([, b]) => b.id === id)?.[0];
      await fastify.prisma.match.update({ where: { id }, data: { status: 'BYE', winner_id: holder ?? null } });
      mutated = true;
    }
    if (rows.length > 0) {
      await fastify.prisma.match.createMany({ data: rows });
      mutated = true;
      void recordTournamentEvent({ tournamentId, type: 'matches_created', actor: 'system', payload: { phase: 'liechtenstein', count: rows.length } });
    }

    // Group phase complete → generate the optional TOP-N playoffs once (idempotent). `committed`
    // excludes a provisional rest (PENDING_BYE), so a resting player has committed < target and
    // still owes — the tournament isn't finished while anyone rests or has an open match.
    const anyOwes = active.some((p) => (committed.get(p.id) ?? 0) < roundsCount);
    const anyOpen =
      matches.some((m) => OPEN_STATUSES.has(m.status)) ||
      rows.some((r) => r.status === 'PENDING' || r.status === 'PENDING_BYE');
    if (!anyOwes && !anyOpen) {
      if (await maybeGenerateLiechtensteinPlayoffs(fastify, tournamentId, standings, scoringRecords, activeIds)) {
        mutated = true;
      }
    }

    if (mutated) emitBracketUpdate(fastify.io, tournamentId);
    if (created.length > 0) {
      const byRound = new Map<number, typeof created>();
      for (const m of created) {
        const list = byRound.get(m.round) ?? [];
        list.push(m);
        byRound.set(m.round, list);
      }
      for (const [round, ms] of byRound) {
        await notifyMatchesCreated(tournamentId, round, ms.map((m) => ({ id: m.id, player1_id: m.player1_id, player2_id: m.player2_id })));
      }
    }
  } catch (err) {
    fastify.log.error({ err, tournamentId }, 'Liechtenstein pairing tick failed');
  } finally {
    if (redis) {
      try {
        await redis.eval(RELEASE_LOCK, 1, lockKey, token);
      } catch {
        /* lock expires on its own */
      }
    }
  }

  if (redis && (await redis.get(pendingKey)) === '1') {
    await redis.del(pendingKey);
    return runLiechtensteinPairingTick(fastify, tournamentId);
  }
}

/** Generate the TOP-N playoff bracket after the group phase, once. Returns true if it created rows. */
async function maybeGenerateLiechtensteinPlayoffs(
  fastify: FastifyInstance,
  tournamentId: string,
  standings: ReturnType<typeof computeSwissStandings>,
  scoringRecords: CompletedMatchRecord[],
  activeIds: Set<string>,
): Promise<boolean> {
  const tournament = await fastify.prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { playoff_format: true, playoff_match_format: true, finale_match_format: true },
  });
  if (!tournament || !tournament.playoff_format || tournament.playoff_format === 'NONE') return false;

  // Idempotent: never regenerate once any playoff match exists.
  const existing = await fastify.prisma.match.count({
    where: {
      tournament_id: tournamentId,
      deleted_at: null,
      phase: { in: ['PLAYOFF_QF', 'PLAYOFF_SF', 'PLAYOFF_FINAL', 'PLAYOFF_THIRD_PLACE'] },
    },
  });
  if (existing > 0) return false;

  // Offset playoff rounds after the last group round (group matches have phase null).
  const groupMatches = await fastify.prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null, phase: null },
    select: { round: true },
  });
  const offset = groupMatches.length > 0 ? Math.max(...groupMatches.map((m) => m.round)) : 0;

  const sorted = sortSwissStandings(standings, scoringRecords, tournamentId);
  let result;
  try {
    result = generatePlayoffBracket({
      tournament: {
        playoff_format: tournament.playoff_format as 'NONE' | 'TOP2' | 'TOP4' | 'TOP8',
        playoff_match_format: tournament.playoff_match_format,
        finale_match_format: tournament.finale_match_format,
      },
      finalStandings: sorted,
      checkedInPlayerIds: activeIds,
    });
  } catch (err) {
    if (err instanceof InsufficientPlayersError) return false;
    throw err;
  }

  const phaseMap: Record<number, 'PLAYOFF_QF' | 'PLAYOFF_SF' | 'PLAYOFF_FINAL'> =
    result.format === 'TOP8'
      ? { 1: 'PLAYOFF_QF', 2: 'PLAYOFF_SF', 3: 'PLAYOFF_FINAL' }
      : result.format === 'TOP2'
        ? { 1: 'PLAYOFF_FINAL' }
        : { 1: 'PLAYOFF_SF', 2: 'PLAYOFF_FINAL' };

  // Only the first playoff round is generated now; later rounds advance via POST /advance-playoffs.
  const round1 = result.matches.filter((pm) => pm.round === 1);
  if (round1.length === 0) return false;
  await fastify.prisma.match.createMany({
    data: round1.map((pm) => ({
      id: randomUUID(),
      tournament_id: tournamentId,
      round: offset + pm.round,
      match_number: pm.bracket_position,
      player1_id: pm.player1_id || null,
      player2_id: pm.player2_id || null,
      status: 'PENDING' as MatchStatus,
      next_match_id: null,
      phase: phaseMap[pm.round] ?? null,
      winner_id: null,
    })),
  });
  void recordTournamentEvent({ tournamentId, type: 'matches_created', actor: 'system', payload: { phase: 'liechtenstein_playoff', count: round1.length } });
  return true;
}

/**
 * Reconciler safety net: run a pairing tick for every ONGOING Liechtenstein tournament on a fixed
 * cadence, independent of the completion/forfeit/drop hooks. Idempotent + lock-guarded → only ever
 * closes a genuine gap (a missed trigger that left a finished field un-paired or playoffs un-generated).
 */
/**
 * Admit a late joiner into a running Liechtenstein tournament: give them 0-point CATCHUP_BYE
 * placeholders up to the field's frontier (so they finish alongside everyone, playing the remaining
 * real rounds), then run a tick to slot them in ASAP. No-op for the wrong format/status.
 * `competitorId` is the opaque id (team for 2v2, else user).
 */
export async function admitLiechtensteinLateJoiner(
  fastify: FastifyInstance,
  tournamentId: string,
  competitorId: string,
): Promise<void> {
  const t = await fastify.prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { status: true, format: true, rounds_count: true },
  });
  if (!t || t.format !== 'LIECHTENSTEIN' || t.status !== 'ONGOING') return;

  // Catch the joiner up to the field's depth = the most matches any existing player has committed
  // (so they finish alongside everyone). Capped at rounds−1 so they always play at least one real match.
  const existing = await fastify.prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null, status: { not: 'CANCELLED' } },
    select: { player1_id: true, player2_id: true },
  });
  const committed = new Map<string, number>();
  for (const m of existing) {
    for (const pid of [m.player1_id, m.player2_id]) {
      if (pid && pid !== competitorId) committed.set(pid, (committed.get(pid) ?? 0) + 1);
    }
  }
  const maxCommitted = committed.size > 0 ? Math.max(...committed.values()) : 0;
  const catchup = Math.min(maxCommitted, (t.rounds_count ?? 5) - 1);
  try {
    for (let r = 1; r <= catchup; r++) {
      const a = await fastify.prisma.match.aggregate({
        where: { tournament_id: tournamentId, round: r },
        _max: { match_number: true },
      });
      await fastify.prisma.match.create({
        data: {
          tournament_id: tournamentId,
          round: r,
          match_number: (a._max.match_number ?? 0) + 1,
          player1_id: competitorId,
          player2_id: null,
          status: 'CATCHUP_BYE',
          winner_id: null,
          phase: null,
        },
      });
    }
  } catch (err) {
    fastify.log.warn({ err, tournamentId }, 'Liechtenstein late-join catch-up byes failed');
  }
  await runLiechtensteinPairingTick(fastify, tournamentId);
}

export async function reconcileLiechtensteinTournaments(fastify: FastifyInstance): Promise<number> {
  const tournaments = await fastify.prisma.tournament.findMany({
    where: { format: 'LIECHTENSTEIN', status: 'ONGOING', deleted_at: null },
    select: { id: true },
  });
  for (const t of tournaments) {
    await runLiechtensteinPairingTick(fastify, t.id).catch((err) =>
      fastify.log.error({ err, tournamentId: t.id }, 'Liechtenstein reconcile tick failed'),
    );
  }
  return tournaments.length;
}
