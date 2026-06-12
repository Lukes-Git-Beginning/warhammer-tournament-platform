/**
 * tournament-fixture.ts
 * Shared test-fixture helper for M5.2 E2E tests.
 * Provides user creation, auth, tournament lifecycle helpers, and cleanup.
 */
import type { APIRequestContext, BrowserContext } from '@playwright/test';
import { prisma } from '@rizzotto/db';
import { randomUUID } from 'node:crypto';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * TestRole extends the DB Role enum with a 'PLAYER' alias that maps to 'USER'.
 * The DB schema has no PLAYER role; 'PLAYER' here is a semantic convenience
 * for tests that want to express "a tournament participant".
 */
export type TestRole = 'USER' | 'PLAYER' | 'HOST' | 'ORGANIZER' | 'MODERATOR' | 'ADMIN';

/** Maps TestRole to the Prisma Role enum (no PLAYER in DB — maps to USER). */
const toPrismaRole = (role: TestRole): 'USER' | 'HOST' | 'ORGANIZER' | 'MODERATOR' | 'ADMIN' =>
  role === 'PLAYER' ? 'USER' : role;

export interface TestUser {
  id: string;
  username: string;
  discord_id: string;
  role: TestRole;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_BACKEND_URL = 'http://localhost:3000';

// ---------------------------------------------------------------------------
// User Management
// ---------------------------------------------------------------------------

/**
 * Creates N users via direct Prisma insert.
 *
 * By default every user is created **with a SteamLink** so the global
 * Steam-Hard-Gate (`useRequireSteamLink`) does not redirect tests away
 * from authenticated routes. Tests that exercise the gate itself must
 * opt out via `withSteamLink: false`.
 */
export async function createTestUsers(
  count: number,
  opts?: { role?: TestRole; usernamePrefix?: string; withSteamLink?: boolean },
): Promise<TestUser[]> {
  const role = opts?.role ?? 'USER';
  const prefix = opts?.usernamePrefix ?? 'test-user';
  const withSteamLink = opts?.withSteamLink ?? true;
  const prismaRole = toPrismaRole(role);

  const users: TestUser[] = [];

  for (let i = 0; i < count; i++) {
    const discord_id = `test-${randomUUID()}`;
    const username = `${prefix}-${i}-${randomUUID().slice(0, 6)}`;
    const uuidTail = randomUUID().replace(/-/g, '').slice(0, 12);

    const created = await prisma.user.create({
      data: {
        discord_id,
        username,
        role: prismaRole,
        ...(withSteamLink
          ? {
              steam_link: {
                create: {
                  steam_id: `7656119${uuidTail}`,
                  persona: username,
                  avatar_url: null,
                  profile_url: null,
                  verified_at: new Date(),
                },
              },
            }
          : {}),
      },
      select: { id: true, username: true, discord_id: true, role: true },
    });

    users.push({
      id: created.id,
      username: created.username,
      discord_id: created.discord_id,
      role: created.role as TestRole,
    });
  }

  return users;
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Signs in via POST /auth/test-login on a Playwright APIRequestContext.
 * Sets the auth cookie on the context automatically.
 */
export async function signInRequest(
  request: APIRequestContext,
  userId: string,
  backendURL = DEFAULT_BACKEND_URL,
): Promise<void> {
  const res = await request.post(`${backendURL}/auth/test-login`, {
    data: { userId },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`signInRequest failed for userId=${userId}: ${res.status()} ${body}`);
  }
}

/**
 * Signs in via POST /auth/test-login on a Playwright BrowserContext.
 * Uses the context's underlying request so cookies are stored on the context.
 */
export async function signInBrowser(
  ctx: BrowserContext,
  userId: string,
  backendURL = DEFAULT_BACKEND_URL,
): Promise<void> {
  const res = await ctx.request.post(`${backendURL}/auth/test-login`, {
    data: { userId },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`signInBrowser failed for userId=${userId}: ${res.status()} ${body}`);
  }
}

// ---------------------------------------------------------------------------
// Season helpers
// ---------------------------------------------------------------------------

/**
 * Ensures at least one Season is is_active=true.
 * Picks the first existing season (by created_at) and activates it. Idempotent.
 * Tests that depend on leaderboard / faction-stats endpoints must call this
 * in beforeAll to recover from other test files that leave seasons inactive.
 */
export async function ensureActiveSeason(): Promise<string> {
  const active = await prisma.season.findFirst({ where: { is_active: true } });
  if (active) return active.id;

  const firstSeason = await prisma.season.findFirst({ orderBy: { created_at: 'asc' } });
  if (!firstSeason) {
    throw new Error('ensureActiveSeason: no seasons exist — run pnpm db:seed first');
  }
  await prisma.season.update({
    where: { id: firstSeason.id },
    data: { is_active: true },
  });
  return firstSeason.id;
}

// ---------------------------------------------------------------------------
// Tournament helpers
// ---------------------------------------------------------------------------

/**
 * Creates a tournament via POST /api/tournaments.
 * Caller must already be signed in as organizer on the request context.
 * Tournament is created in DRAFT status, then transitioned to OPEN_REGISTRATION
 * and REGISTRATION_CLOSED so it is ready for bracket generation.
 * Returns { id, slug }.
 */
export async function createTournament(
  request: APIRequestContext,
  opts: {
    name: string;
    format: 'SINGLE_ELIMINATION' | 'SWISS' | 'ROUND_ROBIN' | 'DOUBLE_ELIMINATION';
    draft_enabled?: boolean;
    draft_preset_id?: string;
    /**
     * @deprecated Use `rounds_count` instead. Kept for backwards compat —
     *             maps to `rounds_count` in the POST body.
     */
    rounds?: number;
    /** Swiss round count (backend: rounds_count, min 3, max 6). */
    rounds_count?: number;
    /**
     * Array of map IDs (backend-validated cuid strings).
     * Must match existing Map records in the DB (min 3, max 36).
     * Required for tournaments that use /decision/start (map-pick flow).
     */
    map_pool?: string[];
  },
  backendURL = DEFAULT_BACKEND_URL,
): Promise<{ id: string; slug: string }> {
  // Resolve rounds_count: explicit rounds_count wins; fall back to legacy `rounds`.
  const resolvedRoundsCount = opts.rounds_count ?? opts.rounds;

  // Create tournament (DRAFT status)
  const createRes = await request.post(`${backendURL}/api/tournaments`, {
    data: {
      name: opts.name,
      format: opts.format,
      start_date: new Date(Date.now() + 86400_000).toISOString(),
      timezone: 'UTC',
      draft_enabled: opts.draft_enabled ?? false,
      ...(opts.draft_preset_id ? { draft_preset_id: opts.draft_preset_id } : {}),
      ...(resolvedRoundsCount !== undefined ? { rounds_count: resolvedRoundsCount } : {}),
      ...(opts.map_pool !== undefined ? { map_pool: opts.map_pool } : {}),
    },
  });

  if (!createRes.ok()) {
    const body = await createRes.text();
    throw new Error(`createTournament failed: ${createRes.status()} ${body}`);
  }

  const tournament = (await createRes.json()) as { id: string; slug: string };

  // Transition DRAFT → OPEN_REGISTRATION
  const openRes = await request.patch(`${backendURL}/api/tournaments/${tournament.slug}`, {
    data: { status: 'OPEN_REGISTRATION' },
  });
  if (!openRes.ok()) {
    const body = await openRes.text();
    throw new Error(`Transition to OPEN_REGISTRATION failed: ${openRes.status()} ${body}`);
  }

  return { id: tournament.id, slug: tournament.slug };
}

/**
 * Registers each user for the tournament.
 * Each user signs in via their own temporary APIRequestContext.
 * Sequential to avoid race conditions.
 */
export async function registerUsers(
  slug: string,
  users: TestUser[],
  backendURL = DEFAULT_BACKEND_URL,
): Promise<void> {
  const { request: playwrightRequest } = await import('@playwright/test');

  for (const user of users) {
    const ctx = await playwrightRequest.newContext();
    try {
      await signInRequest(ctx, user.id, backendURL);
      const regRes = await ctx.post(`${backendURL}/api/tournaments/${slug}/register`, { data: {} });
      if (!regRes.ok()) {
        const body = await regRes.text();
        throw new Error(`registerUsers: user ${user.id} failed: ${regRes.status()} ${body}`);
      }
    } finally {
      await ctx.dispose();
    }
  }
}

/**
 * Closes registration and generates the bracket.
 * Uses POST /api/tournaments/:id/start (expects REGISTRATION_CLOSED status).
 * First transitions tournament to REGISTRATION_CLOSED, then starts it.
 */
export async function generateBracket(
  request: APIRequestContext,
  slug: string,
  backendURL = DEFAULT_BACKEND_URL,
): Promise<void> {
  // Transition to REGISTRATION_CLOSED
  const closeRes = await request.patch(`${backendURL}/api/tournaments/${slug}`, {
    data: { status: 'REGISTRATION_CLOSED' },
  });
  if (!closeRes.ok()) {
    const body = await closeRes.text();
    throw new Error(`Transition to REGISTRATION_CLOSED failed: ${closeRes.status()} ${body}`);
  }

  // Resolve tournament id for /start endpoint (uses :id not :slug)
  const tournament = await prisma.tournament.findFirst({
    where: { slug },
    select: { id: true },
  });
  if (!tournament) {
    throw new Error(`generateBracket: tournament with slug="${slug}" not found`);
  }

  // Generate bracket (POST /api/tournaments/:id/start)
  const startRes = await request.post(`${backendURL}/api/tournaments/${tournament.id}/start`);
  if (!startRes.ok()) {
    const body = await startRes.text();
    throw new Error(`generateBracket: /start failed: ${startRes.status()} ${body}`);
  }
}

/**
 * Reports a match result via POST /api/matches/:id/result.
 */
export async function reportMatchResult(
  request: APIRequestContext,
  matchId: string,
  opts: {
    winner_id: string | null;
    p1_score?: number;
    p2_score?: number;
    p1_faction_id?: string;
    p2_faction_id?: string;
  },
  backendURL = DEFAULT_BACKEND_URL,
): Promise<void> {
  const score =
    opts.p1_score !== undefined && opts.p2_score !== undefined
      ? `${opts.p1_score}-${opts.p2_score}`
      : undefined;

  const body: Record<string, unknown> = { winnerId: opts.winner_id };
  if (score !== undefined) body['score'] = score;
  if (opts.p1_faction_id !== undefined) body['player1FactionId'] = opts.p1_faction_id;
  if (opts.p2_faction_id !== undefined) body['player2FactionId'] = opts.p2_faction_id;

  const res = await request.post(`${backendURL}/api/matches/${matchId}/result`, {
    data: body,
  });
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`reportMatchResult for match ${matchId} failed: ${res.status()} ${text}`);
  }
}

/**
 * Starts a match via PATCH /api/matches/:id/start.
 * Returns { draftId? } if draft was started.
 */
export async function startMatch(
  request: APIRequestContext,
  matchId: string,
  backendURL = DEFAULT_BACKEND_URL,
): Promise<{ draftId?: string }> {
  const res = await request.patch(`${backendURL}/api/matches/${matchId}/start`);
  if (!res.ok()) {
    const text = await res.text();
    throw new Error(`startMatch for match ${matchId} failed: ${res.status()} ${text}`);
  }
  const json = (await res.json()) as { draft_id?: string | null };
  return { draftId: json.draft_id ?? undefined };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Deletes test data for given user IDs.
 * Cascades through: TournamentParticipant, TournamentResult,
 * LeaderboardEntry, AuditLog (as actor), Matches (as player/winner), User.
 * Idempotent — safe to call multiple times.
 */
export async function cleanupTestData(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;

  // Find tournaments organized by these users
  const organizedTournaments = await prisma.tournament.findMany({
    where: { organizer_id: { in: userIds }, deleted_at: null },
    select: { id: true },
  });
  const tournamentIds = organizedTournaments.map((t) => t.id);

  // Delete in dependency order
  // 1. Matches in organized tournaments
  if (tournamentIds.length > 0) {
    await prisma.match.deleteMany({
      where: { tournament_id: { in: tournamentIds } },
    });
  }

  // 2. TournamentParticipant (both as participant and as entries in organized tournaments)
  await prisma.tournamentParticipant.deleteMany({
    where: {
      OR: [
        { user_id: { in: userIds } },
        ...(tournamentIds.length > 0 ? [{ tournament_id: { in: tournamentIds } }] : []),
      ],
    },
  });

  // 3. TournamentResult
  await prisma.tournamentResult.deleteMany({
    where: { user_id: { in: userIds } },
  });

  // 4. LeaderboardEntry
  await prisma.leaderboardEntry.deleteMany({
    where: { user_id: { in: userIds } },
  });

  // 5. AuditLog (actor)
  await prisma.auditLog.deleteMany({
    where: { actor_id: { in: userIds } },
  });

  // 5b. SteamLink (1:1 with User; cleanup before user delete)
  await prisma.steamLink.deleteMany({
    where: { user_id: { in: userIds } },
  });

  // 6. Tournaments organized by test users
  if (tournamentIds.length > 0) {
    await prisma.tournament.deleteMany({
      where: { id: { in: tournamentIds } },
    });
  }

  // 7. Users
  await prisma.user.deleteMany({
    where: { id: { in: userIds } },
  });
}
