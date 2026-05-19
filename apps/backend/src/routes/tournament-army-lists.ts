/**
 * Tournament Army Lists (TournamentArmyList model — Welle 2, SLT mode)
 *
 * Separate from the legacy /api/army-lists (ArmyList model, M5).
 * These are per-tournament per-player army lists with reveal logic.
 *
 * Endpoints:
 *   POST /api/tournaments/:slug/army-list         — upload own list (multipart)
 *   GET  /api/tournaments/:slug/army-lists/me     — own list
 *   GET  /api/tournaments/:slug/army-lists/:opponent_user_id — opponent list (reveal check)
 *   GET  /api/tournaments/:slug/army-lists/all    — all lists (post-complete or admin)
 */

import type { FastifyPluginAsync } from 'fastify';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const UPLOAD_DIR =
  process.env.ARMY_LIST_UPLOAD_DIR ??
  join(process.cwd(), 'storage', 'army-lists');

// Allowed screenshot MIME types
const SCREENSHOT_MIMES = new Set(['image/png', 'image/jpeg', 'image/jpg', 'image/webp']);

// ---------------------------------------------------------------------------
// Helper: try to import parser (SB2 implements it; skip gracefully if absent)
// ---------------------------------------------------------------------------
async function tryParseArmySetup(buffer: Buffer): Promise<Record<string, unknown> | null> {
  try {
    const parser = await import('../lib/army-setup-parser.js') as unknown as {
      parseArmySetup?: (buf: Buffer) => unknown;
    };
    if (typeof parser.parseArmySetup === 'function') {
      return parser.parseArmySetup(buffer) as unknown as Record<string, unknown>;
    }
  } catch {
    // parser not yet implemented — skip
  }
  return null;
}

// ---------------------------------------------------------------------------
// Route plugin
// ---------------------------------------------------------------------------

const tournamentArmyListsRoutes: FastifyPluginAsync = async (fastify) => {
  await mkdir(UPLOAD_DIR, { recursive: true });

  // -------------------------------------------------------------------------
  // POST /api/tournaments/:slug/army-list
  // Multipart: optional `file` (.army_setup), required `screenshot` (PNG/JPG)
  // -------------------------------------------------------------------------
  fastify.post(
    '/api/tournaments/:slug/army-list',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, mode: true, start_date: true, status: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      // SLT mode check
      if (tournament.mode !== 'SLT') {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Army list upload is only available for SLT (Single List Tournament) mode',
          statusCode: 422,
        });
      }

      // Lock at tournament start
      if (new Date() >= tournament.start_date) {
        return reply.code(422).send({
          error: 'UnprocessableEntity',
          message: 'Army list submission is locked — tournament has already started',
          statusCode: 422,
        });
      }

      // Participant check
      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: {
          tournament_id: tournament.id,
          user_id: request.user.sub,
          deleted_at: null,
        },
        select: { id: true, status: true },
      });

      if (!participant) {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'You are not registered for this tournament',
          statusCode: 403,
        });
      }

      if (participant.status === 'DISQUALIFIED' || participant.status === 'WITHDREW') {
        return reply.code(403).send({
          error: 'Forbidden',
          message: `Cannot upload army list with participant status "${participant.status}"`,
          statusCode: 403,
        });
      }

      // Parse multipart
      const parts = request.parts();
      let armySetupBuffer: Buffer | null = null;
      let screenshotBuffer: Buffer | null = null;
      let screenshotFilename = 'screenshot.png';
      let screenshotMime = 'image/png';

      for await (const part of parts) {
        if (part.type === 'file') {
          const buf = await part.toBuffer();
          if (part.fieldname === 'file') {
            armySetupBuffer = buf;
          } else if (part.fieldname === 'screenshot') {
            screenshotBuffer = buf;
            screenshotFilename = part.filename ?? screenshotFilename;
            screenshotMime = part.mimetype ?? screenshotMime;
          }
        }
      }

      if (!screenshotBuffer || screenshotBuffer.length === 0) {
        return reply.code(400).send({
          error: 'BadRequest',
          message: 'Screenshot (PNG/JPG) is required',
          statusCode: 400,
        });
      }

      if (!SCREENSHOT_MIMES.has(screenshotMime)) {
        return reply.code(415).send({
          error: 'UnsupportedMediaType',
          message: 'Screenshot must be PNG, JPG or WebP',
          statusCode: 415,
        });
      }

      const userId = request.user.sub;
      const userDir = join(UPLOAD_DIR, tournament.id, userId);
      await mkdir(userDir, { recursive: true });

      // Save screenshot
      const screenshotExt = screenshotFilename.split('.').pop() ?? 'png';
      const screenshotFilenameOnDisk = `screenshot-${randomUUID()}.${screenshotExt}`;
      const screenshotPath = join(userDir, screenshotFilenameOnDisk);
      await writeFile(screenshotPath, screenshotBuffer);
      const screenshotUrl = `/storage/army-lists/${tournament.id}/${userId}/${screenshotFilenameOnDisk}`;

      // Save .army_setup if provided
      let fileUrl: string | null = null;
      let parsedJson: Record<string, unknown> | null = null;
      if (armySetupBuffer && armySetupBuffer.length > 0) {
        const setupFilename = `setup-${randomUUID()}.army_setup`;
        const setupPath = join(userDir, setupFilename);
        await writeFile(setupPath, armySetupBuffer);
        fileUrl = `/storage/army-lists/${tournament.id}/${userId}/${setupFilename}`;

        // Try parser (SB2 implements army-setup-parser.ts)
        parsedJson = await tryParseArmySetup(armySetupBuffer);
      }

      // Upsert TournamentArmyList
      const armyList = await fastify.prisma.tournamentArmyList.upsert({
        where: { tournament_id_user_id: { tournament_id: tournament.id, user_id: userId } },
        create: {
          tournament_id: tournament.id,
          user_id: userId,
          file_url: fileUrl,
          screenshot_url: screenshotUrl,
          parsed_json: parsedJson as never,
        },
        update: {
          file_url: fileUrl ?? undefined,
          screenshot_url: screenshotUrl,
          parsed_json: parsedJson as never,
        },
        select: {
          tournament_id: true,
          user_id: true,
          screenshot_url: true,
          file_url: true,
          locked_at: true,
          created_at: true,
        } as never,
      });

      return reply.code(201).send(armyList);
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/tournaments/:slug/army-lists/me
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/tournaments/:slug/army-lists/me',
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

      const armyList = await fastify.prisma.tournamentArmyList.findUnique({
        where: {
          tournament_id_user_id: { tournament_id: tournament.id, user_id: request.user.sub },
        },
      });

      if (!armyList) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'You have not uploaded an army list for this tournament',
          statusCode: 404,
        });
      }

      return armyList;
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/tournaments/:slug/army-lists/all
  // Only after tournament COMPLETED or admin/mod/organizer
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/tournaments/:slug/army-lists/all',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug } = request.params as { slug: string };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, status: true, organizer_id: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      const user = request.user;
      const isPrivileged =
        user.role === 'ADMIN' ||
        user.role === 'MODERATOR' ||
        user.sub === tournament.organizer_id;

      if (!isPrivileged && tournament.status !== 'COMPLETED') {
        return reply.code(403).send({
          error: 'Forbidden',
          message: 'Army lists are only public after the tournament is completed',
          statusCode: 403,
        });
      }

      const lists = await fastify.prisma.tournamentArmyList.findMany({
        where: { tournament_id: tournament.id },
        include: { user: { select: { id: true, username: true, avatar_url: true } } },
      });

      return { data: lists, total: lists.length };
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/tournaments/:slug/army-lists/:opponent_user_id
  // Reveal check: allowed if current user has a COMPLETED match with opponent
  // in this tournament, or tournament is COMPLETED, or user is admin/mod/organizer
  // -------------------------------------------------------------------------
  fastify.get(
    '/api/tournaments/:slug/army-lists/:opponent_user_id',
    { preHandler: fastify.authenticate },
    async (request, reply) => {
      const { slug, opponent_user_id } = request.params as {
        slug: string;
        opponent_user_id: string;
      };

      const tournament = await fastify.prisma.tournament.findFirst({
        where: { slug, deleted_at: null },
        select: { id: true, status: true, organizer_id: true },
      });

      if (!tournament) {
        return reply.code(404).send({
          error: 'NotFound',
          message: `Tournament "${slug}" not found`,
          statusCode: 404,
        });
      }

      const user = request.user;
      const isPrivileged =
        user.role === 'ADMIN' ||
        user.role === 'MODERATOR' ||
        user.sub === tournament.organizer_id;

      // Check reveal conditions
      let canReveal = isPrivileged || tournament.status === 'COMPLETED';

      if (!canReveal) {
        // Check if current user has a COMPLETED match against opponent in this tournament
        const completedMatch = await fastify.prisma.match.findFirst({
          where: {
            tournament_id: tournament.id,
            status: 'COMPLETED',
            deleted_at: null,
            OR: [
              { player1_id: user.sub, player2_id: opponent_user_id },
              { player1_id: opponent_user_id, player2_id: user.sub },
            ],
          },
          select: { id: true },
        });
        canReveal = Boolean(completedMatch);
      }

      if (!canReveal) {
        return reply.code(403).send({
          error: 'Forbidden',
          message:
            "You can only view an opponent's army list after completing a match against them",
          statusCode: 403,
        });
      }

      const armyList = await fastify.prisma.tournamentArmyList.findUnique({
        where: {
          tournament_id_user_id: { tournament_id: tournament.id, user_id: opponent_user_id },
        },
        include: { user: { select: { id: true, username: true, avatar_url: true } } },
      });

      if (!armyList) {
        return reply.code(404).send({
          error: 'NotFound',
          message: 'Opponent has not uploaded an army list for this tournament',
          statusCode: 404,
        });
      }

      return armyList;
    },
  );
};

export default tournamentArmyListsRoutes;
