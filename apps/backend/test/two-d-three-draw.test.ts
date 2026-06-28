/**
 * 2D3 (TWO_D_THREE) per-game faction draw.
 *
 * Verifies that creating a MatchGame in a TWO_D_THREE tournament draws one faction
 * per player from their registered 3-faction pool (TournamentParticipant.faction_ids)
 * and writes it onto the game — so it shows on the game tile before the game is played.
 *
 * Hermetic: creates randomUUID entities and cleans up only those.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@rizzotto/db';
import { ensureMatchGame } from '../src/lib/match-games.js';
import {
  createTestUser,
  createTestTournament,
  type TestUser,
  type TestTournament,
} from './helpers/db-fixtures.js';

describe('2D3 — per-game faction draw (ensureMatchGame)', () => {
  let p1: TestUser;
  let p2: TestUser;
  let tournament: TestTournament;
  let matchId: string;
  let p1Pool: string[];
  let p2Pool: string[];

  beforeAll(async () => {
    p1 = await createTestUser();
    p2 = await createTestUser();
    tournament = await createTestTournament({ organizerId: p1.id });
    await prisma.tournament.update({
      where: { id: tournament.id },
      data: { mode: 'TWO_D_THREE' },
    });

    // Real seeded factions so MatchGame.player*_faction_id FK is satisfied.
    const factions = await prisma.faction.findMany({ take: 6, select: { id: true } });
    if (factions.length < 6) throw new Error('Test requires >=6 seeded factions');
    p1Pool = factions.slice(0, 3).map((f) => f.id);
    p2Pool = factions.slice(3, 6).map((f) => f.id);

    await prisma.tournamentParticipant.create({
      data: { tournament_id: tournament.id, user_id: p1.id, faction_ids: p1Pool, status: 'CHECKED_IN' },
    });
    await prisma.tournamentParticipant.create({
      data: { tournament_id: tournament.id, user_id: p2.id, faction_ids: p2Pool, status: 'CHECKED_IN' },
    });

    const match = await prisma.match.create({
      data: {
        tournament_id: tournament.id,
        round: 1,
        match_number: 1,
        player1_id: p1.id,
        player2_id: p2.id,
        status: 'PENDING',
      },
      select: { id: true },
    });
    matchId = match.id;
  });

  afterAll(async () => {
    await prisma.matchGame.deleteMany({ where: { match_id: matchId } });
    await prisma.match.deleteMany({ where: { tournament_id: tournament.id } });
    await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: tournament.id } });
    await prisma.tournament.deleteMany({ where: { id: tournament.id } });
    await prisma.user.deleteMany({ where: { id: { in: [p1.id, p2.id] } } });
  });

  it('draws one faction per player from their pool on every game creation', async () => {
    const p1Drawn = new Set<string>();
    const p2Drawn = new Set<string>();

    for (let n = 1; n <= 20; n++) {
      const gameId = await ensureMatchGame(prisma, matchId, n);
      const game = await prisma.matchGame.findUnique({
        where: { id: gameId },
        select: { player1_faction_id: true, player2_faction_id: true },
      });
      expect(game?.player1_faction_id).not.toBeNull();
      expect(game?.player2_faction_id).not.toBeNull();
      expect(p1Pool).toContain(game!.player1_faction_id);
      expect(p2Pool).toContain(game!.player2_faction_id);
      if (game?.player1_faction_id) p1Drawn.add(game.player1_faction_id);
      if (game?.player2_faction_id) p2Drawn.add(game.player2_faction_id);
    }

    // Over 20 draws from a 3-faction pool the result varies (not all identical).
    // P(all 20 identical) = (1/3)^19 ≈ 1e-9 — safe against flakiness.
    expect(p1Drawn.size).toBeGreaterThan(1);
    expect(p2Drawn.size).toBeGreaterThan(1);
  });

  it('is idempotent — re-ensuring an existing game does not redraw', async () => {
    const gameId = await ensureMatchGame(prisma, matchId, 1);
    const before = await prisma.matchGame.findUnique({
      where: { id: gameId },
      select: { player1_faction_id: true, player2_faction_id: true },
    });

    const again = await ensureMatchGame(prisma, matchId, 1);
    expect(again).toBe(gameId);

    const after = await prisma.matchGame.findUnique({
      where: { id: gameId },
      select: { player1_faction_id: true, player2_faction_id: true },
    });
    expect(after).toEqual(before);
  });
});
