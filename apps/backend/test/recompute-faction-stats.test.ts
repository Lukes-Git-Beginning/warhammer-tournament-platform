import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { prisma } from '@rizzotto/db';
import { recomputeFactionStats } from '../src/lib/recompute-faction-stats.js';
import {
  createTestUser,
  createTestVersion,
  createTestTournament,
  cleanupVersion,
  cleanupTournament,
  cleanupUsers,
  type TestUser,
  type TestVersion,
  type TestTournament,
} from './helpers/db-fixtures.js';

const EMPIRE = 'empire';
const BRETONNIA = 'bretonnia';

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

let user1: TestUser | undefined;
let user2: TestUser | undefined;
let version: TestVersion | undefined;
let tournament: TestTournament | undefined;

beforeEach(async () => {
  user1 = await createTestUser({ username: 'EmpirePlayer' });
  user2 = await createTestUser({ username: 'BretonniaPlayer' });
  version = await createTestVersion({ is_active: true });
  tournament = await createTestTournament({ organizerId: user1!.id });
});

afterEach(async () => {
  if (tournament) await cleanupTournament(tournament.id);
  if (version) await cleanupVersion(version.id);
  const ids = [user1?.id, user2?.id].filter(Boolean) as string[];
  if (ids.length > 0) await cleanupUsers(ids);
  user1 = user2 = undefined;
  version = tournament = undefined;
});

/**
 * Creates one Match (empire vs bretonnia) plus N COMPLETED games with the given
 * winners. `winners[i]` is the winning user id for game i+1, or null for a draw.
 */
async function createMatchWithGames(winners: (string | null)[]): Promise<string> {
  const matchId = randomUUID();
  await prisma.match.create({
    data: {
      id: matchId,
      tournament_id: tournament!.id,
      version_id: version!.id,
      round: 1,
      match_number: 1,
      player1_id: user1!.id,
      player2_id: user2!.id,
      player1_faction_id: EMPIRE,
      player2_faction_id: BRETONNIA,
      status: 'COMPLETED',
    },
  });
  await prisma.matchGame.createMany({
    data: winners.map((winnerId, i) => ({
      match_id: matchId,
      game_number: i + 1,
      status: 'COMPLETED' as const,
      winner_id: winnerId,
      player1_faction_id: EMPIRE,
      player2_faction_id: BRETONNIA,
    })),
  });
  return matchId;
}

const factionStats = (factionId: string) =>
  prisma.factionStats.findUnique({
    where: { faction_id_version_id_battle_type: { faction_id: factionId, version_id: version!.id, battle_type: 'DOMINATION' } },
  });

const matchupStats = () =>
  prisma.matchupStats.findUnique({
    // sort(['empire','bretonnia']) → ['bretonnia','empire'] → a=bretonnia, b=empire
    where: {
      faction_a_id_faction_b_id_version_id_battle_type: {
        faction_a_id: BRETONNIA,
        faction_b_id: EMPIRE,
        version_id: version!.id,
        battle_type: 'DOMINATION',
      },
    },
  });

describe('recomputeFactionStats', () => {
  it('rebuilds GAME-level stats from MatchGame records (Bo3 = 3 observations, not 1)', async () => {
    // empire wins games 1 & 2, bretonnia wins game 3 → 2-1 at game level
    await createMatchWithGames([user1!.id, user1!.id, user2!.id]);

    const result = await recomputeFactionStats(prisma, version!.id);
    expect(result.gamesProcessed).toBe(3);

    const empire = await factionStats(EMPIRE);
    const bret = await factionStats(BRETONNIA);

    // matches_played column now holds the GAME count — 3, not the single match
    expect(empire!.matches_played).toBe(3);
    expect(empire!.wins).toBe(2);
    expect(empire!.losses).toBe(1);
    expect(empire!.draws).toBe(0);
    expect(empire!.pick_count).toBe(3);

    expect(bret!.matches_played).toBe(3);
    expect(bret!.wins).toBe(1);
    expect(bret!.losses).toBe(2);

    const matchup = await matchupStats();
    expect(matchup!.faction_b_wins).toBe(2); // empire is b
    expect(matchup!.faction_a_wins).toBe(1); // bretonnia is a
    expect(matchup!.draws).toBe(0);
  });

  it('is idempotent — running twice does not double-count', async () => {
    await createMatchWithGames([user1!.id, user2!.id]);

    await recomputeFactionStats(prisma, version!.id);
    await recomputeFactionStats(prisma, version!.id);

    const empire = await factionStats(EMPIRE);
    expect(empire!.matches_played).toBe(2);
    expect(empire!.wins).toBe(1);
    expect(empire!.losses).toBe(1);

    const matchup = await matchupStats();
    expect(matchup!.faction_a_wins).toBe(1);
    expect(matchup!.faction_b_wins).toBe(1);
  });

  it('treats a COMPLETED game with no winner as a draw', async () => {
    await createMatchWithGames([null]);

    await recomputeFactionStats(prisma, version!.id);

    const empire = await factionStats(EMPIRE);
    expect(empire!.matches_played).toBe(1);
    expect(empire!.wins).toBe(0);
    expect(empire!.losses).toBe(0);
    expect(empire!.draws).toBe(1);

    const matchup = await matchupStats();
    expect(matchup!.draws).toBe(1);
    expect(matchup!.faction_a_wins).toBe(0);
    expect(matchup!.faction_b_wins).toBe(0);
  });
});

