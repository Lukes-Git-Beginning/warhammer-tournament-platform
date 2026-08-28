import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { emitParticipantChange, emitBracketUpdate } from '../lib/emit.js';
import { canManageTournament, createLateJoinerBye } from '../lib/tournament-utils.js';
import { notifyHostsOfWithdrawal, notifyHostsLateJoinRequest, notifyLateJoinDecision, notifyOpponentOfWithdrawal } from '../lib/discord-notify.js';
import { addLateParticipant, setParticipantFactionOp } from '../lib/tournament-management.js';
import { reapplyDynamicSizing } from '../lib/auto-swiss-service.js';
import { admitBalancedLateJoiner } from '../lib/balanced-liechtenstein-service.js';
import { getPlayerClassification } from '../lib/skill-classification-service.js';
import { BAND_NAMES } from '../lib/skill-classification.js';
import { effectiveTiersOf, SUPPORTER_FLAG_SELECT } from '../lib/supporter-service.js';
import { recordTournamentEvent } from '../lib/tournament-events.js';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const RegisterSchema = z.object({
  faction_id: z.string().min(1).optional(),
  faction_ids: z.array(z.string().min(1)).optional(), // TWO_D_THREE: exactly 3 distinct
  // BALANCED_LIECHTENSTEIN: the division the player opts into (play-up). Never
  // takes effect below their computed band — the effective band is max(computed,
  // requested) at Start — so a too-low value here is simply ignored.
  requested_band: z.number().int().min(1).max(5).optional(),
});

const CheckinSchema = z.object({
  user_id: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const participantRoutes: FastifyPluginAsync = async (fastify) => {
  // POST /api/tournaments/:slug/register
  fastify.post(
    '/api/tournaments/:slug/register',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const parsed = RegisterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: {
          id: true,
          status: true,
          mode: true,
          start_date: true,
          max_participants: true,
          min_band: true,
          max_band: true,
          faction_allowlist: { select: { faction_id: true } },
          restricted_factions: { select: { faction_id: true } },
          _count: {
            select: {
              participants: {
                where: {
                  status: { in: ['REGISTERED', 'CHECKED_IN'] },
                  deleted_at: null,
                },
              },
            },
          },
        },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      if (tournament.status !== 'OPEN_REGISTRATION') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament is not currently accepting registrations',
          statusCode: 422,
        });
      }

      if (
        tournament.max_participants !== null &&
        tournament.max_participants !== undefined &&
        tournament._count.participants >= tournament.max_participants
      ) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Tournament is full',
          statusCode: 422,
        });
      }

      // NI-5: skill-gate — a host may restrict registration to a skill-band range. Unrated
      // players must calibrate first (CalibrationRequired → the client opens the questionnaire).
      // Uses the competition band (matchmakingBand — the value shown on the player's profile),
      // so what a player sees IS what decides which gated tournaments they can enter. A strong
      // player who out-performs their questionnaire is gated up quickly (soft-floor climb).
      if (tournament.min_band != null || tournament.max_band != null) {
        const season = await fastify.prisma.season.findFirst({ where: { is_active: true }, select: { id: true } });
        if (season) {
          const classification = await getPlayerClassification(fastify.prisma, fastify.redis, season.id, request.user.sub);
          if (!classification.rated) {
            return reply.code(422).send({ error: 'CalibrationRequired', message: 'Complete your skill calibration before registering for this tournament.', statusCode: 422 });
          }
          const band = classification.matchmakingBand;
          if (tournament.min_band != null && band < tournament.min_band) {
            return reply.code(422).send({ error: 'UnprocessableEntity', message: `This tournament requires at least ${BAND_NAMES[tournament.min_band]!} — your skill band is ${BAND_NAMES[band]!}.`, statusCode: 422 });
          }
          if (tournament.max_band != null && band > tournament.max_band) {
            return reply.code(422).send({ error: 'UnprocessableEntity', message: `This tournament is capped at ${BAND_NAMES[tournament.max_band]!} — your skill band is ${BAND_NAMES[band]!}.`, statusCode: 422 });
          }
        }
      }

      // Validate faction if provided
      if (parsed.data.faction_id) {
        const faction = await fastify.prisma.faction.findUnique({
          where: { id: parsed.data.faction_id },
          select: { id: true },
        });
        if (!faction) {
          return reply.code(400).send({ error: 'BadRequest', message: `Faction "${parsed.data.faction_id}" does not exist`, statusCode: 400 });
        }
        const allowlist = tournament.faction_allowlist.map((f) => f.faction_id);
        if (allowlist.length > 0 && !allowlist.includes(parsed.data.faction_id)) {
          return reply.code(400).send({ error: 'BadRequest', message: 'Faction is not permitted in this tournament', statusCode: 400 });
        }
        // Restricted factions are intentionally pickable — they are nerfed, not
        // banned. Games involving them are excluded from the leaderboard at match
        // completion (see lib/match-games.ts), never blocked at pick time.

        // FACTION_WAR: a faction is globally exclusive — reject if another active
        // participant already claimed it. The current user is excluded so a WITHDREW →
        // re-register (to change faction) still works.
        if (tournament.mode === 'FACTION_WAR') {
          const claimed = await fastify.prisma.tournamentParticipant.findFirst({
            where: {
              tournament_id: tournament.id,
              faction_id: parsed.data.faction_id,
              status: { in: ['REGISTERED', 'CHECKED_IN'] },
              deleted_at: null,
              NOT: { user_id: request.user.sub },
            },
            select: { id: true },
          });
          if (claimed) {
            return reply.code(409).send({
              error: 'Conflict',
              message: 'This faction has already been claimed by another player in this tournament',
              statusCode: 409,
            });
          }
        }
      }

      // 2D3 mode: player picks exactly 3 distinct factions; one is drawn at random
      // per game (see lib/match-games.ts drawTwoD3GameFactions).
      let factionIds: string[] = [];
      if (tournament.mode === 'TWO_D_THREE') {
        factionIds = parsed.data.faction_ids ?? [];
        if (factionIds.length !== 3 || new Set(factionIds).size !== 3) {
          return reply.code(400).send({ error: 'BadRequest', message: 'This mode requires exactly 3 distinct factions', statusCode: 400 });
        }
        const found = await fastify.prisma.faction.findMany({
          where: { id: { in: factionIds } },
          select: { id: true },
        });
        if (found.length !== 3) {
          return reply.code(400).send({ error: 'BadRequest', message: 'One or more selected factions do not exist', statusCode: 400 });
        }
        const allowlist = tournament.faction_allowlist.map((f) => f.faction_id);
        if (allowlist.length > 0 && factionIds.some((id) => !allowlist.includes(id))) {
          return reply.code(400).send({ error: 'BadRequest', message: 'One or more selected factions are not permitted in this tournament', statusCode: 400 });
        }
        // Restricted factions stay pickable (nerfed, not banned) — same as faction_id above.
      }

      // B5: registering during the check-in window [start-1h, start) auto-checks-in.
      const now = new Date();
      const startMs = tournament.start_date.getTime();
      const checkInOpen = now.getTime() >= startMs - 3_600_000 && now.getTime() < startMs;
      const initialStatus: 'CHECKED_IN' | 'REGISTERED' = checkInOpen ? 'CHECKED_IN' : 'REGISTERED';

      const participantData = {
        faction_id: parsed.data.faction_id ?? null,
        faction_ids: factionIds,
        status: initialStatus,
        requested_band: parsed.data.requested_band ?? null,
      };
      const participantSelect = {
        id: true,
        tournament_id: true,
        user_id: true,
        faction_id: true,
        faction_ids: true,
        status: true,
        registered_at: true,
      } as const;

      // B15: a player who withdrew before start can re-register — reactivate the
      // existing row instead of failing on the (tournament_id, user_id) unique key.
      const existing = await fastify.prisma.tournamentParticipant.findFirst({
        where: { tournament_id: tournament.id, user_id: request.user.sub },
        select: { id: true, status: true },
      });
      if (existing && existing.status !== 'WITHDREW') {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'You are already registered for this tournament',
          statusCode: 409,
        });
      }

      try {
        const participant = existing
          ? await fastify.prisma.tournamentParticipant.update({
              where: { id: existing.id },
              data: { ...participantData, registered_at: now },
              select: participantSelect,
            })
          : await fastify.prisma.tournamentParticipant.create({
              data: { tournament_id: tournament.id, user_id: request.user.sub, ...participantData },
              select: participantSelect,
            });

        await fastify.prisma.auditLog.create({
          data: {
            entity_type: 'TournamentParticipant',
            entity_id: participant.id,
            action: existing ? 're-register' : 'register',
            actor_id: request.user.sub,
            new_value: { tournament_id: tournament.id, user_id: request.user.sub, status: initialStatus },
          },
        });

        void recordTournamentEvent({
          tournamentId: tournament.id,
          type: 'participant_registered',
          actor: 'player',
          actorId: request.user.sub,
          subjectId: request.user.sub,
          payload: { status: initialStatus },
        });

        emitParticipantChange(fastify.io, {
          tournamentId: tournament.id,
          userId: request.user.sub,
          action: 'registered',
        });

        request.log.info({ slug, userId: request.user.sub, status: initialStatus }, 'User registered for tournament');
        return reply.code(201).send(participant);
      } catch (err: unknown) {
        // Prisma unique constraint violation (race)
        if (
          err !== null &&
          typeof err === 'object' &&
          'code' in err &&
          (err as { code: string }).code === 'P2002'
        ) {
          return reply.code(409).send({
            error: 'Conflict',
            message: 'You are already registered for this tournament',
            statusCode: 409,
          });
        }
        throw err;
      }
    },
  );

  // POST /api/tournaments/:slug/request-join
  // Late-join: a user runs the normal registration flow (faction / band / free-pick)
  // AFTER the tournament has started; instead of entering, this records a pending
  // JOIN_REQUESTED row and alerts the host, who approves/declines it. Gated behind
  // the tournament's allow_late_join_requests flag.
  fastify.post(
    '/api/tournaments/:slug/request-join',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const parsed = RegisterSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
      }

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: {
          id: true,
          status: true,
          mode: true,
          allow_late_join_requests: true,
          faction_allowlist: { select: { faction_id: true } },
        },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: `Tournament "${slug}" not found`, statusCode: 404 });
      }
      if (tournament.status !== 'ONGOING' || !tournament.allow_late_join_requests) {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'This tournament is not accepting late-join requests', statusCode: 422 });
      }

      // Validate faction(s), mirroring /register.
      if (parsed.data.faction_id) {
        const faction = await fastify.prisma.faction.findUnique({ where: { id: parsed.data.faction_id }, select: { id: true } });
        if (!faction) return reply.code(400).send({ error: 'BadRequest', message: `Faction "${parsed.data.faction_id}" does not exist`, statusCode: 400 });
        const allowlist = tournament.faction_allowlist.map((f) => f.faction_id);
        if (allowlist.length > 0 && !allowlist.includes(parsed.data.faction_id)) {
          return reply.code(400).send({ error: 'BadRequest', message: 'Faction is not permitted in this tournament', statusCode: 400 });
        }
        if (tournament.mode === 'FACTION_WAR') {
          const claimed = await fastify.prisma.tournamentParticipant.findFirst({
            where: {
              tournament_id: tournament.id,
              faction_id: parsed.data.faction_id,
              status: { in: ['REGISTERED', 'CHECKED_IN'] },
              deleted_at: null,
              NOT: { user_id: request.user.sub },
            },
            select: { id: true },
          });
          if (claimed) {
            return reply.code(409).send({ error: 'Conflict', message: 'This faction has already been claimed by another player in this tournament', statusCode: 409 });
          }
        }
      }
      let factionIds: string[] = [];
      if (tournament.mode === 'TWO_D_THREE') {
        factionIds = parsed.data.faction_ids ?? [];
        if (factionIds.length !== 3 || new Set(factionIds).size !== 3) {
          return reply.code(400).send({ error: 'BadRequest', message: 'This mode requires exactly 3 distinct factions', statusCode: 400 });
        }
        const found = await fastify.prisma.faction.findMany({ where: { id: { in: factionIds } }, select: { id: true } });
        if (found.length !== 3) return reply.code(400).send({ error: 'BadRequest', message: 'One or more selected factions do not exist', statusCode: 400 });
        const allowlist = tournament.faction_allowlist.map((f) => f.faction_id);
        if (allowlist.length > 0 && factionIds.some((id) => !allowlist.includes(id))) {
          return reply.code(400).send({ error: 'BadRequest', message: 'One or more selected factions are not permitted', statusCode: 400 });
        }
      }

      const requestData = {
        faction_id: parsed.data.faction_id ?? null,
        faction_ids: factionIds,
        requested_band: parsed.data.requested_band ?? null,
        status: 'JOIN_REQUESTED' as const,
      };

      const existing = await fastify.prisma.tournamentParticipant.findFirst({
        where: { tournament_id: tournament.id, user_id: request.user.sub },
        select: { id: true, status: true },
      });
      // Already actively in — a re-request (JOIN_REQUESTED) or prior WITHDREW is fine.
      if (existing && existing.status !== 'WITHDREW' && existing.status !== 'JOIN_REQUESTED') {
        return reply.code(409).send({ error: 'Conflict', message: 'You are already part of this tournament', statusCode: 409 });
      }

      const participant = existing
        ? await fastify.prisma.tournamentParticipant.update({ where: { id: existing.id }, data: { ...requestData, registered_at: new Date() }, select: { id: true, status: true } })
        : await fastify.prisma.tournamentParticipant.create({ data: { tournament_id: tournament.id, user_id: request.user.sub, ...requestData }, select: { id: true, status: true } });

      await fastify.prisma.auditLog.create({
        data: { entity_type: 'TournamentParticipant', entity_id: participant.id, action: 'late_join_request', actor_id: request.user.sub, new_value: { tournament_id: tournament.id, user_id: request.user.sub } },
      });
      emitParticipantChange(fastify.io, { tournamentId: tournament.id, userId: request.user.sub, action: 'registered' });
      void notifyHostsLateJoinRequest(tournament.id, request.user.sub);

      return reply.code(201).send(participant);
    },
  );

  // GET /api/tournaments/:slug/join-requests — host-only list of pending late-join requests.
  fastify.get(
    '/api/tournaments/:slug/join-requests',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const tournament = await fastify.prisma.tournament.findFirst({ where: { slug, deleted_at: null }, select: { id: true } });
      if (!tournament) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the host can view join requests', statusCode: 403 });
      }
      const requests = await fastify.prisma.tournamentParticipant.findMany({
        where: { tournament_id: tournament.id, status: 'JOIN_REQUESTED', deleted_at: null },
        orderBy: { registered_at: 'asc' },
        select: {
          user_id: true,
          faction_id: true,
          faction_ids: true,
          requested_band: true,
          registered_at: true,
          user: { select: { id: true, username: true, avatar_url: true } },
        },
      });
      return reply.send({ requests });
    },
  );

  // POST /api/tournaments/:slug/participants/:userId/approve-join — host admits a request.
  fastify.post(
    '/api/tournaments/:slug/participants/:userId/approve-join',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug, userId } = request.params as { slug: string; userId: string };
      const tournament = await fastify.prisma.tournament.findFirst({ where: { slug, deleted_at: null }, select: { id: true, status: true, format: true } });
      if (!tournament) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the host can approve join requests', statusCode: 403 });
      }
      const pending = await fastify.prisma.tournamentParticipant.findFirst({
        where: { tournament_id: tournament.id, user_id: userId, status: 'JOIN_REQUESTED', deleted_at: null },
        select: { id: true, requested_band: true },
      });
      if (!pending) return reply.code(404).send({ error: 'NotFound', message: 'No pending join request for this user', statusCode: 404 });

      // Admit them: CHECKED_IN, and (Balanced Liechtenstein) fix their skill band so
      // the pairing tick can slot them in.
      await fastify.prisma.tournamentParticipant.update({
        where: { id: pending.id },
        data: {
          status: 'CHECKED_IN',
          ...(tournament.format === 'BALANCED_LIECHTENSTEIN' && pending.requested_band != null
            ? { skill_band: pending.requested_band }
            : {}),
        },
      });
      await fastify.prisma.auditLog.create({
        data: { entity_type: 'TournamentParticipant', entity_id: pending.id, action: 'late_join_approved', actor_id: request.user.sub, new_value: { tournament_id: tournament.id, user_id: userId } },
      });

      void recordTournamentEvent({
        tournamentId: tournament.id,
        type: 'participant_late_joined',
        actor: 'host',
        actorId: request.user.sub,
        subjectId: userId,
      });

      // Fold them into the running tournament using the format-correct late-join path.
      if (tournament.status === 'ONGOING') {
        if (tournament.format === 'BALANCED_LIECHTENSTEIN') {
          // BaLi: assign skill band + CATCHUP_BYE placeholders + pairing tick.
          try {
            await admitBalancedLateJoiner(fastify, tournament.id, userId);
          } catch (err) {
            request.log.warn({ err, slug }, 'Failed to admit balanced late joiner on approve');
          }
        } else {
          // Swiss / Auto Swiss: CATCHUP_BYE (0 pts) for the current round.
          try {
            const bye = await createLateJoinerBye(fastify.prisma, tournament.id, userId);
            if (bye) emitBracketUpdate(fastify.io, tournament.id);
          } catch (err) {
            request.log.warn({ err, slug }, 'Failed to create late-joiner CATCHUP_BYE on approve');
          }
        }
      }
      await reapplyDynamicSizing(fastify.prisma, tournament.id);
      emitParticipantChange(fastify.io, { tournamentId: tournament.id, userId, action: 'registered' });
      void notifyLateJoinDecision(tournament.id, userId, true);

      return reply.send({ ok: true });
    },
  );

  // POST /api/tournaments/:slug/participants/:userId/decline-join — host rejects a request.
  fastify.post(
    '/api/tournaments/:slug/participants/:userId/decline-join',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug, userId } = request.params as { slug: string; userId: string };
      const tournament = await fastify.prisma.tournament.findFirst({ where: { slug, deleted_at: null }, select: { id: true } });
      if (!tournament) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the host can decline join requests', statusCode: 403 });
      }
      const pending = await fastify.prisma.tournamentParticipant.findFirst({
        where: { tournament_id: tournament.id, user_id: userId, status: 'JOIN_REQUESTED', deleted_at: null },
        select: { id: true },
      });
      if (!pending) return reply.code(404).send({ error: 'NotFound', message: 'No pending join request for this user', statusCode: 404 });

      // Only a truly never-played request is safe to hard-delete (so the user can ask again).
      // A returning player who withdrew, re-requested and is now declined HAS played — the same
      // row carries their match history (request-join reuses the existing row), so deleting it
      // would orphan their matches: they vanish from the standings and the bracket shows their
      // raw user id. In that case revert the row to WITHDREW instead of deleting it.
      const playedCount = await fastify.prisma.match.count({
        where: {
          tournament_id: tournament.id,
          deleted_at: null,
          status: { in: ['COMPLETED', 'BYE', 'FORFEIT', 'NO_CONTEST', 'CATCHUP_BYE'] },
          OR: [{ player1_id: userId }, { player2_id: userId }],
        },
      });
      if (playedCount > 0) {
        await fastify.prisma.tournamentParticipant.update({ where: { id: pending.id }, data: { status: 'WITHDREW' } });
      } else {
        await fastify.prisma.tournamentParticipant.delete({ where: { id: pending.id } });
      }
      await fastify.prisma.auditLog.create({
        data: { entity_type: 'TournamentParticipant', entity_id: pending.id, action: 'late_join_declined', actor_id: request.user.sub, new_value: { tournament_id: tournament.id, user_id: userId } },
      });
      emitParticipantChange(fastify.io, { tournamentId: tournament.id, userId, action: 'withdrew' });
      void notifyLateJoinDecision(tournament.id, userId, false);

      return reply.send({ ok: true });
    },
  );

  // POST /api/tournaments/:slug/withdraw
  fastify.post(
    '/api/tournaments/:slug/withdraw',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, status: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      // Self-withdraw is only allowed before the tournament starts. Once it is
      // ONGOING/COMPLETED, a player must be dropped by an host (which
      // forfeits open matches and keeps the bracket consistent).
      if (tournament.status === 'ONGOING' || tournament.status === 'COMPLETED') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message:
            'Cannot withdraw once the tournament has started — contact an host to be dropped',
          statusCode: 422,
        });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: {
          tournament_id: tournament.id,
          user_id: request.user.sub,
          deleted_at: null,
        },
        select: { id: true, status: true },
      });

      if (!participant) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'You are not registered for this tournament',
          statusCode: 404,
        });
      }

      if (participant.status === 'WITHDREW') {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'You have already withdrawn from this tournament',
          statusCode: 409,
        });
      }

      await fastify.prisma.tournamentParticipant.update({
        where: { id: participant.id },
        data: { status: 'WITHDREW' },
      });

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'TournamentParticipant',
          entity_id: participant.id,
          action: 'withdraw',
          actor_id: request.user.sub,
          old_value: { status: participant.status },
          new_value: { status: 'WITHDREW' },
        },
      });

      void recordTournamentEvent({
        tournamentId: tournament.id,
        type: 'participant_withdrew',
        actor: 'player',
        actorId: request.user.sub,
        subjectId: request.user.sub,
      });

      emitParticipantChange(fastify.io, {
        tournamentId: tournament.id,
        userId: request.user.sub,
        action: 'withdrew',
      });

      request.log.info({ slug, userId: request.user.sub }, 'User withdrew from tournament');
      return reply.code(200).send({ message: 'Withdrawal successful' });
    },
  );

  // POST /api/tournaments/:slug/checkin
  fastify.post(
    '/api/tournaments/:slug/checkin',
    { preHandler: [fastify.authenticate, fastify.requireRole('HOST', 'MODERATOR', 'ADMIN')] },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const parsed = CheckinSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: parsed.error.message,
          statusCode: 400,
        });
      }

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, host_id: true, format: true, status: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      // Host check: if role is HOST, must own the tournament (or be a co-host)
      const user = request.user;
      if (!(await canManageTournament(fastify.prisma, tournament.id, user.sub, user.role))) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You do not have permission to check in participants for this tournament',
          statusCode: 403,
        });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: {
          tournament_id: tournament.id,
          user_id: parsed.data.user_id,
          deleted_at: null,
        },
        select: { id: true, status: true },
      });

      if (!participant) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Participant not found for this tournament',
          statusCode: 404,
        });
      }

      if (participant.status === 'CHECKED_IN') {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'Participant is already checked in',
          statusCode: 409,
        });
      }

      if (participant.status === 'DISQUALIFIED' || participant.status === 'WITHDREW') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Cannot check in a participant with status ${participant.status}`,
          statusCode: 422,
        });
      }

      await fastify.prisma.tournamentParticipant.update({
        where: { id: participant.id },
        data: { status: 'CHECKED_IN' },
      });

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'TournamentParticipant',
          entity_id: participant.id,
          action: 'checkin',
          actor_id: user.sub,
          old_value: { status: participant.status },
          new_value: { status: 'CHECKED_IN' },
        },
      });

      void recordTournamentEvent({
        tournamentId: tournament.id,
        type: 'participant_checked_in',
        actor: 'host',
        actorId: user.sub,
        subjectId: parsed.data.user_id,
      });

      emitParticipantChange(fastify.io, {
        tournamentId: tournament.id,
        userId: parsed.data.user_id,
        action: 'checked_in',
      });

      // If checked in after the bracket already started, fold the late joiner in.
      // Balanced Liechtenstein is admitted exactly like a late JOIN — assign the
      // skill band, backfill 0-point CATCHUP_BYE placeholders, run the pairing tick
      // (createLateJoinerBye is a no-op for BaLi, which would otherwise leave the
      // player at round-1 depth with no catch-up handling). Non-fatal.
      try {
        if (tournament.format === 'BALANCED_LIECHTENSTEIN' && tournament.status === 'ONGOING') {
          await admitBalancedLateJoiner(fastify, tournament.id, parsed.data.user_id);
          emitBracketUpdate(fastify.io, tournament.id);
        } else {
          const bye = await createLateJoinerBye(fastify.prisma, tournament.id, parsed.data.user_id);
          if (bye) emitBracketUpdate(fastify.io, tournament.id);
        }
      } catch (err) {
        request.log.warn({ err, slug }, 'Failed to fold in late check-in');
      }

      // #40: a late join grows the active pool — re-size the auto-sized bracket live.
      if (await reapplyDynamicSizing(fastify.prisma, tournament.id)) {
        emitBracketUpdate(fastify.io, tournament.id);
      }

      request.log.info({ slug, targetUserId: parsed.data.user_id }, 'Participant checked in');
      return reply.code(200).send({ message: 'Check-in successful' });
    },
  );

  // POST /api/tournaments/:slug/checkin/self
  // Self-service check-in: open when start_date - 1h <= now < start_date.
  // Uses audit-log to track when check-in window was first opened (no schema change needed).
  fastify.post(
    '/api/tournaments/:slug/checkin/self',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, start_date: true, status: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      if (tournament.status === 'ONGOING' || tournament.status === 'COMPLETED') {
        return reply.code(409).send({
          error: 'Conflict',
          code: 'TOURNAMENT_ALREADY_STARTED',
          message: 'Tournament has already started — check-in is no longer available',
          statusCode: 409,
        });
      }

      const now = new Date();
      const oneHourBefore = new Date(tournament.start_date.getTime() - 60 * 60 * 1000);

      // Check-in window: [start_date - 1h, start_date)
      const checkinOpen = now >= oneHourBefore && now < tournament.start_date;

      if (!checkinOpen) {
        return reply.code(409).send({
          error: 'Conflict',
          code: 'CHECKIN_NOT_OPEN',
          message: 'Check-in is not currently open for this tournament',
          statusCode: 409,
        });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: {
          tournament_id: tournament.id,
          user_id: request.user.sub,
          deleted_at: null,
        },
        select: { id: true, status: true },
      });

      if (!participant) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'You are not registered for this tournament',
          statusCode: 404,
        });
      }

      if (participant.status === 'CHECKED_IN') {
        return reply.code(409).send({
          error: 'Conflict',
          message: 'You are already checked in',
          statusCode: 409,
        });
      }

      if (participant.status !== 'REGISTERED') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: `Cannot check in with participant status "${participant.status}"`,
          statusCode: 422,
        });
      }

      await fastify.prisma.tournamentParticipant.update({
        where: { id: participant.id },
        data: { status: 'CHECKED_IN' },
      });

      await fastify.prisma.auditLog.create({
        data: {
          entity_type: 'TournamentParticipant',
          entity_id: participant.id,
          action: 'self_checkin',
          actor_id: request.user.sub,
          old_value: { status: participant.status },
          new_value: { status: 'CHECKED_IN' },
        },
      });

      void recordTournamentEvent({
        tournamentId: tournament.id,
        type: 'participant_checked_in',
        actor: 'player',
        actorId: request.user.sub,
        subjectId: request.user.sub,
      });

      emitParticipantChange(fastify.io, {
        tournamentId: tournament.id,
        userId: request.user.sub,
        action: 'checked_in',
      });

      request.log.info({ slug, userId: request.user.sub }, 'User self-checked-in');
      return reply.code(200).send({ message: 'Check-in successful' });
    },
  );

  // ---------------------------------------------------------------------------
  // GET /api/tournaments/:slug/participants/me
  // Auth-required — returns the current user's participant status for a tournament.
  // ---------------------------------------------------------------------------
  fastify.get(
    '/api/tournaments/:slug/participants/me',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: {
          tournament_id: tournament.id,
          user_id: request.user.sub,
          deleted_at: null,
        },
        select: {
          status: true,
          registered_at: true,
          faction_id: true,
          lists_locked_at: true,
        },
      });

      if (!participant) {
        // Not registered — return null status (not an error)
        return reply.code(200).send({ status: null });
      }

      return reply.code(200).send({
        status: participant.status,
        registered_at: participant.registered_at,
        faction_id: participant.faction_id ?? null,
        checked_in_at: participant.status === 'CHECKED_IN' ? participant.lists_locked_at : null,
      });
    },
  );

  // GET /api/tournaments/:slug/participants
  fastify.get('/api/tournaments/:slug/participants', async (request, reply) => {
    const { slug } = request.params as { slug: string };

    const tournament = await fastify.prisma.tournament.findFirst({
      where: { slug, deleted_at: null },
      select: { id: true, mode: true, status: true },
    });

    if (!tournament) {
      return reply.code(404).send({
        error: 'NotFound',
        message: `Tournament "${slug}" not found`,
        statusCode: 404,
      });
    }

    // Optional auth: a host/co-host/moderator/admin may review the committed factions
    // and chosen divisions before the tournament starts. Everyone else stays masked.
    let privileged = false;
    try {
      await request.jwtVerify();
      privileged = await canManageTournament(
        fastify.prisma,
        tournament.id,
        request.user.sub,
        request.user.role,
      );
    } catch {
      /* unauthenticated viewer — privileged stays false */
    }

    const participants = await fastify.prisma.tournamentParticipant.findMany({
      where: { tournament_id: tournament.id, deleted_at: null },
      select: {
        id: true,
        status: true,
        registered_at: true,
        lists_locked_at: true,
        user: { select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT } },
        faction: { select: { id: true, name: true, color_hex: true } },
        faction_ids: true, // TWO_D_THREE: the player's 3-faction pool
        requested_band: true, // BALANCED_LIECHTENSTEIN: the division the player opted into
        skill_band: true, // BALANCED_LIECHTENSTEIN: effective division (set at start)
      },
      orderBy: { registered_at: 'asc' },
    });

    const started = tournament.status === 'ONGOING' || tournament.status === 'COMPLETED';
    // Hide committed factions until the tournament starts so nobody can counter-pick
    // during registration. FREE_PICK is included: a committed Free Pick faction is a
    // strategic choice that must stay secret while others are still choosing (like SFT).
    // A manager is exempt — they may review the roster's committed factions ahead of start.
    const hideFactions =
      !privileged &&
      !started &&
      (tournament.mode === 'SFT' ||
        tournament.mode === 'BPT' ||
        tournament.mode === 'TWO_D_THREE' ||
        tournament.mode === 'FREE_PICK' ||
        tournament.mode === 'FACTION_WAR');

    // The chosen division is roster info a host needs before start; it becomes public
    // once the tournament starts (the standings already group players by band).
    const showBands = privileged || started;

    const data = participants.map((p) => ({
      ...p,
      user: {
        id: p.user.id,
        username: p.user.username,
        avatar_url: p.user.avatar_url,
        tiers: effectiveTiersOf(p.user),
      },
      faction: hideFactions ? null : p.faction,
      faction_ids: hideFactions ? [] : p.faction_ids,
      requested_band: showBands ? p.requested_band : null,
      skill_band: showBands ? p.skill_band : null,
    }));

    return { data, total: data.length };
  });

  // GET /api/tournaments/:slug/taken-factions
  // Public: the faction IDs already claimed by an active participant in a FACTION_WAR
  // tournament, so the registration picker can grey them out. Returns IDs only (never
  // player names), so it leaks nothing about WHO picked what — only WHICH are gone.
  fastify.get('/api/tournaments/:slug/taken-factions', async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const tournament = await fastify.prisma.tournament.findUnique({
      where: { slug, deleted_at: null },
      select: { id: true, mode: true },
    });
    if (!tournament) {
      return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
    }
    if (tournament.mode !== 'FACTION_WAR') return { takenFactionIds: [] };
    const rows = await fastify.prisma.tournamentParticipant.findMany({
      where: {
        tournament_id: tournament.id,
        status: { in: ['REGISTERED', 'CHECKED_IN'] },
        deleted_at: null,
        faction_id: { not: null },
      },
      select: { faction_id: true },
    });
    return {
      takenFactionIds: rows.map((r) => r.faction_id).filter((id): id is string => id !== null),
    };
  });

  // ---------------------------------------------------------------------------
  // Host-accessible operative actions (B12) — canManage-gated mirrors of the
  // ADMIN-scoped /api/admin/tournaments/:slug/* routes, so hosts and co-hosts
  // (not just global admins) can run them. Shared logic in tournament-management.
  // ---------------------------------------------------------------------------

  // POST /api/tournaments/:slug/add-late — add a participant after registration closed
  fastify.post(
    '/api/tournaments/:slug/add-late',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const t = await fastify.prisma.tournament.findFirst({ where: { slug, deleted_at: null }, select: { id: true } });
      if (!t) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      if (!(await canManageTournament(fastify.prisma, t.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not your tournament', statusCode: 403 });
      }
      const r = await addLateParticipant(fastify.prisma, fastify.io, slug, request.body, request.log, fastify);
      // #40: a host-added late participant grows the active pool — re-size live.
      if (r.status < 300 && (await reapplyDynamicSizing(fastify.prisma, t.id))) {
        emitBracketUpdate(fastify.io, t.id);
      }
      return reply.code(r.status).send(r.body);
    },
  );

  // PATCH /api/tournaments/:slug/participants/:userId/faction — set a participant's faction
  fastify.patch(
    '/api/tournaments/:slug/participants/:userId/faction',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug, userId } = request.params as { slug: string; userId: string };
      const t = await fastify.prisma.tournament.findFirst({ where: { slug, deleted_at: null }, select: { id: true } });
      if (!t) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      if (!(await canManageTournament(fastify.prisma, t.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not your tournament', statusCode: 403 });
      }
      const r = await setParticipantFactionOp(fastify.prisma, slug, userId, request.body);
      return reply.code(r.status).send(r.body);
    },
  );

  // ---------------------------------------------------------------------------
  // DELETE /api/tournaments/:slug/participants/:userId
  // #30b: host/mod/admin fully REMOVE a participant pre-start (as if they never
  // registered) — frees them to sign up fresh. Only before the tournament starts,
  // to protect played results; during/after, use drop (WITHDREW) instead.
  fastify.delete(
    '/api/tournaments/:slug/participants/:userId',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug, userId } = request.params as { slug: string; userId: string };
      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, status: true },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      }
      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the host can remove participants', statusCode: 403 });
      }
      if (tournament.status === 'ONGOING' || tournament.status === 'COMPLETED') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Participants can only be removed before the tournament starts — use drop instead', statusCode: 422 });
      }
      const existing = await fastify.prisma.tournamentParticipant.findFirst({
        where: { tournament_id: tournament.id, user_id: userId },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({ error: 'NotFound', message: 'Participant not found', statusCode: 404 });
      }
      await fastify.prisma.tournamentParticipant.delete({ where: { id: existing.id } });
      await fastify.prisma.auditLog.create({
        data: { entity_type: 'TournamentParticipant', entity_id: existing.id, action: 'participant_removed', actor_id: request.user.sub, new_value: { tournament_id: tournament.id, user_id: userId } },
      });
      emitParticipantChange(fastify.io, { tournamentId: tournament.id, userId, action: 'withdrew' });
      return reply.send({ ok: true });
    },
  );

  // POST /api/tournaments/:slug/participants/:userId/drop
  // Drop a participant. Callable by the player themselves OR by host/moderator/
  // admin, at any point before the tournament completes — including pre-start, so
  // a host can remove a player who can't self-drop before the bracket is built
  // (#41/#30b). Sets status WITHDREW; ONGOING match handling is unchanged.
  // ---------------------------------------------------------------------------
  fastify.post(
    '/api/tournaments/:slug/participants/:userId/drop',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug, userId } = request.params as { slug: string; userId: string };
      const callerId = request.user.sub;
      const callerRole = request.user.role;

      const isSelf = callerId === userId;
      const isStaff = callerRole === 'HOST' || callerRole === 'MODERATOR' || callerRole === 'ADMIN';

      if (!isSelf && !isStaff) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not authorised to drop this participant', statusCode: 403 });
      }

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, status: true, host_id: true },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      }
      if (tournament.status === 'COMPLETED') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Cannot drop participants from a completed tournament', statusCode: 422 });
      }
      if (!isSelf && !(await canManageTournament(fastify.prisma, tournament.id, callerId, callerRole))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Not your tournament', statusCode: 403 });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: { tournament_id: tournament.id, user_id: userId, deleted_at: null },
      });
      if (!participant) {
        return reply.code(404).send({ error: 'NotFound', message: 'Participant not found', statusCode: 404 });
      }
      if (participant.status === 'DISQUALIFIED') {
        return reply.code(409).send({ error: 'Conflict', message: 'Participant has already been dropped', statusCode: 409 });
      }
      if (participant.status === 'WITHDREW') {
        return reply.code(409).send({ error: 'Conflict', message: 'Participant has already withdrawn', statusCode: 409 });
      }

      await fastify.prisma.$transaction(async (tx) => {
        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: { status: 'WITHDREW' },
        });

        await tx.auditLog.create({
          data: {
            entity_type: 'Tournament',
            entity_id: tournament.id,
            action: 'participant_drop',
            actor_id: callerId,
            new_value: { userId, isSelf },
          },
        });
      });

      void recordTournamentEvent({
        tournamentId: tournament.id,
        type: 'participant_dropped',
        actor: isSelf ? 'player' : 'host',
        actorId: callerId,
        subjectId: userId,
      });

      emitParticipantChange(fastify.io, { tournamentId: tournament.id, userId, action: 'withdrew' });

      // B20: let the host(s) know a player dropped — excluding the actor.
      void notifyHostsOfWithdrawal(tournament.id, userId, callerId);

      // Mark any open unreported group matches of the dropped player so the
      // survivor can decide: played → report normally, not played → void.
      // Format-agnostic: applies to BaLi + Swiss + Auto Swiss group matches.
      try {
        const OPEN_FOR_VOID = ['PENDING', 'ONGOING', 'AWAITING_CONFIRMATION', 'DISPUTED'] as const;
        const openMatches = await fastify.prisma.match.findMany({
          where: {
            tournament_id: tournament.id,
            deleted_at: null,
            status: { in: [...OPEN_FOR_VOID] },
            // No game has a reported or confirmed winner yet.
            games: { none: { reported_winner_id: { not: null } } },
            // Every open match of the dropped player — group (phase null / SWISS) AND
            // playoff (PLAYOFF_*). Previously this filtered to group phase only, so a
            // playoff-phase drop silently skipped the opponent (no DM, no game-tile banner).
            // Playoff matches resolve as a walkover when the survivor acts (see void-dropped).
            OR: [{ player1_id: userId }, { player2_id: userId }],
          },
          select: {
            id: true,
            player1_id: true,
            player2_id: true,
          },
        });

        for (const m of openMatches) {
          const survivorId = m.player1_id === userId ? m.player2_id : m.player1_id;

          // Check if the other player is also WITHDREW.
          const survivorStatus = survivorId
            ? await fastify.prisma.tournamentParticipant.findFirst({
                where: { tournament_id: tournament.id, user_id: survivorId, deleted_at: null },
                select: { status: true },
              })
            : null;

          if (!survivorId || survivorStatus?.status === 'WITHDREW') {
            // Double-drop: cancel the match outright.
            await fastify.prisma.match.update({
              where: { id: m.id },
              data: { status: 'CANCELLED', winner_id: null },
            });
          } else {
            // Mark so the UI can show the "opponent withdrew" banner.
            await fastify.prisma.match.update({
              where: { id: m.id },
              data: { withdrawn_player_id: userId },
            });
            void notifyOpponentOfWithdrawal(m.id, survivorId);
          }
        }

        if (openMatches.length > 0) {
          emitBracketUpdate(fastify.io, tournament.id);
        }
      } catch (err) {
        request.log.warn({ err, userId, tournamentId: tournament.id }, 'Failed to void open matches after drop (non-fatal)');
      }

      // #40: a drop shrinks the active pool — re-size the auto-sized bracket live.
      if (await reapplyDynamicSizing(fastify.prisma, tournament.id)) {
        emitBracketUpdate(fastify.io, tournament.id);
      }

      return reply.code(200).send({ dropped: true });
    },
  );

  // ---------------------------------------------------------------------------
  // POST /api/tournaments/:slug/participants/:userId/undrop
  // Restore a WITHDREW participant to CHECKED_IN and reset any never-played
  // playoff matches that were forfeited/cancelled solely because of the drop.
  // Swiss FORFEIT rows and already-played matches are left untouched.
  // ---------------------------------------------------------------------------
  fastify.post(
    '/api/tournaments/:slug/participants/:userId/undrop',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug, userId } = request.params as { slug: string; userId: string };
      const currentUserId = request.user?.sub;
      const role = request.user?.role;

      const tournament = await fastify.prisma.tournament.findUnique({
        where: { slug, deleted_at: null },
        select: { id: true, status: true, host_id: true, format: true },
      });
      if (!tournament) return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      // N13: undrop must also work before the tournament starts (a player can
      // self-withdraw during registration). Pre-start there are no matches to
      // restore, so the playoff-reset below is simply a no-op.
      if (tournament.status !== 'ONGOING' && tournament.status !== 'REGISTRATION_CLOSED') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Tournament must be ongoing or registration-closed to undrop', statusCode: 422 });
      }

      if (!(await canManageTournament(fastify.prisma, tournament.id, currentUserId ?? '', role ?? ''))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Insufficient permissions', statusCode: 403 });
      }

      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: { tournament_id: tournament.id, user_id: userId, deleted_at: null },
        select: { id: true, status: true },
      });
      if (!participant) return reply.code(404).send({ error: 'NotFound', message: 'Participant not found', statusCode: 404 });
      if (participant.status === 'DISQUALIFIED') {
        return reply.code(422).send({ error: 'UnprocessableEntity', message: 'Cannot undrop a disqualified player', statusCode: 422 });
      }

      // Reset any never-played playoff matches that were only forfeited/cancelled
      // because of the drop. Without this the SF rows stay FORFEIT/CANCELLED
      // (showing the player as OUT) and advance-playoffs would propagate phantom
      // players into the GF / third-place node. Conservative scope: playoff phase,
      // winner-less or forfeited, and never actually played. Swiss FORFEIT rows
      // are left untouched (they correctly reflect the missed round in standings).
      const droppedPlayoffMatches = await fastify.prisma.match.findMany({
        where: {
          tournament_id: tournament.id,
          deleted_at: null,
          status: { in: ['FORFEIT', 'CANCELLED'] },
          played_at: null,
          phase: { in: ['PLAYOFF_QF', 'PLAYOFF_SF', 'PLAYOFF_FINAL', 'PLAYOFF_THIRD_PLACE'] },
          OR: [{ player1_id: userId }, { player2_id: userId }],
        },
        select: { id: true },
      });

      await fastify.prisma.$transaction(async (tx) => {
        await tx.tournamentParticipant.update({
          where: { id: participant.id },
          data: { status: 'CHECKED_IN' },
        });
        if (droppedPlayoffMatches.length > 0) {
          await tx.match.updateMany({
            where: { id: { in: droppedPlayoffMatches.map((m) => m.id) } },
            data: {
              status: 'PENDING',
              winner_id: null,
              result: null,
              score: null,
              player1_points: null,
              player2_points: null,
              played_at: null,
            },
          });
        }
        await tx.auditLog.create({
          data: {
            entity_type: 'Tournament',
            entity_id: tournament.id,
            action: 'participant_undrop',
            actor_id: currentUserId,
            new_value: { userId, matchesRestored: droppedPlayoffMatches.length },
          },
        });
      });

      void recordTournamentEvent({
        tournamentId: tournament.id,
        type: 'participant_undropped',
        actor: 'host',
        actorId: currentUserId,
        subjectId: userId,
        payload: { restoredMatches: droppedPlayoffMatches.length },
      });

      emitParticipantChange(fastify.io, { tournamentId: tournament.id, userId, action: 'registered' });
      if (droppedPlayoffMatches.length > 0) {
        emitBracketUpdate(fastify.io, tournament.id);
      }

      // If the group / Swiss phase is still running (no playoffs generated yet), fold the
      // returning player back in exactly like a late join: backfill 0-point CATCHUP_BYE
      // placeholders for the rounds they missed while dropped (the backfill skips rounds they
      // already played) and re-pair them. Once the playoffs exist, the playoff-match restore
      // above is the correct path and this admission must NOT run — admitBalancedLateJoiner
      // would misread the frontier from playoff rounds. Non-fatal.
      if (tournament.status === 'ONGOING') {
        const playoffMatchCount = await fastify.prisma.match.count({
          where: {
            tournament_id: tournament.id,
            deleted_at: null,
            phase: { in: ['PLAYOFF_QF', 'PLAYOFF_SF', 'PLAYOFF_FINAL', 'PLAYOFF_THIRD_PLACE'] },
          },
        });
        if (playoffMatchCount === 0) {
          try {
            if (tournament.format === 'BALANCED_LIECHTENSTEIN') {
              await admitBalancedLateJoiner(fastify, tournament.id, userId);
              emitBracketUpdate(fastify.io, tournament.id);
            } else {
              const bye = await createLateJoinerBye(fastify.prisma, tournament.id, userId);
              if (bye) emitBracketUpdate(fastify.io, tournament.id);
            }
          } catch (err) {
            request.log.warn({ err, slug }, 'Failed to re-admit undropped player into the group phase');
          }
        }
      }

      return reply.code(200).send({ undroped: true, matchesRestored: droppedPlayoffMatches.length });
    },
  );
};

export default participantRoutes;
