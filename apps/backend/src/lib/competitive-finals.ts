// ---------------------------------------------------------------------------
// Competitive Finals — the recurring, leaderboard-seeded finals.
// (design-competitive-finals-locked)
//
// Quarterly Final: one per battle type × competitor format, seeded from the quarter's
//   per-battle-type GS board. Field size N = min(pow2 ≤ active/4, pow2 ≤ qualified/2) with a
//   HARD floor of Top 16 (below → no final). `active`/`qualified` are measured WITHIN the battle
//   type (games actually played in it), so only players who really played it can seed.
// Monthly Ladder Invitational: seeded from the month's ladder activity (individual). Size
//   pow2 ≤ players/4, NO floor (a near-empty month → a tiny/no field, which is correct) + a raffle.
//
// This module only COMPUTES the field (preview, for the live tile) and FREEZES it (snapshot +
// seeded participants). The admin creates the tournament and triggers the seed — no cron.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@rizzotto/db';
import type { Redis } from 'ioredis';
import { computeGsBoard, type BattleTypeFilter, type CompetitorFormatFilter } from './gs-board.js';
import { captainMap } from './competitors.js';
import {
  loadCompetitionConfig,
  qualiGate,
  parseQuarter,
  parseMonth,
  computeLadderStandings,
} from './competition.js';

/** Largest power of two ≤ x (x may be fractional). 0 when x < 1. */
export function largestPow2AtMost(x: number): number {
  if (!Number.isFinite(x) || x < 1) return 0;
  return 2 ** Math.floor(Math.log2(x));
}

/** The Quarterly Final only exists once it can seat a full Top 16 (Alex 2026-09-15, hard floor). */
export const QUARTERLY_FLOOR = 16;
/** Floor thresholds implied by the size formula: Top 16 needs ≥64 active AND ≥32 qualified. */
export const QUARTERLY_MIN_ACTIVE = 64;
export const QUARTERLY_MIN_QUALIFIED = 32;

/**
 * Quarterly Final field size: N = min(pow2 ≤ active/4, pow2 ≤ qualified/2) — "a quarter of the
 * field, at most half of the high-activity players". Returns 0 when below the hard Top-16 floor.
 * Doubling tiers: 64/32 → 16 · 128/64 → 32 · 256/128 → 64.
 */
export function quarterlyFinalSize(active: number, qualified: number): number {
  const raw = Math.min(largestPow2AtMost(active / 4), largestPow2AtMost(qualified / 2));
  return raw < QUARTERLY_FLOOR ? 0 : raw;
}

export type QuarterlyBattleType = Exclude<BattleTypeFilter, 'OVERALL'>;

export interface FinalSeed {
  competitorId: string; // User id (1v1) or Team id (2v2)
  rank: number; // 1-based
  gs?: number; // quarterly seeding skill
  points?: number; // monthly ladder activity
  memberIds?: string[]; // 2v2 team members (for display)
}

export interface QuarterlyFinalPreview {
  kind: 'QUARTERLY';
  period: string;
  battleType: QuarterlyBattleType;
  competitorFormat: CompetitorFormatFilter;
  gate: number; // games required to qualify (self-scaling)
  active: number; // competitors with ≥1 game in the battle type
  qualified: number; // competitors past the gate
  size: number; // field size (0 when below the floor)
  belowFloor: boolean;
  needMoreActive: number; // to reach the floor (≥64 active)
  needMoreQualified: number; // to reach the floor (≥32 qualified)
  seeds: FinalSeed[];
}

export interface LadderFinalPreview {
  kind: 'MONTHLY_LADDER';
  period: string;
  players: number; // ladder players this month
  size: number;
  seeds: FinalSeed[];
}

/**
 * Preview the Quarterly Final for one battle type × format as of `now`. The tile uses this to
 * show either the field size (createable) or how far off the floor it is (day-current — the gate
 * rises with the days, so the numbers sharpen toward quarter close).
 */
export async function computeQuarterlyFinal(
  prisma: PrismaClient,
  redis: Redis | undefined,
  opts: {
    period: string;
    battleType: QuarterlyBattleType;
    competitorFormat: CompetitorFormatFilter;
    now?: Date;
  },
): Promise<QuarterlyFinalPreview | null> {
  const window = parseQuarter(opts.period);
  if (!window) return null;
  const now = opts.now ?? new Date();
  const cfg = await loadCompetitionConfig(prisma);
  const gate = qualiGate(cfg, window, now);

  const board = await computeGsBoard(prisma, redis, {
    versionId: null, // GS is timeless; the window scopes the quarter
    window: { from: window.from, to: window.to },
    battleType: opts.battleType,
    competitorFormat: opts.competitorFormat,
  });

  // active/qualified measured WITHIN the battle type. The board is GS-desc, so the qualified
  // slice is already the top-N ranking.
  const active = board.filter((e) => e.battleTypeGames >= 1).length;
  const qualified = board.filter((e) => e.battleTypeGames >= gate);

  const size = quarterlyFinalSize(active, qualified.length);
  const belowFloor = size === 0;

  const seeds: FinalSeed[] =
    size > 0
      ? qualified.slice(0, size).map((e, i) => ({
          competitorId: e.competitorId,
          rank: i + 1,
          gs: e.gs,
          ...(e.memberIds.length ? { memberIds: e.memberIds } : {}),
        }))
      : [];

  return {
    kind: 'QUARTERLY',
    period: opts.period,
    battleType: opts.battleType,
    competitorFormat: opts.competitorFormat,
    gate,
    active,
    qualified: qualified.length,
    size,
    belowFloor,
    needMoreActive: Math.max(0, QUARTERLY_MIN_ACTIVE - active),
    needMoreQualified: Math.max(0, QUARTERLY_MIN_QUALIFIED - qualified.length),
    seeds,
  };
}

/** Preview the Monthly Ladder Invitational (individual, combined across all battle types). */
export async function computeMonthlyLadderFinal(
  prisma: PrismaClient,
  opts: { period: string; now?: Date },
): Promise<LadderFinalPreview | null> {
  const window = parseMonth(opts.period);
  if (!window) return null;
  const cfg = await loadCompetitionConfig(prisma);
  const standings = await computeLadderStandings(prisma, window, cfg);
  const players = standings.length;
  const size = largestPow2AtMost(players / 4); // no floor (Alex 2026-09-15)
  const seeds: FinalSeed[] = standings.slice(0, size).map((s, i) => ({
    competitorId: s.playerId,
    rank: i + 1,
    points: s.points,
  }));
  return { kind: 'MONTHLY_LADDER', period: opts.period, players, size, seeds };
}

export interface SeedResult {
  kind: 'QUARTERLY' | 'MONTHLY_LADDER';
  period: string;
  size: number;
  seededUserIds: string[]; // acting user ids that got a participant (for DMs)
  seeds: FinalSeed[];
}

/**
 * Freeze the qualification and seed the final tournament: writes an immutable
 * CompetitiveCycleSnapshot per seed + a CHECKED_IN TournamentParticipant with its seed. For 2v2
 * the participant is the team's captain (user_id) carrying team_id + participant_type=TEAM.
 * Idempotent (upserts) so a re-seed before start is safe. Throws if the field is empty.
 */
export async function seedFinal(
  prisma: PrismaClient,
  redis: Redis | undefined,
  opts: {
    tournamentId: string;
    kind: 'QUARTERLY' | 'MONTHLY_LADDER';
    period: string;
    battleType?: QuarterlyBattleType; // required for QUARTERLY
    competitorFormat: CompetitorFormatFilter;
    now?: Date;
  },
): Promise<SeedResult> {
  const preview =
    opts.kind === 'QUARTERLY'
      ? await computeQuarterlyFinal(prisma, redis, {
          period: opts.period,
          battleType: opts.battleType ?? 'DOMINATION',
          competitorFormat: opts.competitorFormat,
          now: opts.now,
        })
      : await computeMonthlyLadderFinal(prisma, { period: opts.period, now: opts.now });
  if (!preview) throw new Error('Invalid period');
  if (preview.size === 0 || preview.seeds.length === 0) {
    throw new Error(
      opts.kind === 'QUARTERLY'
        ? 'Not enough activity yet for a Quarterly Final (it needs a full Top 16).'
        : 'No ladder players this month — nothing to seed.',
    );
  }

  const isTeam = opts.competitorFormat === 'TWO_V_TWO';
  // The ladder final is nominally Domination/1v1; a quarterly final uses its real battle type.
  const battleType: QuarterlyBattleType = opts.kind === 'QUARTERLY' ? (opts.battleType ?? 'DOMINATION') : 'DOMINATION';
  const captains = isTeam
    ? await captainMap(prisma, preview.seeds.map((s) => s.competitorId))
    : new Map<string, string>();

  const seededUserIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const seed of preview.seeds) {
      await tx.competitiveCycleSnapshot.upsert({
        where: {
          kind_period_battle_type_competitor_format_competitor_id: {
            kind: opts.kind,
            period: opts.period,
            battle_type: battleType,
            competitor_format: opts.competitorFormat,
            competitor_id: seed.competitorId,
          },
        },
        update: { rank: seed.rank, gs: seed.gs ?? null, points: seed.points ?? null },
        create: {
          kind: opts.kind,
          period: opts.period,
          battle_type: battleType,
          competitor_format: opts.competitorFormat,
          competitor_id: seed.competitorId,
          rank: seed.rank,
          gs: seed.gs ?? null,
          points: seed.points ?? null,
        },
      });

      const userId = isTeam ? captains.get(seed.competitorId) : seed.competitorId;
      if (!userId) continue; // 2v2 team without a captain — skip defensively
      await tx.tournamentParticipant.upsert({
        where: { tournament_id_user_id: { tournament_id: opts.tournamentId, user_id: userId } },
        update: {
          seed: seed.rank,
          status: 'CHECKED_IN',
          deleted_at: null,
          ...(isTeam ? { team_id: seed.competitorId, participant_type: 'TEAM' } : { participant_type: 'USER' }),
        },
        create: {
          tournament_id: opts.tournamentId,
          user_id: userId,
          seed: seed.rank,
          status: 'CHECKED_IN',
          ...(isTeam ? { team_id: seed.competitorId, participant_type: 'TEAM' } : {}),
        },
      });
      seededUserIds.push(userId);
    }
  });

  return { kind: opts.kind, period: opts.period, size: preview.size, seededUserIds, seeds: preview.seeds };
}

/**
 * Pick the Monthly Ladder Invitational raffle winner among the invited players — every invitee
 * gets an equal shot (skill decides the tournament prize; luck decides the raffle prize). Pass
 * `index` for a deterministic draw (tests); otherwise a uniform random invitee is chosen.
 */
export function pickRaffleWinner(userIds: readonly string[], index?: number): string | null {
  if (userIds.length === 0) return null;
  const i = index ?? Math.floor(Math.random() * userIds.length);
  return userIds[Math.min(Math.max(i, 0), userIds.length - 1)] ?? null;
}
