import type { FastifyPluginAsync } from 'fastify';
import { DraftNotFoundError } from '../lib/draft-service.js';

// ---------------------------------------------------------------------------
// Route plugin — Draft REST endpoints
// ---------------------------------------------------------------------------

const draftRoutes: FastifyPluginAsync = async (fastify) => {
  // -------------------------------------------------------------------------
  // GET /api/drafts/:id
  // Optional auth — spectator if anonymous, host/guest if player in match.
  // -------------------------------------------------------------------------
  fastify.get('/api/drafts/:id', async (request, reply) => {
    const { id } = request.params as { id: string };

    // Try to verify JWT — silently ignore if missing/invalid (spectator mode).
    try {
      await request.jwtVerify();
    } catch {
      // Anonymous spectator — no-op
    }

    const viewerUserId = (request.user as { sub?: string } | undefined)?.sub ?? null;

    try {
      const view = await fastify.draftService.getDraftView(id, viewerUserId);
      return reply.code(200).send(view);
    } catch (err) {
      if (err instanceof DraftNotFoundError) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Draft "${id}" not found`,
          statusCode: 404,
        });
      }
      throw err;
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/drafts/:id/events
  // Chronological event list, with hidden-masking for spectators.
  // -------------------------------------------------------------------------
  fastify.get('/api/drafts/:id/events', async (request, reply) => {
    const { id: draftId } = request.params as { id: string };

    // Optional auth
    try {
      await request.jwtVerify();
    } catch {
      // spectator
    }

    const viewerUserId = (request.user as { sub?: string } | undefined)?.sub ?? null;

    // Load draft with preset turns to determine viewer role and hidden reveals
    const draft = await fastify.prisma.draft.findUnique({
      where: { id: draftId },
      include: {
        preset: {
          select: {
            turns: true,
          },
        },
      },
    });

    if (!draft) {
      return reply.code(404).send({
        error: 'NotFound',
        message: `Draft "${draftId}" not found`,
        statusCode: 404,
      });
    }

    // Determine viewer role
    let viewerRole: 'host' | 'guest' | 'spectator';
    if (viewerUserId && viewerUserId === draft.host_user_id) {
      viewerRole = 'host';
    } else if (viewerUserId && viewerUserId === draft.guest_user_id) {
      viewerRole = 'guest';
    } else {
      viewerRole = 'spectator';
    }

    // Load events ordered chronologically
    const rawEvents = await fastify.prisma.draftEvent.findMany({
      where: { draft_id: draftId },
      orderBy: [{ turn_index: 'asc' }, { created_at: 'asc' }],
    });

    // Determine which turn indices have been revealed by a subsequent reveal event
    const revealEventTurnIndices = new Set<number>();
    // If a reveal_picks / reveal_bans / reveal_all event exists, all prior hidden picks/bans are revealed
    let hasRevealPicks = false;
    let hasRevealBans = false;
    let hasRevealAll = false;

    for (const ev of rawEvents) {
      if (ev.action === 'reveal_all') {
        hasRevealAll = true;
      } else if (ev.action === 'reveal_picks') {
        hasRevealPicks = true;
      } else if (ev.action === 'reveal_bans') {
        hasRevealBans = true;
      }
    }

    // Load preset turns for is_hidden info
    const presetTurns = Array.isArray(draft.preset.turns) ? draft.preset.turns : [];

    // Apply masking to events
    const events = rawEvents.map((ev) => {
      // Determine if this event's faction_id should be masked
      let factionId: string | null = ev.faction_id;

      if (ev.action === 'pick' || ev.action === 'ban') {
        // Check if this turn was hidden
        const turnDef = presetTurns[ev.turn_index] as
          | { is_hidden?: boolean; action?: string; actor?: string }
          | undefined;
        const isTurnHidden = turnDef?.is_hidden === true;

        if (isTurnHidden) {
          // Determine if reveals have happened
          const isRevealed =
            hasRevealAll ||
            (ev.action === 'pick' && hasRevealPicks) ||
            (ev.action === 'ban' && hasRevealBans);

          if (!isRevealed) {
            // Still hidden — apply masking
            if (viewerRole === 'spectator') {
              factionId = null;
            } else {
              // Player: only actor sees their own hidden faction
              const actorIsHost = turnDef?.actor === 'host';
              const actorIsGuest = turnDef?.actor === 'guest';
              const isOwnAction =
                (viewerRole === 'host' && actorIsHost) ||
                (viewerRole === 'guest' && actorIsGuest);
              if (!isOwnAction) {
                factionId = null;
              }
            }
          }
        }
      }

      return {
        id: ev.id,
        draft_id: ev.draft_id,
        turn_index: ev.turn_index,
        actor: ev.actor as 'host' | 'guest' | 'admin' | 'system',
        action: ev.action as
          | 'pick'
          | 'ban'
          | 'snipe'
          | 'steal'
          | 'reveal_picks'
          | 'reveal_bans'
          | 'reveal_all'
          | 'auto_select'
          | 'start'
          | 'complete'
          | 'cancel',
        faction_id: factionId,
        is_auto_selected: ev.is_auto_selected,
        payload: ev.payload ?? null,
        created_at: ev.created_at.toISOString(),
      };
    });

    return reply.code(200).send({ events });
  });

  // -------------------------------------------------------------------------
  // POST /api/drafts/:id/cancel
  // Organizer / Moderator / Admin only.
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/drafts/:id/cancel',
    {
      preHandler: [fastify.authenticate, fastify.requireRole('HOST', 'MODERATOR', 'ADMIN')],
    },
    async (request, reply) => {
      const { id: draftId } = request.params as { id: string };
      const actorUserId = request.user.sub;

      // Load draft to check organizer ownership
      const draft = await fastify.prisma.draft.findUnique({
        where: { id: draftId },
        include: {
          match: {
            include: {
              tournament: {
                select: { organizer_id: true },
              },
            },
          },
        },
      });

      if (!draft) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Draft "${draftId}" not found`,
          statusCode: 404,
        });
      }

      // HOST role: must be the tournament organizer
      const userRole = request.user.role;
      const isModOrAdmin = userRole === 'MODERATOR' || userRole === 'ADMIN';
      const isOwnOrganizer = actorUserId === draft.match.tournament?.organizer_id;

      if (!isModOrAdmin && !isOwnOrganizer) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not the organizer of this tournament',
          statusCode: 403,
        });
      }

      try {
        await fastify.draftService.cancelDraft(draftId, actorUserId);
      } catch (err) {
        if (err instanceof DraftNotFoundError) {
          return reply.code(404).send({
            error: 'NotFound',
            message: `Draft "${draftId}" not found`,
            statusCode: 404,
          });
        }
        throw err;
      }

      return reply.code(200).send({ id: draftId, status: 'CANCELLED' });
    },
  );
};

export default draftRoutes;
