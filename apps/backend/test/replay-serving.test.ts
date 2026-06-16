/**
 * Regression test for replay file serving.
 *
 * Replays are written to REPLAY_DIR (src/lib/replays.ts) and must be served by
 * the dedicated /uploads/replays/ static mount in app.ts. Before that mount
 * existed, /uploads/* resolved only against cwd/uploads — so when production set
 * REPLAY_UPLOAD_DIR to a path outside the repo checkout, replay downloads fell
 * through to the SPA fallback and returned index.html (~3 kB) instead of the
 * actual file. Writing through REPLAY_DIR here guarantees the test and the app
 * agree on the path whether it's the default or an env override.
 *
 * Requires real PostgreSQL (Docker up) because buildApp registers the db plugin.
 */

import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { REPLAY_DIR } from '../src/lib/replays.js';

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

describe('replay static serving', () => {
  it('serves a replay file via /uploads/replays/:matchId/:file', async () => {
    const matchId = randomUUID();
    const matchDir = join(REPLAY_DIR, matchId);
    createdDirs.push(matchDir);
    await mkdir(matchDir, { recursive: true });
    const body = 'BINARY-REPLAY-BYTES';
    await writeFile(join(matchDir, 'replay.rec'), body);

    const res = await app.inject({ method: 'GET', url: `/uploads/replays/${matchId}/replay.rec` });

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(body);
  });

  it('returns 404 (not the SPA fallback HTML) for a missing replay', async () => {
    const res = await app.inject({ method: 'GET', url: `/uploads/replays/${randomUUID()}/missing.rec` });

    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type'] ?? '').not.toContain('text/html');
  });
});
