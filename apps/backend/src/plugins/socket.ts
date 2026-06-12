import fp from 'fastify-plugin';
import { Server as IOServer } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { parse as parseCookie } from 'cookie';
import type {
  ClientToServerEvents,
  InterServerEvents,
  JwtPayload,
  ServerToClientEvents,
  SocketData,
} from '@rizzotto/types';
import { DraftNotFoundError } from '../lib/draft-service.js';

export type AppIOServer = IOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

declare module 'fastify' {
  interface FastifyInstance {
    io: AppIOServer;
  }
}

export default fp(
  async (fastify) => {
    const cookieName = process.env.JWT_COOKIE_NAME ?? 'auth_token';
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';

    const io: AppIOServer = new IOServer(fastify.server, {
      cors: { origin: frontendUrl, credentials: true },
      transports: ['websocket', 'polling'],
    });

    io.adapter(createAdapter(fastify.redisPub, fastify.redisSub));

    io.use((socket, next) => {
      try {
        const raw = socket.handshake.headers.cookie ?? '';
        const cookies = parseCookie(raw);
        const token = cookies[cookieName];
        if (!token) return next(new Error('no auth cookie'));

        const payload = fastify.jwt.verify<JwtPayload>(token);
        socket.data.userId = payload.sub;
        socket.data.username = payload.username;
        socket.data.role = payload.role;
        return next();
      } catch (err) {
        fastify.log.debug({ err }, 'socket auth failed');
        return next(new Error('invalid auth token'));
      }
    });

    const uuidRe = /^[0-9a-f-]{36}$/i;

    io.on('connection', (socket) => {
      fastify.log.debug(
        { userId: socket.data.userId, sid: socket.id },
        'socket connected',
      );

      socket.on('join_tournament', async (id) => {
        if (typeof id !== 'string' || !uuidRe.test(id)) {
          fastify.log.warn({ sid: socket.id, id }, 'join_tournament: invalid UUID, ignoring');
          return;
        }
        // PRIVATE tournaments: only organizer or MODERATOR/ADMIN may receive
        // live bracket/result events (mirrors the REST visibility gate).
        try {
          const tournament = await fastify.prisma.tournament.findFirst({
            where: { id, deleted_at: null },
            select: { visibility: true, organizer_id: true },
          });
          if (!tournament) return;
          if (tournament.visibility === 'PRIVATE') {
            const isAllowed =
              socket.data.userId === tournament.organizer_id ||
              socket.data.role === 'MODERATOR' ||
              socket.data.role === 'ADMIN';
            if (!isAllowed) {
              fastify.log.warn(
                { sid: socket.id, userId: socket.data.userId, id },
                'join_tournament: denied (private tournament)',
              );
              return;
            }
          }
          void socket.join(`tournament_${id}`);
        } catch (err) {
          fastify.log.error({ err, id }, 'join_tournament failed');
        }
      });

      socket.on('leave_tournament', (id) => void socket.leave(`tournament_${id}`));

      socket.on('join_match_decision', async (matchId) => {
        if (typeof matchId !== 'string' || !uuidRe.test(matchId)) {
          fastify.log.warn({ sid: socket.id, matchId }, 'join_match_decision: invalid UUID, ignoring');
          return;
        }
        // Only the two match participants or staff may receive live decision /
        // blind-pick events (prevents third parties reading ban/lock timing).
        try {
          const match = await fastify.prisma.match.findFirst({
            where: { id: matchId, deleted_at: null },
            select: { player1_id: true, player2_id: true },
          });
          if (!match) return;
          const isParticipant =
            socket.data.userId === match.player1_id ||
            socket.data.userId === match.player2_id;
          const isStaff =
            socket.data.role === 'HOST' ||
            socket.data.role === 'MODERATOR' ||
            socket.data.role === 'ADMIN';
          if (!isParticipant && !isStaff) {
            fastify.log.warn(
              { sid: socket.id, userId: socket.data.userId, matchId },
              'join_match_decision: denied (not a participant)',
            );
            return;
          }
          void socket.join(`match_decision_${matchId}`);
        } catch (err) {
          fastify.log.error({ err, matchId }, 'join_match_decision failed');
        }
      });

      socket.on('leave_match_decision', (matchId) => void socket.leave(`match_decision_${matchId}`));

      // ------------------------------------------------------------------
      // M4.5 Draft-Room handlers
      // ------------------------------------------------------------------

      socket.on('join_draft', async (draftId) => {
        if (typeof draftId !== 'string' || !uuidRe.test(draftId)) {
          fastify.log.warn({ sid: socket.id, draftId }, 'join_draft: invalid UUID');
          return;
        }
        try {
          const view = await fastify.draftService.getDraftView(draftId, socket.data.userId);

          if (
            view.viewer_role === 'host' ||
            view.viewer_role === 'guest' ||
            view.viewer_role === 'admin'
          ) {
            void socket.join(`draft_${draftId}`);
            void socket.join(`draft_${draftId}:player_${socket.data.userId}`);
          } else {
            // Spectator — even if they called join_draft they go into spec room
            void socket.join(`draft_${draftId}:spec`);
          }

          socket.emit('draft_state_sync', {
            draftId: view.id,
            state: view.state,
            currentTurn: view.current_turn,
            timerExpiresAt: view.timer_expires_at,
            status: view.status,
          });
        } catch (err) {
          if (err instanceof DraftNotFoundError) {
            fastify.log.warn({ draftId }, 'join_draft: draft not found');
            return;
          }
          fastify.log.error({ err, draftId }, 'join_draft failed');
        }
      });

      socket.on('watch_draft', async (draftId) => {
        if (typeof draftId !== 'string' || !uuidRe.test(draftId)) return;
        try {
          // null = spectator perspective (no hidden data)
          const view = await fastify.draftService.getDraftView(draftId, null);
          void socket.join(`draft_${draftId}:spec`);
          socket.emit('draft_state_sync', {
            draftId: view.id,
            state: view.state,
            currentTurn: view.current_turn,
            timerExpiresAt: view.timer_expires_at,
            status: view.status,
          });
        } catch (err) {
          if (err instanceof DraftNotFoundError) return;
          fastify.log.error({ err, draftId }, 'watch_draft failed');
        }
      });

      socket.on('leave_draft', (draftId) => {
        if (typeof draftId !== 'string' || !uuidRe.test(draftId)) return;
        void socket.leave(`draft_${draftId}`);
        void socket.leave(`draft_${draftId}:player_${socket.data.userId}`);
        void socket.leave(`draft_${draftId}:spec`);
      });

      socket.on('draft_action', async (payload) => {
        if (
          !payload ||
          typeof payload.draftId !== 'string' ||
          typeof payload.factionId !== 'string'
        )
          return;
        if (!uuidRe.test(payload.draftId)) return;
        try {
          await fastify.draftService.handleAction(
            payload.draftId,
            socket.data.userId,
            payload.factionId,
          );
        } catch (err) {
          fastify.log.warn(
            { err, userId: socket.data.userId, draftId: payload.draftId },
            'draft_action rejected',
          );
        }
      });

      socket.on('disconnect', (reason) => {
        fastify.log.debug(
          { userId: socket.data.userId, sid: socket.id, reason },
          'socket disconnected',
        );
      });
    });

    fastify.decorate('io', io);
    fastify.addHook('onClose', async () => {
      await io.close();
    });
  },
  { name: 'socket', dependencies: ['db', 'auth', 'redis', 'draft'] },
);
