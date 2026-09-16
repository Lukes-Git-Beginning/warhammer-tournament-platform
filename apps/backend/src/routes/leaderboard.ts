import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { cached, cacheKey } from '../lib/cache.js';
import { computeVersionLeaderboard } from '../lib/leaderboard-service.js';
import { getRatingModel } from '../lib/rating-model-service.js';
import { logistic, skillToBand } from '../lib/rating-model.js';
import { effectiveTiersOf, SUPPORTER_FLAG_SELECT } from '../lib/supporter-service.js';
import { currentQuarter, currentMonth, loadCompetitionConfig, computeLadderStandings, rankingsCutoff, qualiGate, parseQuarter, quarterValue, listQuartersSinceLaunch, parseMonth, monthValue, listMonthsSinceLaunch, loadQuarterOverrides, resolveQuarter, listQuartersResolved } from '../lib/competition.js';
import { computeGsBoard, type CompetitorFormatFilter } from '../lib/gs-board.js';
import type { PrismaClient } from '@rizzotto/db';
import {
  computeSwissStandings,
  sortSwissStandings,
  type CompletedMatchRecord,
} from '../lib/swiss.js';

/**
 * The SINGLE champion of a completed tournament, for the "major wins" leaderboard.
 * Determined from match data (not TournamentResult.placement, which is by Swiss standing
 * for BaLi and can carry stale rows), so exactly one winner is credited per tournament:
 *  - Playoff final(s): Swiss+Playoff has one; a Balanced Liechtenstein has one per DIVISION
 *    → the champion is the winner of the TOP division's final (highest skill band among its
 *    finalists), never a lower-division winner.
 *  - Single/Double elimination: the grand final (GRAND_FINAL side, else the top-round match).
 *  - Pure Swiss / Round Robin / Liechtenstein (no playoff): the top of the final standings.
 */
export interface ChampionMatch {
  phase: string | null;
  status: string;
  round: number;
  winner_id: string | null;
  player1_id: string | null;
  player2_id: string | null;
  bracket_side: string | null;
}

export function tournamentChampion(
  tournamentId: string,
  format: string,
  matches: ChampionMatch[],
  bandByUser: Map<string, number>,
  participantIds: string[],
  withdrawnIds: Set<string>,
): string | null {
  const done = matches.filter((m) => m.status === 'COMPLETED' && m.winner_id);

  const finals = done.filter((m) => m.phase === 'PLAYOFF_FINAL');
  if (finals.length > 0) {
    let best = finals[0]!;
    let bestBand = -1;
    for (const f of finals) {
      const band = Math.max(bandByUser.get(f.player1_id ?? '') ?? 0, bandByUser.get(f.player2_id ?? '') ?? 0);
      if (band > bestBand) {
        bestBand = band;
        best = f;
      }
    }
    return best.winner_id;
  }

  if (format === 'DOUBLE_ELIMINATION' || format === 'SINGLE_ELIMINATION') {
    const grandFinals = done.filter((m) => m.bracket_side === 'GRAND_FINAL');
    const pool = grandFinals.length > 0 ? grandFinals : done.filter((m) => m.phase !== 'PLAYOFF_THIRD_PLACE');
    if (pool.length === 0) return null;
    const maxRound = Math.max(...pool.map((m) => m.round));
    return pool.filter((m) => m.round === maxRound).at(-1)?.winner_id ?? null;
  }

  // Pure ranked (Swiss / RR / DRR / Liechtenstein) — champion = top of final standings.
  const completed: CompletedMatchRecord[] = done.map((m) => ({
    round: m.round,
    player1_id: m.player1_id,
    player2_id: m.player2_id,
    winner_id: m.winner_id,
    status: m.status,
  }));
  const standings = sortSwissStandings(
    computeSwissStandings(participantIds, completed, withdrawnIds),
    completed,
    tournamentId,
  );
  return standings[0]?.userId ?? null;
}

/**
 * The determinable podium (ordered top finishers) of a tournament's HIGHEST-division playoff,
 * generalising {@link tournamentChampion} with the SAME highest-band-final method. Positions:
 * 1/2 from the final; 3/4 from that division's third-place match, else both SF losers tie at 3;
 * QF losers tie at 5. So the determinable qualification cuts are 1, 2, 4 and 8 (whole playoff)
 * always, and 3 only with a third-place match; 5/6/7 split the tied QF-loser tier and are NOT
 * derivable. Returns [] when there is no playoff final (caller falls back to standings).
 */
export function tournamentPodium(
  matches: ChampionMatch[],
  bandByUser: Map<string, number>,
): { userId: string; position: number }[] {
  const done = matches.filter((m) => m.status === 'COMPLETED' && m.winner_id);
  const bandOf = (m: ChampionMatch): number =>
    Math.max(bandByUser.get(m.player1_id ?? '') ?? 0, bandByUser.get(m.player2_id ?? '') ?? 0);
  const loserOf = (m: ChampionMatch): string | null =>
    m.player1_id === m.winner_id ? m.player2_id : m.player1_id;

  const finals = done.filter((m) => m.phase === 'PLAYOFF_FINAL');
  if (finals.length === 0) return [];
  // Top division = the final whose finalists carry the highest skill band.
  let final = finals[0]!;
  for (const f of finals) if (bandOf(f) > bandOf(final)) final = f;
  if (!final.winner_id) return [];
  const topBand = bandOf(final);
  const sameBand = (m: ChampionMatch): boolean => bandOf(m) === topBand;

  const podium: { userId: string; position: number }[] = [];
  const placed = new Set<string>();
  const add = (uid: string | null, position: number): void => {
    if (uid && !placed.has(uid)) {
      podium.push({ userId: uid, position });
      placed.add(uid);
    }
  };

  add(final.winner_id, 1);
  add(loserOf(final), 2);
  // 3rd/4th: a third-place match ranks them cleanly (3 vs 4); otherwise the two SF losers tie at 3
  // (so "top 3" is ambiguous without one, but "top 4" takes both regardless).
  const third = done.find((m) => m.phase === 'PLAYOFF_THIRD_PLACE' && sameBand(m));
  if (third && third.winner_id) {
    add(third.winner_id, 3);
    add(loserOf(third), 4);
  } else {
    for (const sf of done.filter((m) => m.phase === 'PLAYOFF_SF' && sameBand(m))) add(loserOf(sf), 3);
  }
  // 5th: QF losers (tied) — completes the field so a full "top 8" cut takes the whole playoff.
  for (const qf of done.filter((m) => m.phase === 'PLAYOFF_QF' && sameBand(m))) add(loserOf(qf), 5);
  return podium;
}

const PaginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  // Cap raised to 1000 so the leaderboard page can load every rank in one request
  // (the server computes the full list and slices anyway). Pagination is a fallback
  // only past 1000 entries.
  pageSize: z.coerce.number().int().min(1).max(1000).default(50),
});

const VersionLeaderboardQuerySchema = PaginationSchema.extend({
  versionId: z.string().uuid().optional(),
  mode: z
    .enum(['rating_model', 'winrate'])
    .default('rating_model'),
});

/** Resolve display info for a sliced GS board: user (1v1) or team + members (2v2). */
async function resolveBoardDisplay(
  prisma: PrismaClient,
  format: CompetitorFormatFilter,
  competitorIds: string[],
): Promise<(id: string) => Record<string, unknown> | null> {
  if (format === 'TWO_V_TWO') {
    const teams = competitorIds.length
      ? await prisma.team.findMany({
          where: { id: { in: competitorIds } },
          select: {
            id: true,
            name: true,
            members: { select: { user_id: true, user: { select: { username: true, avatar_url: true } } } },
          },
        })
      : [];
    const byId = new Map(teams.map((t) => [t.id, t]));
    return (id: string) => {
      const t = byId.get(id);
      return t
        ? {
            team: {
              id: t.id,
              name: t.name,
              members: t.members.map((m) => ({
                id: m.user_id,
                username: m.user.username,
                avatar_url: m.user.avatar_url,
              })),
            },
          }
        : null;
    };
  }
  const users = competitorIds.length
    ? await prisma.user.findMany({
        where: { id: { in: competitorIds } },
        select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT },
      })
    : [];
  const byId = new Map(users.map((u) => [u.id, u]));
  return (id: string) => {
    const u = byId.get(id);
    return u ? { user: { id: u.id, username: u.username, avatar_url: u.avatar_url, tiers: effectiveTiersOf(u) } } : null;
  };
}

const leaderboardRoutes: FastifyPluginAsync = async (fastify) => {
  // GET /api/leaderboard?versionId=...&page=1&pageSize=50
  fastify.get('/api/leaderboard', async (request, reply) => {
    const parsed = VersionLeaderboardQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { versionId, page, pageSize, mode } = parsed.data;

    // Version lookup cannot be cached because 404 detection must happen before caching
    let version;
    if (versionId) {
      version = await fastify.prisma.gameVersion.findUnique({ where: { id: versionId } });
      if (!version) {
        return reply.code(404).send({ error: 'NotFound', message: 'Version not found', statusCode: 404 });
      }
    } else {
      version = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });
      if (!version) {
        return reply.code(404).send({ error: 'NotFound', message: 'No active version', statusCode: 404 });
      }
    }

    const resolvedVersionId = version.id;

    const MIN_MATCHES_FOR_RATE = 5;

    return cached(
      fastify.redis,
      cacheKey('leaderboard:version', { versionId: resolvedVersionId, page, pageSize, mode }),
      async () => {
        // ---------------------------------------------------------------
        // mode = 'rating_model' (default) — dynamic weighted leaderboard.
        // Derived live from confirmed match facts + the current rating model.
        // ---------------------------------------------------------------
        if (mode === 'rating_model') {
          const all = await computeVersionLeaderboard(fastify.prisma, fastify.redis, resolvedVersionId);
          const pageSlice = all.slice((page - 1) * pageSize, page * pageSize);

          return {
            mode,
            version: {
              id: version!.id,
              name: version!.name,
              start_date: version!.start_date.toISOString(),
              end_date: version!.end_date.toISOString(),
              is_active: version!.is_active,
            },
            entries: pageSlice.map((e, idx) => ({
              rank: (page - 1) * pageSize + idx + 1,
              playerId: e.playerId,
              displayName: e.displayName,
              avatarUrl: e.avatarUrl,
              tiers: e.tiers,
              totalFinalPoints: e.totalFinalPoints,
              totalRawPoints: e.totalRawPoints,
              totalGames: e.totalGames,
              wins: e.wins,
              losses: e.losses,
            })),
            total: all.length,
            page,
            pageSize,
          };
        }

        // ---------------------------------------------------------------
        // mode = 'winrate' — sort by wins/totalGames desc, min 5 games.
        // Uses the same dynamic MatchGame source as rating_model so the
        // filter is consistent with what the Version tab shows.
        // ---------------------------------------------------------------
        {
          const all = await computeVersionLeaderboard(fastify.prisma, fastify.redis, resolvedVersionId);
          const qualified = all
            .filter((e) => e.totalGames >= MIN_MATCHES_FOR_RATE)
            .sort((a, b) => {
              const rateA = a.totalGames > 0 ? a.wins / a.totalGames : 0;
              const rateB = b.totalGames > 0 ? b.wins / b.totalGames : 0;
              return rateB - rateA || b.totalGames - a.totalGames;
            });

          const total = qualified.length;
          const pageSlice = qualified.slice((page - 1) * pageSize, page * pageSize);

          return {
            mode,
            version: {
              id: version!.id,
              name: version!.name,
              start_date: version!.start_date.toISOString(),
              end_date: version!.end_date.toISOString(),
              is_active: version!.is_active,
            },
            entries: pageSlice.map((e, idx) => ({
              rank: (page - 1) * pageSize + idx + 1,
              user: { id: e.playerId, username: e.displayName, avatar_url: e.avatarUrl, tiers: e.tiers },
              total_points: Math.round(e.totalFinalPoints),
              games_played: e.totalGames,
              wins: e.wins,
              losses: e.losses,
              win_rate: e.totalGames > 0 ? e.wins / e.totalGames : 0,
            })),
            total,
            page,
            pageSize,
          };
        }
      },
      { ttlSeconds: 60 },
    );
  });

  // GET /api/leaderboard/major-wins — #6: players ranked by MAJOR tournament wins. A win
  // is being the SINGLE champion of a completed is_major tournament — the decisive final
  // winner (for Balanced Liechtenstein, the TOP division's final), computed from match
  // data via tournamentChampion (not TournamentResult.placement, which is multi-valued for
  // BaLi and can carry stale rows). Standard competition ranking. Public, cached.
  fastify.get('/api/leaderboard/major-wins', async () => {
    return cached(
      fastify.redis,
      cacheKey('leaderboard:major-wins', {}),
      async () => {
        const tournaments = await fastify.prisma.tournament.findMany({
          where: { is_major: true, deleted_at: null, status: 'COMPLETED' },
          select: { id: true, format: true, name: true, slug: true, start_date: true },
          orderBy: { start_date: 'desc' },
        });
        if (tournaments.length === 0) return { entries: [] };
        const tournamentIds = tournaments.map((t) => t.id);

        const [matches, participants, gameWins] = await Promise.all([
          fastify.prisma.match.findMany({
            where: { tournament_id: { in: tournamentIds }, deleted_at: null },
            select: {
              tournament_id: true,
              phase: true,
              status: true,
              round: true,
              winner_id: true,
              player1_id: true,
              player2_id: true,
              bracket_side: true,
            },
          }),
          fastify.prisma.tournamentParticipant.findMany({
            where: { tournament_id: { in: tournamentIds }, deleted_at: null },
            select: { tournament_id: true, user_id: true, skill_band: true, status: true },
          }),
          // Tiebreaker: total GAME wins across all majors (games are the statistical unit —
          // not tournament wins, not match wins). Leaderboard-excluded games (voided / modded
          // faction) count for nothing, so counts_for_leaderboard is enforced.
          fastify.prisma.matchGame.groupBy({
            by: ['winner_id'],
            where: {
              status: 'COMPLETED',
              counts_for_leaderboard: true,
              winner_id: { not: null },
              match: { tournament_id: { in: tournamentIds }, deleted_at: null },
            },
            _count: { _all: true },
          }),
        ]);
        const gameWinsByUser = new Map(gameWins.map((g) => [g.winner_id!, g._count._all]));

        const matchesByT = new Map<string, ChampionMatch[]>();
        for (const m of matches) {
          if (!m.tournament_id) continue;
          (matchesByT.get(m.tournament_id) ?? matchesByT.set(m.tournament_id, []).get(m.tournament_id)!).push(m);
        }
        const partsByT = new Map<string, typeof participants>();
        for (const p of participants) {
          (partsByT.get(p.tournament_id) ?? partsByT.set(p.tournament_id, []).get(p.tournament_id)!).push(p);
        }

        // Champion user id → the majors they won.
        const byUser = new Map<
          string,
          { tournaments: { id: string; name: string; slug: string; startDate: string | null }[] }
        >();
        for (const t of tournaments) {
          const ps = partsByT.get(t.id) ?? [];
          const champion = tournamentChampion(
            t.id,
            t.format,
            matchesByT.get(t.id) ?? [],
            new Map(ps.map((p) => [p.user_id, p.skill_band ?? 0])),
            ps.map((p) => p.user_id),
            new Set(ps.filter((p) => p.status === 'WITHDREW').map((p) => p.user_id)),
          );
          if (!champion) continue;
          const cur = byUser.get(champion) ?? { tournaments: [] };
          cur.tournaments.push({
            id: t.id,
            name: t.name,
            slug: t.slug,
            startDate: t.start_date?.toISOString() ?? null,
          });
          byUser.set(champion, cur);
        }

        const championIds = [...byUser.keys()];
        const users = championIds.length
          ? await fastify.prisma.user.findMany({
              where: { id: { in: championIds } },
              select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT },
            })
          : [];
        const userById = new Map(users.map((u) => [u.id, u]));

        const rows = championIds
          .map((id) => {
            const u = userById.get(id);
            const v = byUser.get(id)!;
            return u
              ? {
                  user: { id: u.id, username: u.username, avatar_url: u.avatar_url, tiers: effectiveTiersOf(u) },
                  wins: v.tournaments.length,
                  majorGameWins: gameWinsByUser.get(id) ?? 0,
                  tournaments: v.tournaments,
                }
              : null;
          })
          .filter((r): r is NonNullable<typeof r> => r !== null)
          // Primary: major titles. Tiebreaker: total game wins across majors. Then name.
          .sort(
            (a, b) =>
              b.wins - a.wins ||
              b.majorGameWins - a.majorGameWins ||
              a.user.username.localeCompare(b.user.username),
          );

        // Standard competition ranking: rows tied on BOTH titles and the game-win
        // tiebreaker share a rank.
        let lastKey = '';
        let lastRank = 0;
        const entries = rows.map((e, i) => {
          const key = `${e.wins}:${e.majorGameWins}`;
          const rank = key === lastKey ? lastRank : i + 1;
          lastKey = key;
          lastRank = rank;
          return { rank, user: e.user, wins: e.wins, majorGameWins: e.majorGameWins, tournaments: e.tournaments };
        });

        return { entries };
      },
      { ttlSeconds: 300 },
    );
  });

  // GET /api/leaderboard/skill — #14: players ranked purely by their DATA-derived general
  // skill (GS) from the hierarchical rating model. NOT the questionnaire band, NOT the
  // achievement/points leaderboard — just "how strong is this player" from game results.
  // Only players with ≥ minGames decisive games are ranked (thin data is unreliable).
  fastify.get('/api/leaderboard/skill', async (request, reply) => {
    const parsed = z
      .object({
        versionId: z.string().uuid().optional(),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(1000).default(100),
        // #8: the Skill leaderboard excludes players with fewer than 20 games (a handful of
        // games is too noisy to rank on), and shows their real win-rate as a column.
        minGames: z.coerce.number().int().min(1).max(1000).default(20),
      })
      .safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }
    const { versionId, page, pageSize, minGames } = parsed.data;

    let version;
    if (versionId) {
      version = await fastify.prisma.gameVersion.findUnique({ where: { id: versionId } });
      if (!version) return reply.code(404).send({ error: 'NotFound', message: 'Version not found', statusCode: 404 });
    } else {
      version = await fastify.prisma.gameVersion.findFirst({ where: { is_active: true } });
      if (!version) return reply.code(404).send({ error: 'NotFound', message: 'No active version', statusCode: 404 });
    }
    const resolvedVersionId = version.id;

    return cached(
      fastify.redis,
      cacheKey('leaderboard:skill', { versionId: resolvedVersionId, page, pageSize, minGames }),
      async () => {
        // Force the hierarchical fit so the general-skill decomposition exists (mirrors the
        // skill-classification service — the flat default model has no GS).
        const model = await getRatingModel(fastify.prisma, fastify.redis, {
          versionId: resolvedVersionId,
          config: { hierarchical: true },
        });

        const eligible = model.generalSkills
          .filter((e) => e.gamesCount >= minGames)
          .sort((a, b) => b.generalSkill - a.generalSkill || b.gamesCount - a.gamesCount);
        const total = eligible.length;
        const slice = eligible.slice((page - 1) * pageSize, page * pageSize);

        const users = slice.length
          ? await fastify.prisma.user.findMany({
              where: { id: { in: slice.map((e) => e.playerId) } },
              select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT },
            })
          : [];
        const userById = new Map(users.map((u) => [u.id, u]));

        // #8: real win/loss record (same dynamic MatchGame source as the old winrate tab) so the
        // Skill leaderboard can show an actual win-rate column next to the model-derived skill.
        const record = new Map(
          (await computeVersionLeaderboard(fastify.prisma, fastify.redis, resolvedVersionId)).map((r) => [
            r.playerId,
            r,
          ]),
        );

        const entries = slice.flatMap((e, i) => {
          const user = userById.get(e.playerId);
          if (!user) return [];
          const rec = record.get(e.playerId);
          const wins = rec?.wins ?? 0;
          const losses = rec?.losses ?? 0;
          const gamesForRate = rec?.totalGames ?? e.gamesCount;
          return [
            {
              rank: (page - 1) * pageSize + i + 1,
              user: { id: user.id, username: user.username, avatar_url: user.avatar_url, tiers: effectiveTiersOf(user) },
              generalSkill: e.generalSkill,
              stdError: e.stdError,
              winChance: logistic(e.generalSkill),
              band: skillToBand(e.generalSkill),
              gamesCount: e.gamesCount,
              factionsPlayed: e.factionsPlayed,
              wins,
              losses,
              winRate: gamesForRate > 0 ? wins / gamesForRate : 0,
            },
          ];
        });

        return {
          entries,
          total,
          page,
          pageSize,
          version: { id: version.id, name: version.name, is_active: version.is_active },
        };
      },
      { ttlSeconds: 3600 },
    );
  });

  // -------------------------------------------------------------------------
  // Competition tracks (design doc §6/§7).
  // -------------------------------------------------------------------------

  // GET /api/leaderboard/rankings — the timeless GS board (merges the old Skill + Hall of Fame),
  // sorted purely by GS. Self-scaling inclusion: a competitor is listed with >= cutoff decisive
  // games, cutoff = min(permanence, days since launch); reaching `permanence` makes them permanent
  // (HoF badge), immune to the rising cutoff. Filters: battleType (Overall / Domination / Conquest
  // / Siege) × competitorFormat (1v1 players | 2v2 teams — the latter folds in the old Teams board).
  fastify.get('/api/leaderboard/rankings', async (request, reply) => {
    const parsed = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(1000).default(100),
        battleType: z.enum(['OVERALL', 'DOMINATION', 'CONQUEST', 'SIEGE']).default('OVERALL'),
        competitorFormat: z.enum(['ONE_V_ONE', 'TWO_V_TWO']).default('ONE_V_ONE'),
      })
      .safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    const { page, pageSize, battleType, competitorFormat } = parsed.data;
    const cfg = await loadCompetitionConfig(fastify.prisma);
    const permanence = cfg.hallOfFameMinGames;
    const cutoff = rankingsCutoff(cfg);
    return cached(
      fastify.redis,
      cacheKey('leaderboard:rankings', { page, pageSize, battleType, competitorFormat, cutoff, permanence }),
      async () => {
        const board = await computeGsBoard(fastify.prisma, fastify.redis, {
          versionId: null,
          battleType,
          competitorFormat,
        });
        // In-scope games: total for Overall, else games IN the selected battle type — a battle-type
        // board must not list everyone via the GS fallback, only players who actually played it.
        const inScope = (e: (typeof board)[number]) => (battleType === 'OVERALL' ? e.gamesCount : e.battleTypeGames);
        // 1v1: OPEN board — everyone who has played (>= 1 decisive game) is listed, so newcomers
        // appear immediately. GS shrinkage keeps low-sample players near the mean, and the frontend
        // marks them `provisional`; a rolling activity threshold (drop the dormant, keep active
        // newcomers) is a planned follow-up. 2v2: all active teams for Overall, else only teams that
        // played the type.
        const eligible =
          competitorFormat === 'ONE_V_ONE'
            ? board.filter((e) => inScope(e) >= 1)
            : battleType === 'OVERALL'
              ? board
              : board.filter((e) => inScope(e) >= 1);
        const total = eligible.length;
        const slice = eligible.slice((page - 1) * pageSize, page * pageSize);
        const display = await resolveBoardDisplay(fastify.prisma, competitorFormat, slice.map((e) => e.competitorId));
        const entries = slice.flatMap((e, i) => {
          const d = display(e.competitorId);
          if (!d) return [];
          return [
            {
              rank: (page - 1) * pageSize + i + 1,
              ...d,
              generalSkill: e.gs,
              stdError: e.stdError,
              band: e.band,
              winChance: logistic(e.gs),
              gamesCount: inScope(e),
              permanent: competitorFormat === 'ONE_V_ONE' && inScope(e) >= permanence,
              provisional: e.provisional,
            },
          ];
        });
        return { entries, total, page, pageSize, battleType, competitorFormat, permanenceThreshold: permanence, cutoff };
      },
      { ttlSeconds: 3600 },
    );
  });

  // GET /api/leaderboard/hall-of-fame — timeless GS; players with >= threshold games
  // sort ABOVE everyone else (two-class), ranked by their stable lifetime GS. Listed forever.
  fastify.get('/api/leaderboard/hall-of-fame', async (request, reply) => {
    const parsed = z
      .object({ page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(1000).default(100) })
      .safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    const { page, pageSize } = parsed.data;
    const cfg = await loadCompetitionConfig(fastify.prisma);
    return cached(
      fastify.redis,
      cacheKey('leaderboard:hof', { page, pageSize, min: cfg.hallOfFameMinGames }),
      async () => {
        const model = await getRatingModel(fastify.prisma, fastify.redis, { versionId: null, config: { hierarchical: true } });
        const min = cfg.hallOfFameMinGames;
        const ranked = model.generalSkills.slice().sort((a, b) => {
          const qa = a.gamesCount >= min ? 1 : 0;
          const qb = b.gamesCount >= min ? 1 : 0;
          return qb - qa || b.generalSkill - a.generalSkill || b.gamesCount - a.gamesCount;
        });
        const total = ranked.length;
        const qualifiedCount = ranked.filter((e) => e.gamesCount >= min).length;
        const slice = ranked.slice((page - 1) * pageSize, page * pageSize);
        const users = slice.length
          ? await fastify.prisma.user.findMany({
              where: { id: { in: slice.map((e) => e.playerId) } },
              select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT },
            })
          : [];
        const byId = new Map(users.map((u) => [u.id, u]));
        const entries = slice.flatMap((e, i) => {
          const u = byId.get(e.playerId);
          if (!u) return [];
          return [
            {
              rank: (page - 1) * pageSize + i + 1,
              user: { id: u.id, username: u.username, avatar_url: u.avatar_url, tiers: effectiveTiersOf(u) },
              generalSkill: e.generalSkill,
              stdError: e.stdError,
              band: skillToBand(e.generalSkill),
              gamesCount: e.gamesCount,
              qualified: e.gamesCount >= min,
            },
          ];
        });
        return { entries, total, page, pageSize, threshold: min, qualifiedCount };
      },
      { ttlSeconds: 3600 },
    );
  });

  // GET /api/leaderboard/quarterly — the Quarterly Qualifier: a GS fit windowed to THIS quarter's
  // games (tournament + ladder), with a STRICT self-scaling gate = min(cap, days into quarter).
  // Top-N seeds the Quarterly Final. Same battleType × competitorFormat filters as Rankings.
  fastify.get('/api/leaderboard/quarterly', async (request, reply) => {
    const parsed = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(1000).default(100),
        battleType: z.enum(['OVERALL', 'DOMINATION', 'CONQUEST', 'SIEGE']).default('OVERALL'),
        competitorFormat: z.enum(['ONE_V_ONE', 'TWO_V_TWO']).default('ONE_V_ONE'),
        quarter: z.string().optional(), // "YYYY-Qn"; default = current quarter
      })
      .safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    const { page, pageSize, battleType, competitorFormat, quarter } = parsed.data;
    const overrides = await loadQuarterOverrides(fastify.prisma);
    const q = resolveQuarter(quarter ?? quarterValue(currentQuarter()), overrides);
    if (!q) return reply.code(400).send({ error: 'BadRequest', message: 'Invalid quarter', statusCode: 400 });
    const cfg = await loadCompetitionConfig(fastify.prisma);
    const gate = qualiGate(cfg, q);
    const quarters = listQuartersResolved(overrides).map((p) => ({ value: p.value, label: p.label }));
    return cached(
      fastify.redis,
      cacheKey('leaderboard:quarterly', { page, pageSize, battleType, competitorFormat, quarter: q.value, gate, from: q.from.toISOString(), to: q.to.toISOString() }),
      async () => {
        const board = await computeGsBoard(fastify.prisma, fastify.redis, {
          versionId: null,
          window: { from: q.from, to: q.to },
          battleType,
          competitorFormat,
        });
        // In-scope games: total for Overall, else games IN the selected battle type — so a
        // battle-type board lists only players who actually played it (not everyone via the GS
        // fallback). Show EVERYONE who played (>=1) with a `qualified` flag; the frontend greys
        // the sub-gate players + shows a legend, rather than hiding them.
        const inScope = (e: (typeof board)[number]) => (battleType === 'OVERALL' ? e.gamesCount : e.battleTypeGames);
        const played = board.filter((e) => inScope(e) >= 1);
        const qualifiedCount = played.filter((e) => inScope(e) >= gate).length;
        const total = played.length;
        const slice = played.slice((page - 1) * pageSize, page * pageSize);
        const display = await resolveBoardDisplay(fastify.prisma, competitorFormat, slice.map((e) => e.competitorId));
        const entries = slice.flatMap((e, i) => {
          const d = display(e.competitorId);
          if (!d) return [];
          return [
            {
              rank: (page - 1) * pageSize + i + 1,
              ...d,
              generalSkill: e.gs,
              stdError: e.stdError,
              band: e.band,
              gamesCount: inScope(e),
              qualified: inScope(e) >= gate,
              provisional: e.provisional,
            },
          ];
        });
        return { entries, total, qualifiedCount, page, pageSize, quarter: q.label, quarterValue: q.value, quarters, battleType, competitorFormat, gate, capGames: cfg.qualiMinGames };
      },
      { ttlSeconds: 600 },
    );
  });

  // GET /api/leaderboard/ladder — the monthly Open-Play points board (drives activity),
  // reset each month.
  fastify.get('/api/leaderboard/ladder', async (request, reply) => {
    const parsed = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(1000).default(100),
        month: z.string().optional(), // "YYYY-MM"; default = current month
      })
      .safeParse(request.query);
    if (!parsed.success) return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    const { page, pageSize, month: monthParam } = parsed.data;
    const month = monthParam ? parseMonth(monthParam) : currentMonth();
    if (!month) return reply.code(400).send({ error: 'BadRequest', message: 'Invalid month', statusCode: 400 });
    const cfg = await loadCompetitionConfig(fastify.prisma);
    const months = listMonthsSinceLaunch().map((p) => ({ value: p.value, label: p.label }));
    return cached(
      fastify.redis,
      cacheKey('leaderboard:ladder', { page, pageSize, from: month.from.toISOString() }),
      async () => {
        const standings = await computeLadderStandings(fastify.prisma, month, cfg);
        const total = standings.length;
        const slice = standings.slice((page - 1) * pageSize, page * pageSize);
        const users = slice.length
          ? await fastify.prisma.user.findMany({
              where: { id: { in: slice.map((s) => s.playerId) } },
              select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT },
            })
          : [];
        const byId = new Map(users.map((u) => [u.id, u]));
        const entries = slice.flatMap((s, i) => {
          const u = byId.get(s.playerId);
          if (!u) return [];
          return [
            {
              rank: (page - 1) * pageSize + i + 1,
              user: { id: u.id, username: u.username, avatar_url: u.avatar_url, tiers: effectiveTiersOf(u) },
              points: s.points,
              games: s.games,
              wins: s.wins,
              losses: s.losses,
              draws: s.draws,
            },
          ];
        });
        return { entries, total, page, pageSize, month: month.label, monthValue: monthValue(month), months };
      },
      { ttlSeconds: 300 },
    );
  });
};

export default leaderboardRoutes;
