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

    io.on('connection', (socket) => {
      fastify.log.debug(
        { userId: socket.data.userId, sid: socket.id },
        'socket connected',
      );
      socket.on('join_tournament', (id) => void socket.join(`tournament_${id}`));
      socket.on('leave_tournament', (id) => void socket.leave(`tournament_${id}`));
    });

    fastify.decorate('io', io);
    fastify.addHook('onClose', async () => {
      await io.close();
    });
  },
  { name: 'socket', dependencies: ['auth', 'redis'] },
);
