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
} from '@tww3/types';
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

      socket.on('join_tournament', (id) => {
        if (typeof id !== 'string' || !uuidRe.test(id)) {
          fastify.log.warn({ sid: socket.id, id }, 'join_tournament: invalid UUID, ignoring');
          return;
        }
        void socket.join(`tournament_${id}`);
      });

      socket.on('leave_tournament', (id) => void socket.leave(`tournament_${id}`));

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
  { name: 'socket', dependencies: ['auth', 'redis', 'draft'] },
);
