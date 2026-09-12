import type { FastifyPluginAsync } from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { generateSlug, canManageTournament } from '../lib/tournament-utils.js';
import { canManageSeries, resolveSeriesSlug } from '../lib/series-utils.js';
import { getQualifierPlacements } from '../lib/series-qualification.js';
import { maybeSendSeriesInvite, notifySeriesFinalSeeded } from '../lib/series-notify.js';
import { cached, invalidate, cacheKey } from '../lib/cache.js';
import { POSTER_DIR } from '../lib/posters.js';
import {
  ScoringConfigSchema,
  computeSeriesStandingsA,
  computeSeriesQualifiersC,
  type SeriesGame,
  type QualifierPlacement,
} from '../lib/series-scoring.js';

const CreateSeriesSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(2000).optional(),
  poster_url: z.string().url().optional().nullable(),
  visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
  scoring_config: ScoringConfigSchema,
  qualifier_ids: z.array(z.string().uuid()).max(64).optional(),
  final_tournament_id: z.string().uuid().optional(),
});

const PatchSeriesSchema = z
  .object({
    name: z.string().min(3).max(120).optional(),
    description: z.string().max(2000).optional().nullable(),
    poster_url: z.string().url().optional().nullable(),
    visibility: z.enum(['PUBLIC', 'PRIVATE']).optional(),
    scoring_config: ScoringConfigSchema.optional(),
    final_tournament_id: z.string().uuid().optional().nullable(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'Body must contain at least one field' });

const AttachSchema = z.object({ tournamentId: z.string().uuid() });

const badRequest = (message: string) => ({ error: 'BadRequest', message, statusCode: 400 });

// ---------------------------------------------------------------------------
// Cache helpers
// ---------------------------------------------------------------------------

// Detail cache strategy:
// The detail response includes `can_manage` which differs per viewer. Rather
// than serving a manager's can_manage=true to anonymous viewers, we key the
// heavy standings computation by slug only (it's viewer-independent) and
// re-compute can_manage cheaply after the cache hit. This avoids the
// combinatorial explosion of per-user cache entries while still being correct.
// In practice the standings are the expensive part; can_manage is one DB row.

const SERIES_CACHE_TTL = 30; // seconds

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const seriesRoutes: FastifyPluginAsync = async (fastify) => {
  // Enrich a set of competitor ids with usernames/avatars in one query.
  const loadUsers = async (ids: string[]) => {
    const users = await fastify.prisma.user.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, username: true, avatar_url: true },
    });
    return new Map(users.map((u) => [u.id, u]));
  };

  // Compute the live standings/qualifiers for a series from its qualifiers' results.
  const computeStandings = async (seriesId: string, config: z.infer<typeof ScoringConfigSchema>, qualifiers: { id: string }[]) => {
    const qualifierIds = qualifiers.map((q) => q.id);
    if (qualifierIds.length === 0) return { model: config.model, standings: [], qualifiers: [] };

    // NONE = grouping-only series: no scoring, no qualification.
    if (config.model === 'NONE') return { model: 'NONE' as const, standings: [], qualifiers: [] };

    if (config.model === 'A') {
      const games = await fastify.prisma.matchGame.findMany({
        where: {
          status: 'COMPLETED',
          match: {
            player1_id: { not: null },
            player2_id: { not: null },
            counts_for_leaderboard: true,
            deleted_at: null,
            tournament_id: { in: qualifierIds },
          },
        },
        select: { winner_id: true, match: { select: { player1_id: true, player2_id: true } } },
      });
      const seriesGames: SeriesGame[] = games.map((g) => ({
        player1Id: g.match.player1_id,
        player2Id: g.match.player2_id,
        winnerId: g.winner_id,
      }));
      const standings = computeSeriesStandingsA(seriesGames, config, seriesId);
      const userMap = await loadUsers(standings.map((s) => s.competitorId));
      return {
        model: 'A' as const,
        standings: standings.map((s) => ({
          ...s,
          username: userMap.get(s.competitorId)?.username ?? 'Unknown',
          avatar_url: userMap.get(s.competitorId)?.avatar_url ?? null,
        })),
        qualifiers: [],
      };
    }

    // Model C — per-qualifier Top-X, skipping already-qualified players. Placement source is
    // format-aware (BaLi = highest-division playoff, else TournamentResult) via getQualifierPlacements.
    const perQualifier: QualifierPlacement[][] = [];
    for (const q of qualifiers) {
      const placements = await getQualifierPlacements(fastify.prisma, q.id);
      perQualifier.push(placements.map((p) => ({ tournamentId: q.id, competitorId: p.userId, position: p.position })));
    }
    const entries = computeSeriesQualifiersC(perQualifier, config);
    const userMap = await loadUsers(entries.map((e) => e.competitorId));
    return {
      model: 'C' as const,
      standings: [],
      qualifiers: entries.map((e) => ({
        ...e,
        username: userMap.get(e.competitorId)?.username ?? 'Unknown',
        avatar_url: userMap.get(e.competitorId)?.avatar_url ?? null,
      })),
    };
  };

  // -------------------------------------------------------------------------
  // Cache invalidation helpers
  // -------------------------------------------------------------------------

  async function invalidateList() {
    await invalidate(fastify.redis, 'series:list:*');
  }

  async function invalidateDetail(slug: string) {
    await invalidate(fastify.redis, `series:detail:${slug}`);
  }

  async function invalidateSeries(slug: string) {
    await Promise.all([invalidateList(), invalidateDetail(slug)]);
  }

  // -------------------------------------------------------------------------
  // GET /api/series — public list
  // -------------------------------------------------------------------------
  fastify.get('/api/series', async (request, reply) => {
    const parsed = z
      .object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(20),
        // manageable=true → only series the viewer can manage (owner/co-host; staff = all).
        // Used by the tournament create/edit "Part of a series" picker.
        manageable: z.coerce.boolean().optional(),
      })
      .safeParse(request.query);
    if (!parsed.success) return reply.code(400).send(badRequest(parsed.error.message));
    const { page, pageSize, manageable } = parsed.data;

    let viewerId: string | null = null;
    let role = 'USER';
    try {
      await request.jwtVerify();
      viewerId = request.user.sub;
      role = request.user.role;
    } catch {
      /* anonymous */
    }
    const isStaff = role === 'MODERATOR' || role === 'ADMIN';

    // Viewer key collapses to staff / userId / anon — mirrors the tournament list approach.
    const viewerKey = isStaff ? 'staff' : (viewerId ?? 'anon');

    const data = await cached(
      fastify.redis,
      cacheKey('series:list', { page, pageSize, viewer: viewerKey, manageable: manageable ? 1 : 0 }),
      async () => {
        // Visibility: staff see everything; owner/co-host see their own private ones;
        // anonymous + others see only PUBLIC and non-paused.
        // Paused series are hidden from viewers who cannot manage them.
        const ownable = viewerId
          ? [{ owner_id: viewerId }, { co_hosts: { some: { user_id: viewerId } } }]
          : [];

        const where = manageable
          ? {
              // Only series the viewer can manage. Staff manage all; others = own/co-hosted
              // (an empty OR for an anonymous caller matches nothing, which is correct).
              deleted_at: null,
              ...(isStaff ? {} : { OR: ownable }),
            }
          : {
              deleted_at: null,
              // Visibility: staff see all; others see PUBLIC or their own
              ...(isStaff
                ? {}
                : {
                    OR: [
                      { visibility: 'PUBLIC' as const, paused: false },
                      ...ownable,
                    ],
                  }),
            };

        const [rows, total] = await Promise.all([
          fastify.prisma.tournamentSeries.findMany({
            where,
            select: {
              id: true,
              slug: true,
              name: true,
              poster_url: true,
              visibility: true,
              paused: true,
              scoring_config: true,
              created_at: true,
              owner: { select: { id: true, username: true, avatar_url: true } },
              co_hosts: { select: { user: { select: { id: true, username: true, avatar_url: true } } } },
              final_tournament: { select: { slug: true, name: true, status: true } },
              _count: { select: { qualifiers: true } },
            },
            orderBy: { created_at: 'desc' },
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          fastify.prisma.tournamentSeries.count({ where }),
        ]);

        return {
          data: rows.map((r) => ({
            id: r.id,
            slug: r.slug,
            name: r.name,
            poster_url: r.poster_url,
            visibility: r.visibility,
            paused: r.paused,
            scoring_config: r.scoring_config,
            created_at: r.created_at,
            owner: r.owner,
            co_hosts: r.co_hosts.map((h) => h.user),
            final: r.final_tournament,
            qualifierCount: r._count.qualifiers,
          })),
          total,
          page,
          pageSize,
        };
      },
      { ttlSeconds: SERIES_CACHE_TTL },
    );

    return data;
  });

  // -------------------------------------------------------------------------
  // GET /api/series/:slug — detail + live standings
  // -------------------------------------------------------------------------
  fastify.get('/api/series/:slug', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    let viewerId: string | null = null;
    let role = 'USER';
    try {
      await request.jwtVerify();
      viewerId = request.user.sub;
      role = request.user.role;
    } catch {
      /* anonymous */
    }

    // Cache the heavy standings computation by slug only (viewer-independent).
    // can_manage is re-derived after the cache hit — it's a single cheap query.
    // This keeps cache entries small: one per slug rather than one per slug×user.
    const seriesData = await cached(
      fastify.redis,
      `series:detail:${slug}`,
      async () => {
        const series = await fastify.prisma.tournamentSeries.findFirst({
          where: { slug, deleted_at: null },
          select: {
            id: true,
            slug: true,
            name: true,
            description: true,
            poster_url: true,
            visibility: true,
            paused: true,
            scoring_config: true,
            final_seeded_at: true,
            created_at: true,
            owner: { select: { id: true, username: true, avatar_url: true } },
            co_hosts: { select: { user: { select: { id: true, username: true, avatar_url: true } } } },
            final_tournament: { select: { id: true, slug: true, name: true, status: true, start_date: true } },
            qualifiers: {
              where: { deleted_at: null },
              select: { id: true, slug: true, name: true, status: true, series_position: true, start_date: true },
              orderBy: [{ series_position: 'asc' }, { created_at: 'asc' }],
            },
          },
        });
        if (!series) return null;

        const config = ScoringConfigSchema.parse(series.scoring_config);
        const computed = await computeStandings(series.id, config, series.qualifiers);
        const allQualifiersComplete =
          series.qualifiers.length > 0 && series.qualifiers.every((q) => q.status === 'COMPLETED');

        return {
          series,
          config,
          computed,
          allQualifiersComplete,
        };
      },
      { ttlSeconds: SERIES_CACHE_TTL },
    );

    if (!seriesData) {
      return reply.code(404).send({ error: 'NotFound', message: `Series "${slug}" not found`, statusCode: 404 });
    }

    const { series, config, computed, allQualifiersComplete } = seriesData;

    // can_manage is viewer-specific — computed after cache hit, never stored in cache.
    const canManage = viewerId ? await canManageSeries(fastify.prisma, series.id, viewerId, role) : false;
    if (series.visibility === 'PRIVATE' && !canManage) {
      return reply.code(403).send({ error: 'Forbidden', message: 'This series is private', statusCode: 403 });
    }
    // Paused series are hidden from non-managers (same semantics as visibility).
    if (series.paused && !canManage) {
      return reply.code(403).send({ error: 'Forbidden', message: 'This series is currently paused', statusCode: 403 });
    }

    return {
      ...series,
      co_hosts: series.co_hosts.map((h) => h.user),
      scoring_config: config,
      can_manage: canManage,
      final: series.final_tournament,
      standings: computed.standings,
      qualified: computed.qualifiers,
      // Model A "qualified" is provisional until every qualifier is done.
      standings_provisional: config.model === 'A' && !allQualifiersComplete,
      ready_to_seed: config.model !== 'NONE' && allQualifiersComplete && !series.final_seeded_at && !!series.final_tournament,
    };
  });

  // -------------------------------------------------------------------------
  // POST /api/series — create
  // -------------------------------------------------------------------------
  fastify.post('/api/series', { preHandler: [fastify.authenticate, fastify.requireRole('HOST', 'MODERATOR', 'ADMIN')] }, async (request, reply) => {
    const parsed = CreateSeriesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(badRequest(parsed.error.message));
    const data = parsed.data;
    const user = request.user;

    // A final is mandatory for scoring models A and C (it's where the qualified players go);
    // a grouping-only NONE series has no final.
    if (data.scoring_config.model !== 'NONE' && !data.final_tournament_id) {
      return reply.code(400).send(badRequest('A final tournament is required for scoring models A and C.'));
    }

    // Every qualifier (and the final, if given) must be one this user can manage.
    const attachIds = data.qualifier_ids ?? [];
    for (const tid of [...attachIds, ...(data.final_tournament_id ? [data.final_tournament_id] : [])]) {
      if (!(await canManageTournament(fastify.prisma, tid, user.sub, user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: `You cannot manage tournament ${tid}`, statusCode: 403 });
      }
    }

    const slug = await resolveSeriesSlug(fastify.prisma, generateSlug(data.name));
    const series = await fastify.prisma.tournamentSeries.create({
      data: {
        slug,
        name: data.name,
        description: data.description ?? null,
        poster_url: data.poster_url ?? null,
        visibility: data.visibility ?? 'PUBLIC',
        scoring_config: data.scoring_config,
        owner_id: user.sub,
        final_tournament_id: data.final_tournament_id ?? null,
      },
      select: { id: true, slug: true },
    });

    // Attach qualifiers (position = attach order).
    for (let i = 0; i < attachIds.length; i++) {
      await fastify.prisma.tournament.update({
        where: { id: attachIds[i] },
        data: { series_id: series.id, series_position: i + 1 },
      });
    }
    // Flag the final and lock it to REGISTRATION_CLOSED (so nobody self-registers; it's populated
    // by seed-final). Only lock a not-yet-started final — never downgrade a live/finished one.
    if (data.final_tournament_id) {
      const fin = await fastify.prisma.tournament.findUnique({ where: { id: data.final_tournament_id }, select: { status: true } });
      const lock = fin && (fin.status === 'DRAFT' || fin.status === 'OPEN_REGISTRATION');
      await fastify.prisma.tournament.update({
        where: { id: data.final_tournament_id },
        data: { is_series_final: true, ...(lock ? { status: 'REGISTRATION_CLOSED' as const } : {}) },
      });
    }

    await invalidateList();

    return reply.code(201).send({ id: series.id, slug: series.slug });
  });

  // -------------------------------------------------------------------------
  // PATCH /api/series/:slug
  // -------------------------------------------------------------------------
  fastify.patch('/api/series/:slug', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const parsed = PatchSeriesSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(badRequest(parsed.error.message));

    const series = await fastify.prisma.tournamentSeries.findFirst({ where: { slug, deleted_at: null }, select: { id: true } });
    if (!series) return reply.code(404).send({ error: 'NotFound', message: 'Series not found', statusCode: 404 });
    if (!(await canManageSeries(fastify.prisma, series.id, request.user.sub, request.user.role))) {
      return reply.code(403).send({ error: 'Forbidden', message: 'You cannot manage this series', statusCode: 403 });
    }

    const d = parsed.data;

    // scoring_config may only be changed while no qualifier has COMPLETED yet (fairness guard).
    if (d.scoring_config !== undefined) {
      const completedCount = await fastify.prisma.tournament.count({
        where: { series_id: series.id, status: 'COMPLETED', deleted_at: null },
      });
      if (completedCount > 0) {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Scoring cannot be changed after a qualifier has completed.',
          statusCode: 409,
        });
      }
    }

    await fastify.prisma.tournamentSeries.update({
      where: { id: series.id },
      data: {
        ...(d.name !== undefined ? { name: d.name } : {}),
        ...(d.description !== undefined ? { description: d.description } : {}),
        ...(d.poster_url !== undefined ? { poster_url: d.poster_url } : {}),
        ...(d.visibility !== undefined ? { visibility: d.visibility } : {}),
        ...(d.scoring_config !== undefined ? { scoring_config: d.scoring_config } : {}),
        ...(d.final_tournament_id !== undefined ? { final_tournament_id: d.final_tournament_id } : {}),
      },
    });

    await invalidateSeries(slug);

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // PATCH /api/series/:slug/pause — toggle paused state
  // -------------------------------------------------------------------------
  fastify.patch('/api/series/:slug/pause', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const parsed = z.object({ paused: z.boolean() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(badRequest(parsed.error.message));

    const series = await fastify.prisma.tournamentSeries.findFirst({ where: { slug, deleted_at: null }, select: { id: true } });
    if (!series) return reply.code(404).send({ error: 'NotFound', message: 'Series not found', statusCode: 404 });
    if (!(await canManageSeries(fastify.prisma, series.id, request.user.sub, request.user.role))) {
      return reply.code(403).send({ error: 'Forbidden', message: 'You cannot manage this series', statusCode: 403 });
    }

    await fastify.prisma.tournamentSeries.update({
      where: { id: series.id },
      data: { paused: parsed.data.paused },
    });

    await invalidateSeries(slug);

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // POST /api/series/:slug/attach  &  /detach
  // -------------------------------------------------------------------------
  fastify.post('/api/series/:slug/attach', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const parsed = AttachSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(badRequest(parsed.error.message));

    const series = await fastify.prisma.tournamentSeries.findFirst({ where: { slug, deleted_at: null }, select: { id: true } });
    if (!series) return reply.code(404).send({ error: 'NotFound', message: 'Series not found', statusCode: 404 });
    if (!(await canManageSeries(fastify.prisma, series.id, request.user.sub, request.user.role))) {
      return reply.code(403).send({ error: 'Forbidden', message: 'You cannot manage this series', statusCode: 403 });
    }
    if (!(await canManageTournament(fastify.prisma, parsed.data.tournamentId, request.user.sub, request.user.role))) {
      return reply.code(403).send({ error: 'Forbidden', message: 'You cannot manage that tournament', statusCode: 403 });
    }

    const max = await fastify.prisma.tournament.aggregate({ where: { series_id: series.id }, _max: { series_position: true } });
    await fastify.prisma.tournament.update({
      where: { id: parsed.data.tournamentId },
      data: { series_id: series.id, series_position: (max._max.series_position ?? 0) + 1 },
    });

    await invalidateSeries(slug);

    // Invite prior qualifiers' not-yet-qualified players — but only once the qualifier's
    // registration is open (self-gated; a DRAFT qualifier invites nobody until it opens).
    void maybeSendSeriesInvite(fastify.prisma, parsed.data.tournamentId);

    return { ok: true };
  });

  fastify.post('/api/series/:slug/detach', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const parsed = AttachSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send(badRequest(parsed.error.message));

    const series = await fastify.prisma.tournamentSeries.findFirst({ where: { slug, deleted_at: null }, select: { id: true } });
    if (!series) return reply.code(404).send({ error: 'NotFound', message: 'Series not found', statusCode: 404 });
    if (!(await canManageSeries(fastify.prisma, series.id, request.user.sub, request.user.role))) {
      return reply.code(403).send({ error: 'Forbidden', message: 'You cannot manage this series', statusCode: 403 });
    }
    await fastify.prisma.tournament.updateMany({
      where: { id: parsed.data.tournamentId, series_id: series.id },
      data: { series_id: null, series_position: null },
    });

    await invalidateSeries(slug);

    return { ok: true };
  });

  // -------------------------------------------------------------------------
  // POST /api/series/:slug/seed-final — lock standings & populate the final
  // Adds the qualified players to the final tournament as CHECKED_IN participants,
  // in seed order (seed 1 = top qualifier). The host then starts the final normally;
  // the start flow honours the persisted `seed`. One-click confirm safety step.
  // -------------------------------------------------------------------------
  fastify.post('/api/series/:slug/seed-final', { preHandler: fastify.authenticate }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const series = await fastify.prisma.tournamentSeries.findFirst({
      where: { slug, deleted_at: null },
      select: {
        id: true,
        scoring_config: true,
        final_seeded_at: true,
        final_tournament: { select: { id: true, slug: true } },
        qualifiers: {
          where: { deleted_at: null },
          select: { id: true, status: true },
          orderBy: [{ series_position: 'asc' }, { created_at: 'asc' }],
        },
      },
    });
    if (!series) return reply.code(404).send({ error: 'NotFound', message: 'Series not found', statusCode: 404 });
    if (!(await canManageSeries(fastify.prisma, series.id, request.user.sub, request.user.role))) {
      return reply.code(403).send({ error: 'Forbidden', message: 'You cannot manage this series', statusCode: 403 });
    }

    const config = ScoringConfigSchema.parse(series.scoring_config);
    if (config.model === 'NONE') return reply.code(400).send(badRequest('This is a grouping-only series with no final to seed.'));
    if (!series.final_tournament) return reply.code(400).send(badRequest('This series has no final tournament to seed.'));
    if (series.final_seeded_at) return reply.code(409).send({ error: 'Conflict', message: 'The final has already been seeded.', statusCode: 409 });
    const allComplete = series.qualifiers.length > 0 && series.qualifiers.every((q) => q.status === 'COMPLETED');
    if (!allComplete) return reply.code(409).send({ error: 'Conflict', message: 'All qualifiers must be completed before seeding the final.', statusCode: 409 });

    const computed = await computeStandings(series.id, config, series.qualifiers);
    const orderedIds =
      config.model === 'A'
        ? computed.standings.filter((s) => s.qualified).map((s) => s.competitorId)
        : computed.qualifiers.map((e) => e.competitorId);
    if (orderedIds.length === 0) return reply.code(409).send({ error: 'Conflict', message: 'No qualified players to seed.', statusCode: 409 });

    const finalId = series.final_tournament.id;
    let seed = 0;
    for (const userId of orderedIds) {
      seed += 1;
      await fastify.prisma.tournamentParticipant.upsert({
        where: { tournament_id_user_id: { tournament_id: finalId, user_id: userId } },
        update: { seed, status: 'CHECKED_IN', deleted_at: null },
        create: { tournament_id: finalId, user_id: userId, seed, status: 'CHECKED_IN' },
      });
    }
    await fastify.prisma.tournamentSeries.update({ where: { id: series.id }, data: { final_seeded_at: new Date() } });

    await invalidateSeries(slug);

    // Congratulate the qualified players + confirm to series managers.
    void notifySeriesFinalSeeded(fastify.prisma, series.id, orderedIds);

    return { ok: true, seeded: orderedIds.length, finalSlug: series.final_tournament.slug };
  });

  // -------------------------------------------------------------------------
  // Transfer-owner + co-host roster
  // Owner-only operations (plus MOD/ADMIN). Co-hosts themselves may NOT edit
  // the roster — mirrors tournament behaviour exactly.
  // -------------------------------------------------------------------------

  /** Load series and assert the caller may edit its co-host roster (owner + MOD/ADMIN only). */
  async function loadSeriesForRoster(
    slug: string,
    userId: string,
    role: string,
    reply: import('fastify').FastifyReply,
  ): Promise<{ id: string; owner_id: string } | null> {
    const series = await fastify.prisma.tournamentSeries.findFirst({
      where: { slug, deleted_at: null },
      select: { id: true, owner_id: true },
    });
    if (!series) {
      reply.code(404).send({ error: 'NotFound', message: 'Series not found', statusCode: 404 });
      return null;
    }
    const isOwner = series.owner_id === userId;
    const isModOrAdmin = role === 'MODERATOR' || role === 'ADMIN';
    if (!isOwner && !isModOrAdmin) {
      reply.code(403).send({ error: 'Forbidden', message: 'Only the series owner can manage co-hosts', statusCode: 403 });
      return null;
    }
    return series;
  }

  // PATCH /api/series/:slug/transfer-owner
  fastify.patch<{ Params: { slug: string }; Body: { new_owner_id: string } }>(
    '/api/series/:slug/transfer-owner',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['new_owner_id'],
          properties: { new_owner_id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { slug } = request.params;
      const { new_owner_id } = request.body;
      const { sub: userId, role } = request.user;

      const series = await fastify.prisma.tournamentSeries.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, owner_id: true },
      });
      if (!series) {
        return reply.code(404).send({ error: 'NotFound', message: 'Series not found', statusCode: 404 });
      }

      const isOwner = series.owner_id === userId;
      const isModOrAdmin = role === 'MODERATOR' || role === 'ADMIN';
      if (!isOwner && !isModOrAdmin) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the series owner, moderators, or admins can transfer ownership', statusCode: 403 });
      }

      const targetUser = await fastify.prisma.user.findUnique({
        where: { id: new_owner_id },
        select: { id: true, role: true, deleted_at: true },
      });
      if (!targetUser || targetUser.deleted_at) {
        return reply.code(404).send({ error: 'NotFound', message: 'Target user not found', statusCode: 404 });
      }
      if (targetUser.role !== 'HOST' && targetUser.role !== 'ADMIN') {
        return reply.code(400).send({ error: 'BadRequest', message: 'New owner must have HOST or ADMIN role', statusCode: 400 });
      }

      await fastify.prisma.tournamentSeries.update({
        where: { id: series.id },
        data: { owner_id: new_owner_id },
      });

      await invalidateSeries(slug);

      return reply.send({ ok: true });
    },
  );

  // GET /api/series/:slug/co-hosts — any authenticated user may view the roster
  fastify.get<{ Params: { slug: string } }>(
    '/api/series/:slug/co-hosts',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const series = await fastify.prisma.tournamentSeries.findFirst({
        where: { slug: request.params.slug, deleted_at: null },
        select: { id: true },
      });
      if (!series) {
        return reply.code(404).send({ error: 'NotFound', message: 'Series not found', statusCode: 404 });
      }
      const hosts = await fastify.prisma.tournamentSeriesHost.findMany({
        where: { series_id: series.id },
        select: { user: { select: { id: true, username: true, avatar_url: true } } },
        orderBy: { user: { username: 'asc' } },
      });
      return reply.send(hosts.map((h) => h.user));
    },
  );

  // GET /api/series/:slug/co-host-candidates?q= — owner + mod/admin
  fastify.get<{ Params: { slug: string }; Querystring: { q?: string } }>(
    '/api/series/:slug/co-host-candidates',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sub: userId, role } = request.user;
      const series = await loadSeriesForRoster(request.params.slug, userId, role, reply);
      if (!series) return;
      const q = (request.query.q ?? '').trim();
      if (q.length < 2) return reply.send([]);
      const existing = await fastify.prisma.tournamentSeriesHost.findMany({
        where: { series_id: series.id },
        select: { user_id: true },
      });
      const excludeIds = [series.owner_id, ...existing.map((h) => h.user_id)];
      const users = await fastify.prisma.user.findMany({
        where: {
          deleted_at: null,
          id: { notIn: excludeIds },
          username: { contains: q, mode: 'insensitive' },
        },
        select: { id: true, username: true, avatar_url: true },
        orderBy: { username: 'asc' },
        take: 10,
      });
      return reply.send(users);
    },
  );

  // POST /api/series/:slug/co-hosts — owner + mod/admin
  fastify.post<{ Params: { slug: string }; Body: { user_id: string } }>(
    '/api/series/:slug/co-hosts',
    {
      preHandler: [fastify.authenticate],
      schema: {
        body: {
          type: 'object',
          required: ['user_id'],
          properties: { user_id: { type: 'string', format: 'uuid' } },
        },
      },
    },
    async (request, reply) => {
      const { sub: userId, role } = request.user;
      const series = await loadSeriesForRoster(request.params.slug, userId, role, reply);
      if (!series) return;
      const { user_id } = request.body;
      if (user_id === series.owner_id) {
        return reply.code(400).send({ error: 'BadRequest', message: 'The owner is already a host', statusCode: 400 });
      }
      const target = await fastify.prisma.user.findUnique({
        where: { id: user_id },
        select: { id: true, deleted_at: true, username: true, avatar_url: true },
      });
      if (!target || target.deleted_at) {
        return reply.code(404).send({ error: 'NotFound', message: 'User not found', statusCode: 404 });
      }
      await fastify.prisma.tournamentSeriesHost.upsert({
        where: { series_id_user_id: { series_id: series.id, user_id } },
        create: { series_id: series.id, user_id },
        update: {},
      });

      await invalidateSeries(request.params.slug);

      return reply.send({ id: target.id, username: target.username, avatar_url: target.avatar_url });
    },
  );

  // DELETE /api/series/:slug/co-hosts/:userId — owner + mod/admin
  fastify.delete<{ Params: { slug: string; userId: string } }>(
    '/api/series/:slug/co-hosts/:userId',
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const { sub: userId, role } = request.user;
      const series = await loadSeriesForRoster(request.params.slug, userId, role, reply);
      if (!series) return;
      await fastify.prisma.tournamentSeriesHost.deleteMany({
        where: { series_id: series.id, user_id: request.params.userId },
      });

      await invalidateSeries(request.params.slug);

      return reply.send({ ok: true });
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/series/:slug/poster — upload a poster image
  // Mirrors tournament-poster.ts exactly; uses the same POSTER_DIR with a
  // sub-folder keyed on series id.
  // -------------------------------------------------------------------------

  // Best-effort pre-create; per-request handler re-creates anyway.
  await mkdir(POSTER_DIR, { recursive: true }).catch((err) => {
    fastify.log.warn({ err, dir: POSTER_DIR }, 'Could not pre-create poster upload dir');
  });

  fastify.post(
    '/api/series/:slug/poster',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const series = await fastify.prisma.tournamentSeries.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true },
      });
      if (!series) {
        return reply.code(404).send({ error: 'NotFound', message: 'Series not found', statusCode: 404 });
      }
      if (!(await canManageSeries(fastify.prisma, series.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the owner or an admin can set the poster', statusCode: 403 });
      }

      const data = await request.file();
      if (!data) {
        return reply.code(400).send({ error: 'BadRequest', message: 'No file uploaded', statusCode: 400 });
      }
      const ext = EXT_BY_MIME[data.mimetype];
      if (!ext) {
        return reply.code(415).send({ error: 'UnsupportedMediaType', message: 'Only PNG, JPEG, WebP or AVIF images are supported', statusCode: 415 });
      }
      const buffer = await data.toBuffer();
      if (data.file.truncated) {
        return reply.code(413).send({ error: 'PayloadTooLarge', message: 'Image exceeds the 5 MB limit', statusCode: 413 });
      }
      if (buffer.length === 0) {
        return reply.code(400).send({ error: 'BadRequest', message: 'Empty file', statusCode: 400 });
      }

      const dir = join(POSTER_DIR, series.id);
      await mkdir(dir, { recursive: true });
      const filename = `${randomUUID()}.${ext}`;
      await writeFile(join(dir, filename), buffer);

      const posterUrl = `/uploads/posters/${series.id}/${filename}`;
      await fastify.prisma.tournamentSeries.update({
        where: { id: series.id },
        data: { poster_url: posterUrl },
      });

      await invalidateSeries(slug);

      return reply.code(200).send({ poster_url: posterUrl });
    },
  );
};

export default seriesRoutes;
