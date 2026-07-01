import type { FastifyPluginAsync } from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canManageTournament } from '../lib/tournament-utils.js';

// Posters live under <cwd>/uploads/posters/<tournamentId>/<uuid>.<ext> and are served
// statically at /uploads/posters/... (see @fastify/static registration in app.ts).
const POSTER_DIR = process.env.POSTER_UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'posters');

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const tournamentPosterRoutes: FastifyPluginAsync = async (fastify) => {
  // Best-effort: a poster-dir creation failure must never crash app startup.
  // The per-request handler re-creates the dir before writing anyway.
  await mkdir(POSTER_DIR, { recursive: true }).catch((err) => {
    fastify.log.warn({ err, dir: POSTER_DIR }, 'Could not pre-create poster upload dir');
  });

  // POST /api/tournaments/:slug/poster — host / co-host / admin uploads a poster image.
  fastify.post(
    '/api/tournaments/:slug/poster',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      }
      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the host or an admin can set the poster', statusCode: 403 });
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

      const dir = join(POSTER_DIR, tournament.id);
      await mkdir(dir, { recursive: true });
      const filename = `${randomUUID()}.${ext}`;
      await writeFile(join(dir, filename), buffer);

      const posterUrl = `/uploads/posters/${tournament.id}/${filename}`;
      await fastify.prisma.tournament.update({
        where: { id: tournament.id },
        data: { poster_url: posterUrl },
      });

      return reply.code(200).send({ poster_url: posterUrl });
    },
  );

  // DELETE /api/tournaments/:slug/poster — host / co-host / admin removes the poster.
  fastify.delete(
    '/api/tournaments/:slug/poster',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };
      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true },
      });
      if (!tournament) {
        return reply.code(404).send({ error: 'NotFound', message: 'Tournament not found', statusCode: 404 });
      }
      if (!(await canManageTournament(fastify.prisma, tournament.id, request.user.sub, request.user.role))) {
        return reply.code(403).send({ error: 'Forbidden', message: 'Only the host or an admin can remove the poster', statusCode: 403 });
      }
      await fastify.prisma.tournament.update({
        where: { id: tournament.id },
        data: { poster_url: null },
      });
      return reply.code(204).send();
    },
  );
};

export default tournamentPosterRoutes;
