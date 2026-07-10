/**
 * Regression test for tournament poster serving.
 *
 * Posters are written to POSTER_DIR (src/lib/posters.ts) and must be served by
 * the dedicated /uploads/posters/ static mount in app.ts. The general /uploads/*
 * mount only resolves against cwd/uploads — so a poster written to POSTER_DIR
 * (a persistent path outside the repo checkout in production) would otherwise
 * fall through to the SPA fallback and return index.html instead of the image.
 * Writing through POSTER_DIR here guarantees the test and the app agree on the
 * path whether it's the default or a POSTER_UPLOAD_DIR override.
 *
 * Mirrors replay-serving.test.ts. Requires real PostgreSQL (Docker up) because
 * buildApp registers the db plugin.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { POSTER_DIR } from '../src/lib/posters.js';

let app: FastifyInstance;
const createdDirs: string[] = [];

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

afterEach(async () => {
  await Promise.all(createdDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('poster static serving', () => {
  it('serves a poster file via /uploads/posters/:tournamentId/:file', async () => {
    const tournamentId = randomUUID();
    const posterDir = join(POSTER_DIR, tournamentId);
    createdDirs.push(posterDir);
    await mkdir(posterDir, { recursive: true });
    const body = 'BINARY-POSTER-BYTES';
    await writeFile(join(posterDir, 'poster.webp'), body);

    const res = await app.inject({ method: 'GET', url: `/uploads/posters/${tournamentId}/poster.webp` });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(body);
  });

  it('returns 404 (not the SPA fallback HTML) for a missing poster', async () => {
    const res = await app.inject({ method: 'GET', url: `/uploads/posters/${randomUUID()}/missing.webp` });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type'] ?? '').not.toContain('text/html');
  });
});
