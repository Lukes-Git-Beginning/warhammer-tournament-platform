/**
 * Hermetic test fixture helpers.
 *
 * Each helper creates entities with randomUUID() IDs/discord_ids so multiple
 * test runs never collide. Cleanup is always scoped to the generated IDs —
 * no global updateMany that would corrupt seed data.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@rizzotto/db';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TestUser {
  id: string;
  discord_id: string;
  username: string;
}

export interface TestVersion {
  id: string;
  name: string;
}

export interface TestTournament {
  id: string;
  slug: string;
}

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

export async function createTestUser(overrides?: { username?: string }): Promise<TestUser> {
  const id = randomUUID();
  const discord_id = `test-disc-${id}`;
  const username = overrides?.username ?? `test-user-${id.slice(0, 8)}`;

  await prisma.user.create({
    data: { id, discord_id, username, email: null },
  });

  return { id, discord_id, username };
}

export async function createTestVersion(overrides?: { is_active?: boolean }): Promise<TestVersion> {
  const id = randomUUID();
  const name = `test-version-${id}`;

  await prisma.gameVersion.create({
    data: {
      id,
      name,
      start_date: new Date('2026-01-01'),
      end_date: new Date('2026-12-31'),
      is_active: overrides?.is_active ?? true,
    },
  });

  return { id, name };
}

export async function createTestTournament(opts: {
  organizerId: string;
  slug?: string;
}): Promise<TestTournament> {
  const id = randomUUID();
  const slug = opts.slug ?? `test-tournament-${id}`;

  await prisma.tournament.create({
    data: {
      id,
      slug,
      name: `Test Tournament ${id.slice(0, 8)}`,
      host_id: opts.organizerId,
      format: 'SWISS',
      status: 'ONGOING',
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
    },
  });

  return { id, slug };
}

// ---------------------------------------------------------------------------
// Cleanup helpers
// ---------------------------------------------------------------------------

/**
 * Delete all test data associated with a version (cascade-ordered).
 * Does NOT touch any other versions — never calls updateMany on is_active.
 */
export async function cleanupVersion(versionId: string): Promise<void> {
  await prisma.factionStatsSnapshot.deleteMany({ where: { version_id: versionId } });
  await prisma.matchupStats.deleteMany({ where: { version_id: versionId } });
  await prisma.factionStats.deleteMany({ where: { version_id: versionId } });
  await prisma.leaderboardEntry.deleteMany({ where: { version_id: versionId } });
  await prisma.tournamentResult.deleteMany({ where: { version_id: versionId } });
  // GameVersion itself — cascades remaining relations
  await prisma.gameVersion.deleteMany({ where: { id: versionId } });
}

/**
 * Delete all test data associated with a tournament (cascade-ordered).
 */
export async function cleanupTournament(tournamentId: string): Promise<void> {
  await prisma.auditLog.deleteMany({ where: { entity_type: 'Match' } });
  await prisma.match.deleteMany({ where: { tournament_id: tournamentId } });
  await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: tournamentId } });
  await prisma.tournamentResult.deleteMany({ where: { tournament_id: tournamentId } });
  await prisma.tournament.deleteMany({ where: { id: tournamentId } });
}

/**
 * Delete test users by their IDs.
 * Must clean up all FK-referenced child rows first (Welle-2 tables).
 */
export async function cleanupUsers(userIds: string[]): Promise<void> {
  // FK-referenced child rows on user_id (no Cascade on User delete)
  await prisma.steamLink.deleteMany({ where: { user_id: { in: userIds } } });
  await prisma.tournamentArmyList.deleteMany({ where: { user_id: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}
