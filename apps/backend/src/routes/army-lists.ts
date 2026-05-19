import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseTxtArmyList, isPdf, isTxt } from '../lib/army-parser.js';

const UPLOAD_DIR =
  process.env.UPLOAD_DIR ?? join(process.cwd(), 'uploads', 'army-lists');

const ListQuerySchema = z.object({
  user_id: z.string().uuid().optional(),
  tournament_id: z.string().uuid().optional(),
});

const armyListsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addHook('preHandler', fastify.authenticate);

  await mkdir(UPLOAD_DIR, { recursive: true });

  // ---------------------------------------------------------------------------
  // POST /api/army-lists — multipart upload
  // ---------------------------------------------------------------------------
  fastify.post('/api/army-lists', async (request, reply) => {
    const data = await request.file();
    if (!data) {
      return reply
        .code(400)
        .send({ error: 'BadRequest', message: 'No file uploaded', statusCode: 400 });
    }

    const buffer = await data.toBuffer();
    if (buffer.length === 0) {
      return reply
        .code(400)
        .send({ error: 'BadRequest', message: 'Empty file', statusCode: 400 });
    }

    let file_type: 'TXT' | 'PDF';
    let parsed_data: Record<string, unknown> | null = null;

    if (isPdf(buffer)) {
      file_type = 'PDF';
      // No PDF parsing — only metadata stored
    } else if (isTxt(buffer)) {
      file_type = 'TXT';
      const content = buffer.toString('utf-8');
      parsed_data = parseTxtArmyList(content) as Record<string, unknown> | null;
    } else {
      return reply.code(415).send({
        error: 'UnsupportedMediaType',
        message: 'Only TXT and PDF files are supported',
        statusCode: 415,
      });
    }

    // Read additional form fields
    const factionId = (data.fields['faction_id'] as { value?: string } | undefined)?.value;
    const tournamentId = (
      data.fields['tournament_id'] as { value?: string } | undefined
    )?.value;

    if (!factionId) {
      return reply.code(400).send({
        error: 'BadRequest',
        message: 'faction_id form field required',
        statusCode: 400,
      });
    }

    // Save file to disk under UPLOAD_DIR/<userId>/<uuid>.<ext>
    const userId = request.user.sub;
    const ext = file_type === 'PDF' ? 'pdf' : 'txt';
    const filename = `${randomUUID()}.${ext}`;
    const userDir = join(UPLOAD_DIR, userId);
    await mkdir(userDir, { recursive: true });
    const fullPath = join(userDir, filename);
    await writeFile(fullPath, buffer);

    const fileUrl = `/uploads/army-lists/${userId}/${filename}`;

    // Lock-guard: if a tournament_id is provided, check whether the participant's
    // lists_locked_at is set, OR (for non-participants) whether the tournament
    // has any locked participant. ADMIN/MODERATOR may override (with audit log).
    if (tournamentId) {
      const participant = await fastify.prisma.tournamentParticipant.findFirst({
        where: {
          tournament_id: tournamentId,
          user_id: userId,
          deleted_at: null,
        },
        select: { id: true, lists_locked_at: true },
      });

      const ownLocked =
        participant?.lists_locked_at !== null && participant?.lists_locked_at !== undefined;
      let lockedParticipantId: string | null = ownLocked ? (participant?.id ?? null) : null;
      let tournamentLocked = ownLocked;

      if (!ownLocked) {
        // Non-participant uploader OR participant not yet locked — fall back to
        // checking whether ANY participant is locked (tournament-level lock signal).
        const anyLocked = await fastify.prisma.tournamentParticipant.findFirst({
          where: {
            tournament_id: tournamentId,
            lists_locked_at: { not: null },
            deleted_at: null,
          },
          select: { id: true },
        });
        if (anyLocked) {
          tournamentLocked = true;
          lockedParticipantId = anyLocked.id;
        }
      }

      if (tournamentLocked) {
        const isPrivileged =
          request.user.role === 'ADMIN' || request.user.role === 'MODERATOR';

        if (!isPrivileged) {
          return reply.code(403).send({
            error: 'ListsLocked',
            message: 'Army lists are locked for this tournament. Contact the organizer.',
            statusCode: 403,
          });
        }

        // Privileged override — write audit log
        if (lockedParticipantId) {
          await fastify.prisma.auditLog.create({
            data: {
              entity_type: 'TournamentParticipant',
              entity_id: lockedParticipantId,
              action: 'army_list_override_after_lock',
              actor_id: userId,
              new_value: {
                tournament_id: tournamentId,
                override_reason: 'ADMIN/MODERATOR override after lists_locked_at',
              },
            },
          });
        }
      }
    }

    const armyList = await fastify.prisma.armyList.create({
      data: {
        user_id: userId,
        tournament_id: tournamentId ?? null,
        faction_id: factionId,
        file_url: fileUrl,
        file_name: data.filename,
        file_type,
        parsed_data: parsed_data as never,
      },
      select: {
        id: true,
        user_id: true,
        tournament_id: true,
        faction_id: true,
        file_url: true,
        file_name: true,
        file_type: true,
        parsed_data: true,
        created_at: true,
      },
    });

    return reply.code(201).send(armyList);
  });

  // ---------------------------------------------------------------------------
  // GET /api/army-lists?user_id=...&tournament_id=...
  // ---------------------------------------------------------------------------
  fastify.get('/api/army-lists', async (request, reply) => {
    const parsed = ListQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply
        .code(400)
        .send({ error: 'BadRequest', message: parsed.error.message, statusCode: 400 });
    }

    const { user_id, tournament_id } = parsed.data;
    const where: Record<string, unknown> = {};
    if (user_id) where.user_id = user_id;
    if (tournament_id) where.tournament_id = tournament_id;
    // Default: current user's own lists
    if (!user_id && !tournament_id) where.user_id = request.user.sub;

    const lists = await fastify.prisma.armyList.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
    return { lists };
  });

  // ---------------------------------------------------------------------------
  // GET /api/army-lists/:id/download — stream file
  // ---------------------------------------------------------------------------
  fastify.get<{ Params: { id: string } }>(
    '/api/army-lists/:id/download',
    async (request, reply) => {
      const list = await fastify.prisma.armyList.findUnique({
        where: { id: request.params.id },
      });
      if (!list) {
        return reply
          .code(404)
          .send({ error: 'NotFound', message: 'Army list not found', statusCode: 404 });
      }

      // ACL: owner or privileged role
      const isOwner = list.user_id === request.user.sub;
      const isPriv = ['ADMIN', 'ORGANIZER', 'MODERATOR'].includes(request.user.role);
      if (!isOwner && !isPriv) {
        return reply
          .code(403)
          .send({ error: 'Forbidden', message: 'Not your army list', statusCode: 403 });
      }

      // file_url is /uploads/army-lists/<userId>/<filename>
      const relativePath = list.file_url.replace(/^\//, '');
      const fullPath = join(process.cwd(), relativePath);
      try {
        await stat(fullPath);
      } catch {
        return reply
          .code(410)
          .send({ error: 'Gone', message: 'File no longer exists', statusCode: 410 });
      }
      const buf = await readFile(fullPath);
      reply.header(
        'Content-Type',
        list.file_type === 'PDF' ? 'application/pdf' : 'text/plain',
      );
      reply.header('Content-Disposition', `attachment; filename="${list.file_name}"`);
      return reply.send(buf);
    },
  );
};

export default armyListsRoutes;
