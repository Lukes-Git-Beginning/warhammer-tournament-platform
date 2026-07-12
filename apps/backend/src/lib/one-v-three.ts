import { randomBytes, randomInt } from 'node:crypto';
import type { PrismaClient } from '@rizzotto/db';

export interface OneVThreeDecision {
  game_id: string;
  top_player_id: string; // Runner — plays the host-set faction
  bottom_player_id: string; // Picker — offers 3
}

/**
 * 1v3 mode ("Set Faction vs. One of Three Counterpicks").
 *
 * Idempotently establishes the coin-flip roles for the ACTIVE game of a 1v3 match
 * by materializing a MatchFactionMatrix row (reusing the Free-Pick machinery):
 *   - top_player_id    = Runner (plays the tournament's set_faction_id)
 *   - bottom_player_id = Picker (offers 3 counter-picks)
 *   - the Runner's factions side is seeded with [set_faction_id]; the Picker's is
 *     left empty until they offer.
 *
 * Role rule (fairness): game N odd → fresh coin flip; N even → swap of game N-1's
 * runner. So within a BO3 the role alternates flip / swap / fresh-flip.
 *
 * Returns the decision (created or pre-existing), or null if the match is not a
 * 1v3 match, has no set faction, or has no active game with a map decision yet.
 * Never re-flips an existing game's roles.
 */
export async function ensureOneVThreeDecision(
  prisma: PrismaClient,
  matchId: string,
): Promise<OneVThreeDecision | null> {
  const match = await prisma.match.findFirst({
    where: { id: matchId, deleted_at: null },
    select: {
      id: true,
      player1_id: true,
      player2_id: true,
      tournament: { select: { mode: true, set_faction_id: true } },
      games: {
        orderBy: { game_number: 'asc' },
        select: {
          id: true,
          game_number: true,
          map_decision: { select: { game_id: true } },
          faction_matrix: { select: { game_id: true, top_player_id: true, bottom_player_id: true } },
        },
      },
    },
  });

  if (!match || match.tournament?.mode !== 'ONE_V_THREE') return null;
  const setFaction = match.tournament.set_faction_id;
  const p1 = match.player1_id;
  const p2 = match.player2_id;
  if (!setFaction || !p1 || !p2) return null;

  // Active game = the latest game that already has a map decision (faction phase
  // begins once the battlefield is chosen).
  const withMap = match.games.filter((g) => g.map_decision);
  const active = withMap[withMap.length - 1];
  if (!active) return null;

  // Already initialized → never re-flip.
  if (active.faction_matrix) {
    return {
      game_id: active.faction_matrix.game_id,
      top_player_id: active.faction_matrix.top_player_id,
      bottom_player_id: active.faction_matrix.bottom_player_id,
    };
  }

  // Determine the Runner for this game.
  let runnerId: string;
  if (active.game_number % 2 === 0) {
    const prev = match.games.find((g) => g.game_number === active.game_number - 1);
    const prevRunner = prev?.faction_matrix?.top_player_id ?? null;
    runnerId = prevRunner === p1 ? p2 : prevRunner === p2 ? p1 : randomInt(2) === 0 ? p1 : p2;
  } else {
    runnerId = randomInt(2) === 0 ? p1 : p2;
  }
  const pickerId = runnerId === p1 ? p2 : p1;
  const runnerIsP1 = runnerId === p1;

  // Reuse MatchFactionMatrix: the Runner's side holds just [set faction] (index 0),
  // the Picker's side is filled when they offer. picked_cell then resolves both.
  const sides = runnerIsP1
    ? { p1_factions: [setFaction], p2_factions: [] as string[] }
    : { p1_factions: [] as string[], p2_factions: [setFaction] };

  // upsert (not create) to survive the race where two concurrent reads both try to
  // initialize the same game — the second one's empty update keeps the first's flip.
  const rec = await prisma.matchFactionMatrix.upsert({
    where: { game_id: active.id },
    create: {
      game_id: active.id,
      ...sides,
      top_player_id: runnerId,
      bottom_player_id: pickerId,
      coin_flip_seed: randomBytes(8).toString('hex'),
      last_action_at: new Date(),
    },
    update: {},
    select: { game_id: true, top_player_id: true, bottom_player_id: true },
  });

  return { game_id: rec.game_id, top_player_id: rec.top_player_id, bottom_player_id: rec.bottom_player_id };
}
