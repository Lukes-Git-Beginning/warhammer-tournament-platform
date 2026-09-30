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
  parseMonth,
  computeLadderStandings,
  loadQuarterOverrides,
  resolveQuarter,
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

/**
 * Final field size once availability is known (availability-round seed). If at least `plannedSize`
 * competitors confirmed, the field is the full planned size; otherwise it shrinks to the largest
 * power of two that fits the confirmed count. The ladder has no floor, so a thin field just runs
 * smaller (e.g. planned Top 8 but only 5 confirm → Top 4). Returns 0 if nobody confirmed.
 */
export function confirmedFieldSize(plannedSize: number, availableCount: number): number {
  if (plannedSize <= 0 || availableCount <= 0) return 0;
  return availableCount >= plannedSize ? plannedSize : largestPow2AtMost(availableCount);
}

/** The availability round invites the field plus an equal-size reserve buffer — 2× the field —
 *  not the whole ranking (a player far below the cut has no realistic shot and shouldn't be DM'd,
 *  Alex 2026-09-30). Only these ranks can be promoted if finalists decline. */
export const INVITE_POOL_MULTIPLIER = 2;
export function invitePoolSize(fieldSize: number): number {
  return Math.max(0, fieldSize) * INVITE_POOL_MULTIPLIER;
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
  const overrides = await loadQuarterOverrides(prisma);
  const window = resolveQuarter(opts.period, overrides);
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
  redis: Redis | undefined,
  opts: { period: string; now?: Date },
): Promise<LadderFinalPreview | null> {
  const window = parseMonth(opts.period);
  if (!window) return null;
  const standings = await computeLadderStandings(prisma, redis, window);
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
      : await computeMonthlyLadderFinal(prisma, redis, { period: opts.period, now: opts.now });
  if (!preview) throw new Error('Invalid period');
  if (preview.size === 0 || preview.seeds.length === 0) {
    throw new Error(
      opts.kind === 'QUARTERLY'
        ? 'Not enough activity yet for a Quarterly Final (it needs a full Top 16).'
        : 'No ladder players this month — nothing to seed.',
    );
  }

  // The ladder final is nominally Domination/1v1; a quarterly final uses its real battle type.
  const battleType: QuarterlyBattleType = opts.kind === 'QUARTERLY' ? (opts.battleType ?? 'DOMINATION') : 'DOMINATION';
  const seededUserIds = await writeSeededField(
    prisma,
    { tournamentId: opts.tournamentId, kind: opts.kind, period: opts.period, battleType, competitorFormat: opts.competitorFormat },
    preview.seeds,
  );
  return { kind: opts.kind, period: opts.period, size: preview.size, seededUserIds, seeds: preview.seeds };
}

/**
 * Write the frozen snapshot + a CHECKED_IN participant for each seed (in seed order). Shared by the
 * direct seed (Quarterly) and the availability-round seed (Ladder). Idempotent upserts, so a
 * re-seed before the final starts is safe. For 2v2 the seeded user is the team's captain.
 */
export async function writeSeededField(
  prisma: PrismaClient,
  opts: {
    tournamentId: string;
    kind: 'QUARTERLY' | 'MONTHLY_LADDER';
    period: string;
    battleType: QuarterlyBattleType;
    competitorFormat: CompetitorFormatFilter;
  },
  seeds: FinalSeed[],
): Promise<string[]> {
  const isTeam = opts.competitorFormat === 'TWO_V_TWO';
  const captains = isTeam
    ? await captainMap(prisma, seeds.map((s) => s.competitorId))
    : new Map<string, string>();
  const seededUserIds: string[] = [];

  await prisma.$transaction(async (tx) => {
    for (const seed of seeds) {
      await tx.competitiveCycleSnapshot.upsert({
        where: {
          kind_period_battle_type_competitor_format_competitor_id: {
            kind: opts.kind,
            period: opts.period,
            battle_type: opts.battleType,
            competitor_format: opts.competitorFormat,
            competitor_id: seed.competitorId,
          },
        },
        update: { rank: seed.rank, gs: seed.gs ?? null, points: seed.points ?? null },
        create: {
          kind: opts.kind,
          period: opts.period,
          battle_type: opts.battleType,
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

  return seededUserIds;
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

// ---------------------------------------------------------------------------
// Availability round (monthly ladder invite/RSVP flow, design agreed with Alex).
//
// Instead of freezing the top-N straight to CHECKED_IN, the admin runs a two-step flow:
//   1) open-availability at cycle close → invite the WHOLE frozen ranking, each with a deadline
//      to confirm (check in → AVAILABLE) or decline (DECLINED); no response = PENDING = unavailable.
//   2) seed-from-confirmed → the field is the top-N (by rank) among the AVAILABLE, shrinking to the
//      next power of two if fewer confirmed than the planned size.
// Before the round is opened the tournament shows a LIVE preview (top-N as of now, no DB writes).
// ---------------------------------------------------------------------------

export type ChampKind = 'QUARTERLY' | 'MONTHLY_LADDER';
export type RsvpValue = 'PENDING' | 'AVAILABLE' | 'DECLINED';

export interface RankedCompetitor {
  competitorId: string; // User id (1v1) or Team id (2v2)
  userId: string; // the actor who RSVPs (the captain for 2v2)
  rank: number; // 1-based, within the pool
  points?: number; // ladder activity
  gs?: number; // quarterly seeding skill
  memberIds?: string[];
}

/** Planned field size for a pool of the given size (before availability is known). */
export function plannedFieldSize(kind: ChampKind, poolSize: number, activeForQuarterly?: number): number {
  if (kind === 'MONTHLY_LADDER') return largestPow2AtMost(poolSize / 4);
  return quarterlyFinalSize(activeForQuarterly ?? poolSize, poolSize);
}

/**
 * The FULL ranking of the pool (everyone eligible to be invited), ranked. Ladder: the whole month's
 * standings (individual → competitorId === userId). Quarterly: everyone past the activity gate in
 * the battle type. Used to invite the whole field and to enrich seeds with points/gs.
 */
export async function computeFullRanking(
  prisma: PrismaClient,
  redis: Redis | undefined,
  opts: { kind: ChampKind; period: string; battleType?: QuarterlyBattleType; competitorFormat: CompetitorFormatFilter; now?: Date },
): Promise<RankedCompetitor[]> {
  if (opts.kind === 'MONTHLY_LADDER') {
    const window = parseMonth(opts.period);
    if (!window) return [];
    const standings = await computeLadderStandings(prisma, redis, window);
    return standings.map((s, i) => ({ competitorId: s.playerId, userId: s.playerId, rank: i + 1, points: s.points }));
  }
  const overrides = await loadQuarterOverrides(prisma);
  const window = resolveQuarter(opts.period, overrides);
  if (!window) return [];
  const now = opts.now ?? new Date();
  const cfg = await loadCompetitionConfig(prisma);
  const gate = qualiGate(cfg, window, now);
  const board = await computeGsBoard(prisma, redis, {
    versionId: null,
    window: { from: window.from, to: window.to },
    battleType: opts.battleType ?? 'DOMINATION',
    competitorFormat: opts.competitorFormat,
  });
  const qualified = board.filter((e) => e.battleTypeGames >= gate);
  const isTeam = opts.competitorFormat === 'TWO_V_TWO';
  const captains = isTeam ? await captainMap(prisma, qualified.map((e) => e.competitorId)) : new Map<string, string>();
  return qualified.flatMap((e, i) => {
    const userId = isTeam ? captains.get(e.competitorId) : e.competitorId;
    if (!userId) return [];
    return [{ competitorId: e.competitorId, userId, rank: i + 1, gs: e.gs, ...(e.memberIds.length ? { memberIds: e.memberIds } : {}) }];
  });
}

export interface OpenRoundResult {
  invited: number;
  fieldSize: number;
  deadline: Date;
  invites: Array<{ userId: string; rank: number }>;
}

/**
 * Open the availability round: freeze the full ranking as invites (rank each), set the RSVP
 * deadline. Replaces any prior invites for this final (a re-open re-freezes the ranking). Returns
 * the invitees (ordered) for the differentiated invite DMs.
 */
export async function openAvailabilityRound(
  prisma: PrismaClient,
  redis: Redis | undefined,
  opts: {
    tournamentId: string;
    kind: ChampKind;
    period: string;
    battleType?: QuarterlyBattleType;
    competitorFormat: CompetitorFormatFilter;
    deadlineHours?: number;
    now?: Date;
  },
): Promise<OpenRoundResult> {
  const now = opts.now ?? new Date();
  const ranking = await computeFullRanking(prisma, redis, {
    kind: opts.kind,
    period: opts.period,
    battleType: opts.battleType,
    competitorFormat: opts.competitorFormat,
    now,
  });
  if (ranking.length === 0) {
    throw new Error(opts.kind === 'MONTHLY_LADDER' ? 'No ladder players this cycle — nobody to invite.' : 'No qualified players yet — nobody to invite.');
  }
  const fieldSize = plannedFieldSize(opts.kind, ranking.length);
  if (fieldSize === 0) throw new Error('Not enough players to seat a field yet.');
  // Invite only the field + an equal reserve buffer (2× the field), not the whole ranking.
  const pool = ranking.slice(0, invitePoolSize(fieldSize));
  const deadlineHours = opts.deadlineHours ?? 24;
  const deadline = new Date(now.getTime() + deadlineHours * 3_600_000);

  await prisma.$transaction(async (tx) => {
    await tx.championshipInvite.deleteMany({ where: { tournament_id: opts.tournamentId } });
    await tx.championshipInvite.createMany({
      data: pool.map((r) => ({
        tournament_id: opts.tournamentId,
        competitor_id: r.competitorId,
        user_id: r.userId,
        rank: r.rank,
      })),
    });
    await tx.tournament.update({
      where: { id: opts.tournamentId },
      data: { availability_opened_at: now, rsvp_deadline: deadline },
    });
  });

  return { invited: pool.length, fieldSize, deadline, invites: pool.map((r) => ({ userId: r.userId, rank: r.rank })) };
}

/** Record a competitor's RSVP for the availability round. Returns the new value, or null if the
 *  acting user is not an invitee of this final. */
export async function setInviteRsvp(
  prisma: PrismaClient,
  opts: { tournamentId: string; userId: string; available: boolean },
): Promise<RsvpValue | null> {
  const invite = await prisma.championshipInvite.findUnique({
    where: { tournament_id_user_id: { tournament_id: opts.tournamentId, user_id: opts.userId } },
  });
  if (!invite) return null;
  const rsvp: RsvpValue = opts.available ? 'AVAILABLE' : 'DECLINED';
  await prisma.championshipInvite.update({ where: { id: invite.id }, data: { rsvp, rsvp_at: new Date() } });
  return rsvp;
}

export interface ConfirmedSeedResult extends SeedResult {
  available: number;
  plannedSize: number;
}

/**
 * Seed the final from the confirmed invitees: field = top-N (by frozen rank) among AVAILABLE,
 * shrinking to the next power of two if fewer confirmed than planned. Enriches the seeds' points/gs
 * from a fresh ranking (deterministic once the cycle is closed). Writes snapshot + CHECKED_IN
 * participants via writeSeededField. Throws if no round was opened or nobody confirmed.
 */
export async function seedFromConfirmed(
  prisma: PrismaClient,
  redis: Redis | undefined,
  opts: { tournamentId: string; kind: ChampKind; period: string; battleType?: QuarterlyBattleType; competitorFormat: CompetitorFormatFilter; now?: Date },
): Promise<ConfirmedSeedResult> {
  const invites = await prisma.championshipInvite.findMany({
    where: { tournament_id: opts.tournamentId },
    orderBy: { rank: 'asc' },
  });
  if (invites.length === 0) throw new Error('No availability round has been opened for this final.');
  const available = invites.filter((i) => i.rsvp === 'AVAILABLE');

  const ranking = await computeFullRanking(prisma, redis, {
    kind: opts.kind,
    period: opts.period,
    battleType: opts.battleType,
    competitorFormat: opts.competitorFormat,
    now: opts.now,
  });
  // Field size N is derived from the FULL pool: invites are only the top 2N, so counting them would
  // undersize the field. The cycle is closed, so the recomputed ranking is deterministic.
  const plannedSize = plannedFieldSize(opts.kind, ranking.length);
  const finalSize = confirmedFieldSize(plannedSize, available.length);
  if (finalSize === 0) throw new Error('Nobody has confirmed availability yet — no field to seed.');

  const byCompetitor = new Map(ranking.map((r) => [r.competitorId, r]));
  const chosen = available.slice(0, finalSize);
  const seeds: FinalSeed[] = chosen.map((inv, i) => {
    const r = byCompetitor.get(inv.competitor_id);
    return {
      competitorId: inv.competitor_id,
      rank: i + 1,
      ...(r?.points != null ? { points: r.points } : {}),
      ...(r?.gs != null ? { gs: r.gs } : {}),
      ...(r?.memberIds?.length ? { memberIds: r.memberIds } : {}),
    };
  });
  const battleType: QuarterlyBattleType = opts.kind === 'QUARTERLY' ? (opts.battleType ?? 'DOMINATION') : 'DOMINATION';
  const seededUserIds = await writeSeededField(
    prisma,
    { tournamentId: opts.tournamentId, kind: opts.kind, period: opts.period, battleType, competitorFormat: opts.competitorFormat },
    seeds,
  );
  return { kind: opts.kind, period: opts.period, size: finalSize, seededUserIds, seeds, available: available.length, plannedSize };
}

export type FieldPhase = 'PREVIEW' | 'AVAILABILITY' | 'SEEDED';

export interface FieldEntry {
  rank: number;
  userId: string;
  competitorId: string;
  username: string;
  avatarUrl: string | null;
  points?: number | null;
  gs?: number | null;
  rsvp?: RsvpValue; // availability phase only
  status?: string; // seeded phase only (participant status)
  inField: boolean; // preview: within top-N; availability: within top-N of AVAILABLE; seeded: is in the field
}

export interface FieldView {
  phase: FieldPhase;
  kind: ChampKind;
  period: string;
  fieldSize: number;
  cutRank: number; // the N line ("Top N")
  deadline: string | null; // rsvp_deadline ISO
  entries: FieldEntry[];
  viewerIsInvitee: boolean;
  viewerRsvp: RsvpValue | null;
}

/**
 * The phase-aware field view for a final's tournament page:
 *   PREVIEW      — round not opened yet: the live top-N as of now (no DB writes).
 *   AVAILABILITY — round open: the full frozen ranking with each invitee's RSVP + the projected
 *                  field (top-N of AVAILABLE), plus the viewer's own RSVP.
 *   SEEDED       — sealed: the actual seeded participants.
 */
export async function computeFieldView(
  prisma: PrismaClient,
  redis: Redis | undefined,
  opts: {
    tournament: {
      id: string;
      championship_kind: ChampKind | 'NONE';
      championship_period: string | null;
      battle_type: string;
      competitor_format: CompetitorFormatFilter;
      availability_opened_at: Date | null;
      rsvp_deadline: Date | null;
    };
    viewerUserId?: string;
    now?: Date;
  },
): Promise<FieldView | null> {
  const t = opts.tournament;
  if (t.championship_kind === 'NONE' || !t.championship_period) return null;
  const kind = t.championship_kind;
  const period = t.championship_period;
  const competitorFormat = t.competitor_format;
  const battleType = t.battle_type as QuarterlyBattleType;

  const resolveUsers = async (ids: string[]) => {
    const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, username: true, avatar_url: true } });
    return new Map(users.map((u) => [u.id, u]));
  };

  // SEEDED — the sealed field (real participants).
  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournament_id: t.id, deleted_at: null, status: { in: ['CHECKED_IN', 'REGISTERED', 'DISQUALIFIED'] } },
    select: { user_id: true, seed: true, status: true },
    orderBy: { seed: 'asc' },
  });
  if (participants.length > 0) {
    const umap = await resolveUsers(participants.map((p) => p.user_id));
    const entries: FieldEntry[] = participants.map((p, i) => {
      const u = umap.get(p.user_id);
      return {
        rank: p.seed ?? i + 1,
        userId: p.user_id,
        competitorId: p.user_id,
        username: u?.username ?? 'Unknown',
        avatarUrl: u?.avatar_url ?? null,
        status: p.status,
        inField: p.status !== 'DISQUALIFIED',
      };
    });
    return { phase: 'SEEDED', kind, period, fieldSize: entries.filter((e) => e.inField).length, cutRank: entries.length, deadline: t.rsvp_deadline?.toISOString() ?? null, entries, viewerIsInvitee: false, viewerRsvp: null };
  }

  const ranking = await computeFullRanking(prisma, redis, { kind, period, battleType, competitorFormat, now: opts.now });
  const plannedSize = plannedFieldSize(kind, ranking.length);

  // AVAILABILITY — round open, not sealed yet.
  if (t.availability_opened_at) {
    const invites = await prisma.championshipInvite.findMany({ where: { tournament_id: t.id }, orderBy: { rank: 'asc' } });
    const rankInfo = new Map(ranking.map((r) => [r.competitorId, r]));
    const umap = await resolveUsers(invites.map((i) => i.user_id));
    const availableSorted = invites.filter((i) => i.rsvp === 'AVAILABLE'); // rank asc
    const finalSize = confirmedFieldSize(plannedSize, availableSorted.length);
    const inFieldIds = new Set(availableSorted.slice(0, finalSize).map((i) => i.competitor_id));
    const entries: FieldEntry[] = invites.map((inv) => {
      const u = umap.get(inv.user_id);
      const ri = rankInfo.get(inv.competitor_id);
      return {
        rank: inv.rank,
        userId: inv.user_id,
        competitorId: inv.competitor_id,
        username: u?.username ?? 'Unknown',
        avatarUrl: u?.avatar_url ?? null,
        points: ri?.points ?? null,
        gs: ri?.gs ?? null,
        rsvp: inv.rsvp as RsvpValue,
        inField: inFieldIds.has(inv.competitor_id),
      };
    });
    let viewerRsvp: RsvpValue | null = null;
    let viewerIsInvitee = false;
    if (opts.viewerUserId) {
      const mine = invites.find((i) => i.user_id === opts.viewerUserId);
      if (mine) {
        viewerIsInvitee = true;
        viewerRsvp = mine.rsvp as RsvpValue;
      }
    }
    return { phase: 'AVAILABILITY', kind, period, fieldSize: plannedSize, cutRank: plannedSize, deadline: t.rsvp_deadline?.toISOString() ?? null, entries, viewerIsInvitee, viewerRsvp };
  }

  // PREVIEW — live top-N, no writes.
  const top = ranking.slice(0, plannedSize);
  const umap = await resolveUsers(top.map((r) => r.userId));
  const entries: FieldEntry[] = top.map((r) => {
    const u = umap.get(r.userId);
    return {
      rank: r.rank,
      userId: r.userId,
      competitorId: r.competitorId,
      username: u?.username ?? 'Unknown',
      avatarUrl: u?.avatar_url ?? null,
      points: r.points ?? null,
      gs: r.gs ?? null,
      inField: true,
    };
  });
  return { phase: 'PREVIEW', kind, period, fieldSize: plannedSize, cutRank: plannedSize, deadline: null, entries, viewerIsInvitee: false, viewerRsvp: null };
}
