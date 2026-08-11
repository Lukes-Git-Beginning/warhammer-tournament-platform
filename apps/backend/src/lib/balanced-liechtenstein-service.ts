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
import type { PlayoffPreview, PlayoffPreviewDivision } from '@rizzotto/types';
import {
  planPairings,
  formDivisionPools,
  divisionPlayoffFormat,
  targetPoolSizeFromFormat,
  DEFAULT_BAND,
  seededShuffle,
  MAX_BAND,
  type RankedPlayer,
} from './balanced-liechtenstein.js';
import {
  derivePlayoffPlan,
  resolvePoolsFromPlan,
  bracketSeeds,
  type PlayoffPlan,
} from './bali-playoff-plan.js';
import { isLegalLateJoinReclaim } from './bali-pairing-cost.js';
import { computeSwissStandings, sortSwissStandings, type CompletedMatchRecord } from './swiss.js';
import { getPlayerClassification } from './skill-classification-service.js';
import { balancedRounds } from './auto-swiss-service.js';
import { emitBracketUpdate } from './emit.js';
import { notifyMatchesCreated, notifyFinalRoundBye } from './discord-notify.js';

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
 * Players who have already had a rest-bye and must not get another (never-bye-twice). Pure.
 * - A real (BYE) or provisional (PENDING_BYE) rest-bye counts — the holder sat out alone (no opponent).
 * - A NO_CONTEST counts for BOTH players: it is a technical-abort double-bye (both got a bye point with
 *   no decisive game), so treating it as a rest-bye stops a no-contest player being handed another free
 *   bye on top (two free points, fewer real games — the very inequity the rule guards against).
 * - A CATCHUP_BYE does NOT count: a still-catching-up player stays bye-eligible until they play a real game.
 */
export function computeRestByePlayers(
  matches: Array<{ status: string; player1_id: string | null; player2_id: string | null }>,
): Set<string> {
  const set = new Set<string>();
  for (const m of matches) {
    if ((m.status === 'BYE' || m.status === 'PENDING_BYE') && m.player1_id && !m.player2_id) {
      set.add(m.player1_id);
    } else if (m.status === 'NO_CONTEST') {
      if (m.player1_id) set.add(m.player1_id);
      if (m.player2_id) set.add(m.player2_id);
    }
  }
  return set;
}

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

  const rounds = balancedRounds(count);

  // Auto-sizing owns ONLY the round count for Balanced Liechtenstein. The playoff
  // size drives division formation (homogeneous band-pure divisions vs. few large
  // mixed brackets), which is a deliberate host choice — not a function of the head
  // count. Leave playoff_format at the host's stored value.
  await fastify.prisma.tournament.update({
    where: { id: tournamentId },
    data: { rounds_count: rounds },
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
  const pendingKey = `rizzotto:bl:tick:${tournamentId}:pending`;
  const token = randomUUID();

  if (redis) {
    const acquired = await redis.set(lockKey, token, 'EX', LOCK_TTL_SECONDS, 'NX');
    if (acquired !== 'OK') {
      // Another tick is running. Don't drop this trigger — flag a re-run so the holder
      // re-processes the latest state after it finishes. Without this, a burst of triggers
      // (e.g. several near-simultaneous withdrawals) can leave the final, now-complete field
      // un-processed → the per-division playoffs never auto-generate (the case that needed a
      // manual start-playoffs on an already-finished field).
      await redis.set(pendingKey, '1', 'EX', LOCK_TTL_SECONDS);
      return;
    }
    await redis.del(pendingKey); // we hold the lock → we'll read the freshest state; clear the flag
  }

  try {

    const createdMatches: Array<{
      id: string;
      round: number;
      player1_id: string;
      player2_id: string;
    }> = [];
    // Final-round BYE holders (scored BYE only) — DM'd separately with a playoff outlook.
    const finalRoundByePlayers: string[] = [];
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
            winner_id: true,
            status: true,
            phase: true,
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
      // A late joiner still "catching up" = the persistent marker is set AND they have no real
      // (COMPLETED) game yet. Drives both the 0-point catch-up-bye rule and the reclaim gate below.
      const hasPlayedReal = (userId: string): boolean =>
        matches.some((m) => (m.player1_id === userId || m.player2_id === userId) && m.status === 'COMPLETED');
      const isCatchingUp = (userId: string): boolean => lateJoinedSet.has(userId) && !hasPlayedReal(userId);
      // 0-point rule (marker-based): a still-catching-up late joiner only ever gets 0-point
      // CATCHUP_BYEs, never a scoring bye — closes the "reward for being late" hole.
      const byeStatusFor = (userId: string): { status: MatchStatus; winner: string | null } =>
        isCatchingUp(userId)
          ? { status: 'CATCHUP_BYE' as MatchStatus, winner: null }
          : { status: 'BYE' as MatchStatus, winner: userId };

      // Step A — crystallise any PENDING_BYE whose holder has moved on: it can no longer be
      // reclaimed into a real match, so it becomes a scored bye (or a 0-point catch-up bye
      // for a late joiner with no real game yet). Re-loop so the plan sees the fresh data.
      const toCrystallise = matches.filter(
        (m) => m.status === 'PENDING_BYE' && m.player1_id !== null && movedOn(m.player1_id, m.round),
      );
      if (toCrystallise.length > 0) {
        const crystallisedByes: Array<{ id: string; round: number; player1_id: string }> = [];
        for (const m of toCrystallise) {
          const { status, winner } = byeStatusFor(m.player1_id!);
          await fastify.prisma.match.update({ where: { id: m.id }, data: { status, winner_id: winner } });
          // Only a real (scored) BYE earns the encouraging DM — a 0-point CATCHUP_BYE is a
          // late-join placeholder, not a "free win", so it stays silent.
          if (status === 'BYE') crystallisedByes.push({ id: m.id, round: m.round, player1_id: m.player1_id! });
        }
        // The provisional PENDING_BYE was intentionally silent (it could still be reclaimed);
        // now that it is final, DM the bye player — closes the "BaLi byes never notify" gap.
        const byRound = new Map<number, typeof crystallisedByes>();
        for (const b of crystallisedByes) {
          const l = byRound.get(b.round) ?? [];
          l.push(b);
          byRound.set(b.round, l);
        }
        for (const [round, bs] of byRound) {
          await notifyMatchesCreated(tournamentId, round, bs.map((b) => ({ id: b.id, player1_id: b.player1_id, player2_id: null })));
        }
        mutated = true;
        continue;
      }

      // Bye pre-selection (Alex 2026-07-23): the odd-count bye goes to the weakest active
      // player by handicap-adjusted Swiss score (0.2 per PLAYED round per band below the top),
      // never byed twice — decided BEFORE the holistic optimum runs, so a lone weak player takes
      // a bye instead of a hopeless 3-band play-up. Outside BaLi every band is equal → handicap
      // 0 → plain lowest score, exactly the Swiss bye rule.
      const completedForScore: CompletedMatchRecord[] = matches
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
        }));
      const scoreByUser = new Map(
        computeSwissStandings(
          participants.map((p) => p.user_id),
          completedForScore,
          new Set<string>(),
        ).map((s) => [s.userId, s.score]),
      );
      const bandByUser = new Map(participants.map((p) => [p.user_id, p.skill_band ?? DEFAULT_BAND]));
      // "Never bye the same player twice" — but a CATCHUP_BYE is a 0-point late-join placeholder,
      // NOT a rest, so it must not disqualify a catching-up player from a genuine bye (Alex
      // 2026-08-06). Counting it did: a peerless late joiner (e.g. a lone top-band player admitted
      // mid-event) was excluded from the odd-round bye, so the bye went to someone else and the
      // late joiner was FORCE-PAIRED into a far-band stomp — and that stomp then raised the round's
      // worst gap, letting a later reclaim of the same size slip past isLegalLateJoinReclaim.
      // Who has already had a rest-bye and must not get another (never-bye-twice) — see
      // computeRestByePlayers. Includes NO_CONTEST (a double-bye), excludes CATCHUP_BYE.
      const hadBye = computeRestByePlayers(matches);
      const pickBye = (candidateIds: string[], round: number): string[] => {
        const eligible = candidateIds.filter((id) => !hadBye.has(id));
        const pool = eligible.length > 0 ? eligible : candidateIds; // all already byed → any
        const played = Math.max(0, round - 1); // handicap only over rounds already played
        const adj = (id: string) =>
          (scoreByUser.get(id) ?? 0) - 0.2 * played * (MAX_BAND - (bandByUser.get(id) ?? MAX_BAND));
        // Eligible candidates, weakest (lowest handicap-adjusted score) first; ties are broken
        // deterministically per round. The engine byes whichever creates the fewest play-ups.
        return [...seededShuffle(pool, `${tournamentId}:${round}:bye`)].sort((a, b) => adj(a) - adj(b));
      };

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
        pickBye,
        hadBye, // never-bye-twice: force-match already-rested players (no far-band stomp) — see MUST_PAIR_BONUS
      );
      if (plan.pairings.length === 0 && plan.byes.length === 0) break;

      // Step B — RECLAIM: rather than sit a fresh same-depth player on a bye, fill an
      // existing still-reclaimable PENDING_BYE at that round with them (turn it into a real
      // match, pulling the holder back to that round). Cause-agnostic: covers every way a
      // same-depth player appears — late-join, drop->void survivor, host reset.
      const reclaimUsed = new Set<string>();
      const reclaimUpdates: Array<{ id: string; player1_id: string; player2_id: string; round: number }> = [];
      const freshByes: typeof plan.byes = [];
      const bandOf = (id: string): number => bandByUser.get(id) ?? DEFAULT_BAND;
      for (const b of plan.byes) {
        // #11 (Alex 2026-07-24): a reclaim that accommodates a still-catching-up late joiner must be
        // a LEGAL pairing — its band gap may not EXCEED the round's current worst committed gap (so a
        // late join is never the round's biggest gap), and it may not be an immediate rematch. If no
        // legal bye-partner is available they both stay on provisional byes and fold into a later
        // round's optimum. Normal (non-late) holds during round formation reclaim freely, as before.
        const bCatchup = isCatchingUp(b.player_id);
        const committedGaps = matches
          .filter((m) => m.round === b.round && m.player1_id && m.player2_id && m.status !== 'CANCELLED')
          .map((m) => Math.abs(bandOf(m.player1_id!) - bandOf(m.player2_id!)));
        const roundMaxGap = committedGaps.length > 0 ? Math.max(...committedGaps) : 0;
        const isLegalReclaim = (holderId: string): boolean =>
          isLegalLateJoinReclaim({
            involvesCatchup: bCatchup || isCatchingUp(holderId),
            holderBand: bandOf(holderId),
            joinerBand: bandOf(b.player_id),
            roundMaxGap,
            immediateRematch: matches.some(
              (x) =>
                x.round === b.round - 1 &&
                ((x.player1_id === holderId && x.player2_id === b.player_id) ||
                  (x.player1_id === b.player_id && x.player2_id === holderId)),
            ),
          });
        const pb = matches.find(
          (m) =>
            m.status === 'PENDING_BYE' &&
            m.round === b.round &&
            m.player1_id !== null &&
            m.player1_id !== b.player_id &&
            !reclaimUsed.has(m.id) &&
            !movedOn(m.player1_id, m.round) &&
            isLegalReclaim(m.player1_id),
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
          const byeId = randomUUID();
          rows.push({
            id: byeId,
            tournament_id: tournamentId,
            round: b.round,
            match_number: nextNumber++,
            player1_id: b.player_id,
            player2_id: null,
            status,
            winner_id: winner,
            phase: null as MatchPhase | null,
          });
          // A final-round scored BYE is final immediately → DM the player with a playoff
          // outlook (below). A 0-point catch-up bye stays silent.
          if (status === 'BYE') finalRoundByePlayers.push(b.player_id);
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

    // Final-round byes get a tailored DM with a PROVISIONAL playoff outlook (they've finished
    // their group phase; playoffs — not another round — follow). The definitive news is the
    // playoff-pairing DM when a division bracket is generated.
    if (finalRoundByePlayers.length > 0) {
      const qualifiers = await provisionalPlayoffQualifiers(fastify, tournamentId);
      const tRow = await fastify.prisma.tournament.findUnique({
        where: { id: tournamentId },
        select: { name: true, slug: true, stream_url: true },
      });
      if (tRow) {
        const users = await fastify.prisma.user.findMany({
          where: { id: { in: finalRoundByePlayers } },
          select: { id: true, discord_id: true, username: true },
        });
        for (const u of users) {
          if (!u.discord_id) continue;
          await notifyFinalRoundBye(
            { name: tRow.name, slug: tRow.slug, stream_url: tRow.stream_url },
            { discord_id: u.discord_id, username: u.username },
            { inPlayoffZone: qualifiers.has(u.id) },
          );
        }
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

  // A trigger that arrived while we held the lock flagged a re-run — process the now-latest state
  // so nothing is lost (e.g. the final withdrawal in a burst that just completed the field, which
  // otherwise leaves the auto playoff-generation un-triggered).
  if (redis && (await redis.get(pendingKey)) === '1') {
    await redis.del(pendingKey);
    return runBalancedPairingTick(fastify, tournamentId);
  }
}

/**
 * Reconciler safety net (Alex 2026-08-07): run a pairing tick for every ONGOING Balanced
 * Liechtenstein tournament on a fixed cadence, independent of the completion / forfeit / manual-edit
 * hooks. The tick is idempotent and Redis-lock-guarded; mid-round it is a no-op, and its playoff
 * generation skips already-generated divisions. So this only ever closes a genuine gap — a missed
 * trigger that left a finished field un-paired or its per-division playoffs un-generated (the
 * "playoffs stuck, nothing generates" case). Returns the number of tournaments reconciled.
 */
export async function reconcileBalancedTournaments(fastify: FastifyInstance): Promise<number> {
  const tournaments = await fastify.prisma.tournament.findMany({
    where: { format: 'BALANCED_LIECHTENSTEIN', status: 'ONGOING', deleted_at: null },
    select: { id: true },
  });
  for (const t of tournaments) {
    await runBalancedPairingTick(fastify, t.id).catch((err) =>
      fastify.log.error({ err, tournamentId: t.id }, 'BaLi reconcile tick failed'),
    );
  }
  return tournaments.length;
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
    select: { round: true, status: true, match_number: true, player1_id: true, player2_id: true },
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

  // Step 3 — create CATCHUP_BYE rows for rounds 1..A-1, but ONLY where this player has
  // no node yet. A returning drop (undrop mid-event) already holds real matches for the
  // rounds they played, so we backfill just the gaps — never duplicating an already-played
  // round. This keeps the backfill idempotent and safe to reuse from both late-join and
  // undrop (e.g. play R1, drop, return at R6 → only R2..R5 get catch-up byes).
  if (A > 1) {
    const playedRounds = new Set(
      allMatches
        .filter((m) => m.player1_id === userId || m.player2_id === userId)
        .map((m) => m.round),
    );
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
      if (playedRounds.has(r)) continue; // already has a node this round — don't duplicate
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
    if (rows.length > 0) await fastify.prisma.match.createMany({ data: rows });
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
  hasThirdPlace: boolean,
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
    if (hasThirdPlace && seeds[2] && seeds[3]) {
      rows.push(row(randomUUID(), playoffRound, seeds[2], seeds[3], 'PLAYOFF_THIRD_PLACE', null, null));
    }
  } else if (fmt === 'TOP4') {
    const gfId = randomUUID();
    // No third-place match → the SF losers advance nowhere (loser_next_match_id stays null).
    const thirdId = hasThirdPlace ? randomUUID() : null;
    rows.push(
      row(randomUUID(), playoffRound, seeds[0]!, seeds[3]!, 'PLAYOFF_SF', gfId, thirdId),
      row(randomUUID(), playoffRound, seeds[1]!, seeds[2]!, 'PLAYOFF_SF', gfId, thirdId),
      row(gfId, playoffRound + 1, null, null, 'PLAYOFF_FINAL', null, null),
    );
    if (thirdId) {
      rows.push(row(thirdId, playoffRound + 1, null, null, 'PLAYOFF_THIRD_PLACE', null, null));
    }
  } else {
    // TOP8 — QF (round N), SF (N+1), GF + 3rd (N+2). Seeding 1v8 / 4v5 / 3v6 / 2v7.
    const gfId = randomUUID();
    const thirdId = hasThirdPlace ? randomUUID() : null;
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
    );
    if (thirdId) {
      rows.push(row(thirdId, playoffRound + 2, null, null, 'PLAYOFF_THIRD_PLACE', null, null));
    }
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
/**
 * Read-only: the set of userIds who, by the CURRENT standings, would seed a division
 * playoff bracket (pools with ≥2 seeds). PROVISIONAL — final-round matches may still be
 * pending, so this can shift. Mirrors the pool computation in startBalancedPlayoffs exactly
 * so the outlook matches the real generation. Used only for the final-round bye DM.
 */
export async function provisionalPlayoffQualifiers(
  fastify: FastifyInstance,
  tournamentId: string,
): Promise<Set<string>> {
  const tournament = await fastify.prisma.tournament.findFirst({
    where: { id: tournamentId, deleted_at: null },
    select: { format: true, rounds_count: true, playoff_format: true },
  });
  if (!tournament || tournament.format !== 'BALANCED_LIECHTENSTEIN') return new Set();
  const roundsCount = tournament.rounds_count ?? 5;

  const matches = await fastify.prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null },
    select: {
      round: true, player1_id: true, player2_id: true, winner_id: true, status: true, phase: true,
      games: { select: { status: true, winner_id: true } },
    },
  });
  const roster = await fastify.prisma.tournamentParticipant.findMany({
    where: { tournament_id: tournamentId, deleted_at: null, status: { in: ['REGISTERED', 'CHECKED_IN', 'WITHDREW'] } },
    select: { user_id: true, skill_band: true, status: true },
  });
  const withdrawnIds = new Set(roster.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id));
  const active = roster.filter((p) => p.status !== 'WITHDREW');
  const anyCheckedIn = active.some((p) => p.status === 'CHECKED_IN');
  const contenders = anyCheckedIn ? active.filter((p) => p.status === 'CHECKED_IN') : active;
  const contenderIds = new Set(contenders.map((p) => p.user_id));

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
  const ranked = sorted
    .filter((s) => contenderIds.has(s.userId) && !withdrawnIds.has(s.userId))
    .map((s, i) => ({ userId: s.userId, band: bandByUser.get(s.userId) ?? DEFAULT_BAND, rank: i + 1, rawScore: s.score }));
  const pools = formDivisionPools(ranked, roundsCount, targetPoolSizeFromFormat(tournament.playoff_format));
  const qualifiers = new Set<string>();
  for (const pool of pools) if (pool.seeds.length >= 2) for (const s of pool.seeds) qualifiers.add(s);
  return qualifiers;
}

export async function startBalancedPlayoffs(
  fastify: FastifyInstance,
  tournamentId: string,
  opts: { forceBands?: number[] } = {},
): Promise<BalancedPlayoffResult | { error: string }> {
  // forceBands: pool bands the host chose to FORCE — generate that division now, seeded from the
  // CURRENT standings, even though a band it draws from is not yet complete. Only the readiness
  // gate is bypassed; the < 2 seeds and already-generated guards still hold. Empty on the normal
  // (tick / reconciler) path, so automatic generation is unchanged.
  const forceBands = new Set(opts.forceBands ?? []);
  const tournament = await fastify.prisma.tournament.findFirst({
    where: { id: tournamentId, deleted_at: null },
    select: { format: true, status: true, rounds_count: true, playoff_format: true, playoff_plan: true, has_third_place_match: true },
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

  // Division pools. Before any division is generated the structure is fluid, so compute it live
  // from the current field (formDivisionPools). The moment the FIRST division generates we freeze the
  // structural skeleton (see below); from then on we RESOLVE the pools from that frozen plan so a
  // later drop can't re-merge / re-count divisions or strand players — only membership flexes, the
  // division count + band anchors stay put. Either way the seat order applies the 0-point gate
  // (earners ahead of organic-zero players) via bracketSeeds.
  const freshPools = formDivisionPools(
    ranked,
    roundsCount,
    targetPoolSizeFromFormat(tournament.playoff_format),
  );
  const frozenPlan = tournament.playoff_plan as unknown as PlayoffPlan | null;
  const pools: Array<{ band: number; players: RankedPlayer[]; seeds: string[] }> =
    frozenPlan && Array.isArray(frozenPlan.divisions) && frozenPlan.divisions.length > 0
      ? resolvePoolsFromPlan(frozenPlan, ranked, roundsCount)
      : freshPools.map((p) => ({ band: p.band, players: p.players, seeds: bracketSeeds(p.players) }));

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
  // match numbers must clear the highest number of ANY existing row — INCLUDING
  // soft-deleted ones, because the unique key (tournament_id, round, match_number) still
  // counts deleted rows. `matches` above is deleted_at-filtered, so a prior (deleted or
  // regenerated) playoff attempt would otherwise reuse a number and collide on createMany.
  const groupRounds = matches.filter((m) => m.phase === null || m.phase === 'SWISS');
  const playoffRound = groupRounds.reduce((mx, m) => Math.max(mx, m.round), 0) + 1;
  const maxNumberAgg = await fastify.prisma.match.aggregate({
    where: { tournament_id: tournamentId }, // no deleted_at filter — deleted rows still hold their slot
    _max: { match_number: true },
  });
  let nextNumber = (maxNumberAgg._max.match_number ?? 0) + 1;
  const rows: Prisma.MatchCreateManyInput[] = [];
  const allPlayable: Array<{ id: string; round: number; player1_id: string; player2_id: string }> = [];
  let brackets = 0;

  // One playoff bracket per division, generated once it is ready and not already done.
  for (const pool of pools) {
    if (pool.seeds.length < 2) continue; // a lone champion needs no bracket
    if (pool.seeds.some((s) => alreadyInPlayoff.has(s))) continue; // already generated
    const spanBands = new Set(pool.players.map((p) => p.band));
    // Host force: skip the borrowed-band completeness wait for this division only.
    if (!forceBands.has(pool.band) && ![...spanBands].every(bandComplete)) continue;
    const built = buildDivisionBracket(pool.seeds, tournamentId, playoffRound, nextNumber, tournament.has_third_place_match);
    rows.push(...built.rows);
    allPlayable.push(...built.playable);
    nextNumber = built.nextMatchNumber;
    brackets += 1;
  }

  if (rows.length > 0) {
    await fastify.prisma.match.createMany({ data: rows });
    emitBracketUpdate(fastify.io, tournamentId);
    // Freeze the structural skeleton the first time any division generates (from the live field at
    // this moment), so subsequent ticks resolve from it instead of re-deriving — see the pools branch
    // above and plans/bali-playoff-plan-freeze.md. Only written once, while no plan exists yet.
    if (!frozenPlan) {
      await fastify.prisma.tournament.update({
        where: { id: tournamentId },
        data: { playoff_plan: derivePlayoffPlan(freshPools) as unknown as Prisma.InputJsonValue },
      });
    }
    // Announce only the first playoff round's ready matches (both players present).
    const firstRound = Math.min(...allPlayable.map((m) => m.round));
    const firstRoundPlayable = allPlayable.filter((m) => m.round === firstRound);
    if (firstRoundPlayable.length > 0) {
      await notifyMatchesCreated(tournamentId, firstRound, firstRoundPlayable);
    }
  }

  return { pools: pools.length, finals: brackets };
}

/**
 * The next eligible replacement seed for a vacated bracket slot in `survivorId`'s division: the
 * highest-seeded EARNER (organic Swiss score > 0) in that division's pool who is live and not already
 * placed anywhere in the playoffs. Resolves the division from the frozen plan when present (else a
 * live formDivisionPools), so it agrees with generation. Shared by the manual backfill endpoint and
 * the survivor "not played → reseed" path. Returns null for non-BaLi tournaments or when the division
 * has no eligible earner left (a 0-point player counts for pool size but is never a backfill seed).
 */
export async function findNextDivisionSeed(
  fastify: FastifyInstance,
  tournamentId: string,
  survivorId: string,
): Promise<string | null> {
  const tournament = await fastify.prisma.tournament.findFirst({
    where: { id: tournamentId, deleted_at: null },
    select: { format: true, rounds_count: true, playoff_format: true, playoff_plan: true },
  });
  if (!tournament || tournament.format !== 'BALANCED_LIECHTENSTEIN') return null;
  const roundsCount = tournament.rounds_count ?? 5;

  const matches = await fastify.prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null },
    select: { round: true, player1_id: true, player2_id: true, winner_id: true, status: true, phase: true },
  });
  const participants = await fastify.prisma.tournamentParticipant.findMany({
    where: { tournament_id: tournamentId, deleted_at: null, status: { in: ['REGISTERED', 'CHECKED_IN', 'WITHDREW'] } },
    select: { user_id: true, status: true, skill_band: true },
  });
  const bandByUser = new Map(participants.map((p) => [p.user_id, p.skill_band ?? DEFAULT_BAND]));
  const withdrawnIds = new Set(participants.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id));
  const inPlayoffs = new Set<string>();
  for (const m of matches) {
    if (!m.phase?.startsWith('PLAYOFF')) continue;
    if (m.player1_id) inPlayoffs.add(m.player1_id);
    if (m.player2_id) inPlayoffs.add(m.player2_id);
  }
  const groupCompleted = matches
    .filter((m) => !m.phase?.startsWith('PLAYOFF'))
    .filter((m) => m.status === 'COMPLETED' || m.status === 'BYE' || m.status === 'FORFEIT' || m.status === 'NO_CONTEST')
    .map((m) => ({ round: m.round, player1_id: m.player1_id, player2_id: m.player2_id, winner_id: m.winner_id, status: m.status }));
  const participantIds = participants.map((p) => p.user_id);
  const ranked = sortSwissStandings(
    computeSwissStandings(participantIds, groupCompleted, withdrawnIds),
    groupCompleted,
    tournamentId,
  );
  const rankedPlayers: RankedPlayer[] = ranked.map((s, i) => ({
    userId: s.userId,
    band: bandByUser.get(s.userId) ?? DEFAULT_BAND,
    rank: i + 1,
    rawScore: s.score,
  }));
  const frozenPlan = tournament.playoff_plan as unknown as PlayoffPlan | null;
  const pools =
    frozenPlan && Array.isArray(frozenPlan.divisions) && frozenPlan.divisions.length > 0
      ? resolvePoolsFromPlan(frozenPlan, rankedPlayers, roundsCount)
      : formDivisionPools(rankedPlayers, roundsCount, targetPoolSizeFromFormat(tournament.playoff_format)).map(
          (p) => ({ band: p.band, players: p.players, seeds: bracketSeeds(p.players) }),
        );
  const survivorPool = pools.find((p) => p.seeds.includes(survivorId));
  const next = survivorPool?.seeds.find((uid) => {
    const st = ranked.find((s) => s.userId === uid);
    return st ? !st.dropped && !withdrawnIds.has(uid) && !inPlayoffs.has(uid) && st.score > 0 : false;
  });
  return next ?? null;
}

/**
 * Read-only playoff preview for the host force tool. Recomputes the exact same division pools +
 * per-division readiness as startBalancedPlayoffs (no side effects), and reports, per division, the
 * current seeds, whether it is ready / already generated, and which contenders in its spanned bands
 * are still playing (the "what still blocks this" list a force must warn about). Mirrors the
 * generation logic so the preview can never disagree with what a force would actually build.
 */
export async function describeBalancedPlayoffPreview(
  fastify: FastifyInstance,
  tournamentId: string,
): Promise<PlayoffPreview | { error: string }> {
  const tournament = await fastify.prisma.tournament.findFirst({
    where: { id: tournamentId, deleted_at: null },
    select: { format: true, rounds_count: true, playoff_format: true, playoff_plan: true },
  });
  if (!tournament || tournament.format !== 'BALANCED_LIECHTENSTEIN') {
    return { error: 'Not a Balanced Liechtenstein tournament' };
  }
  const roundsCount = tournament.rounds_count ?? 5;

  const matches = await fastify.prisma.match.findMany({
    where: { tournament_id: tournamentId, deleted_at: null },
    select: {
      round: true,
      player1_id: true,
      player2_id: true,
      winner_id: true,
      status: true,
      phase: true,
      games: { select: { status: true, winner_id: true } },
    },
  });
  const roster = await fastify.prisma.tournamentParticipant.findMany({
    where: {
      tournament_id: tournamentId,
      deleted_at: null,
      status: { in: ['REGISTERED', 'CHECKED_IN', 'WITHDREW'] },
    },
    select: { user_id: true, skill_band: true, status: true, user: { select: { username: true } } },
  });
  const usernameById = new Map(roster.map((p) => [p.user_id, p.user?.username ?? 'Unknown']));
  const withdrawnIds = new Set(roster.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id));
  const active = roster.filter((p) => p.status !== 'WITHDREW');
  const anyCheckedIn = active.some((p) => p.status === 'CHECKED_IN');
  const contenders = anyCheckedIn ? active.filter((p) => p.status === 'CHECKED_IN') : active;

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
  const contenderIds = new Set(contenders.map((p) => p.user_id));
  const ranked = sorted
    .filter((s) => contenderIds.has(s.userId) && !withdrawnIds.has(s.userId))
    .map((s, i) => ({ userId: s.userId, band: bandByUser.get(s.userId) ?? DEFAULT_BAND, rank: i + 1, rawScore: s.score }));
  // Mirror startBalancedPlayoffs: once the plan is frozen, resolve from it so the preview shows the
  // same structure a (forced or automatic) generation would build; otherwise compute it live.
  const frozenPlan = tournament.playoff_plan as unknown as PlayoffPlan | null;
  const pools: Array<{ band: number; players: RankedPlayer[]; seeds: string[] }> =
    frozenPlan && Array.isArray(frozenPlan.divisions) && frozenPlan.divisions.length > 0
      ? resolvePoolsFromPlan(frozenPlan, ranked, roundsCount)
      : formDivisionPools(ranked, roundsCount, targetPoolSizeFromFormat(tournament.playoff_format)).map(
          (p) => ({ band: p.band, players: p.players, seeds: bracketSeeds(p.players) }),
        );

  // Per-division readiness — identical to startBalancedPlayoffs.
  const completedByUser = new Map<string, number>();
  const activeUsers = new Set<string>();
  for (const m of matches) {
    if (m.phase && m.phase !== 'SWISS') continue;
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

  const alreadyInPlayoff = new Set<string>();
  for (const m of matches) {
    if (m.phase && m.phase !== 'SWISS') {
      if (m.player1_id) alreadyInPlayoff.add(m.player1_id);
      if (m.player2_id) alreadyInPlayoff.add(m.player2_id);
    }
  }

  const divisions: PlayoffPreviewDivision[] = pools
    .filter((pool) => pool.seeds.length >= 2)
    .map((pool) => {
      const spanBands = [...new Set(pool.players.map((p) => p.band))];
      const blockerIds = spanBands
        .flatMap((b) => contendersByBand.get(b) ?? [])
        .filter((uid) => !contenderIsComplete(uid));
      return {
        band: pool.band,
        size: pool.seeds.length,
        format: divisionPlayoffFormat(pool.seeds.length),
        seeds: pool.seeds.map((uid) => ({ userId: uid, username: usernameById.get(uid) ?? 'Unknown' })),
        ready: spanBands.every(bandComplete),
        alreadyGenerated: pool.seeds.some((s) => alreadyInPlayoff.has(s)),
        blockers: blockerIds.map((uid) => ({ userId: uid, username: usernameById.get(uid) ?? 'Unknown' })),
      };
    });

  return { divisions };
}
