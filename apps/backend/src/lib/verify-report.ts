// Report-time bridge: assemble the "expected game" from the DB and verify an uploaded replay
// against it. Fail-open — any lookup gap simply drops that signal (never blocks a report).

import type { PrismaClient } from '@rizzotto/db';
import { verifyReplay, type ReplayVerification } from './replay-verify.js';
import { fetchSteamPersonaNames } from './steam.js';

/** Verify a just-uploaded replay for a game against its reported factions / map / time / players. */
export async function verifyGameReplay(
  prisma: PrismaClient,
  gameId: string,
  buffer: Buffer,
): Promise<ReplayVerification> {
  const game = await prisma.matchGame.findUnique({
    where: { id: gameId },
    select: {
      player1_faction_id: true,
      player2_faction_id: true,
      map_decision: { select: { picked_map_id: true } },
      match: {
        select: {
          created_at: true,
          player1_id: true,
          player2_id: true,
        },
      },
    },
  });
  if (!game || !game.match) return { ok: true, issues: [] };

  // Reported map name (picked_map_id references Map.id; no relation defined → separate lookup).
  const pickedMapId = game.map_decision?.picked_map_id ?? null;
  const mapName = pickedMapId
    ? (await prisma.map.findUnique({ where: { id: pickedMapId }, select: { name: true } }))?.name ?? null
    : null;

  // Reported factions — only usable when both are set (SFT-latched / already picked). Null → the
  // faction signal is skipped inside verifyReplay.
  const factionSlugs =
    game.player1_faction_id && game.player2_faction_id
      ? [game.player1_faction_id, game.player2_faction_id]
      : [];

  // Steam persona names for the two participants (for the player-presence check).
  const steamIds: string[] = [];
  for (const uid of [game.match.player1_id, game.match.player2_id]) {
    if (!uid) continue;
    const link = await prisma.steamLink.findFirst({ where: { user_id: uid }, select: { steam_id: true } });
    if (link?.steam_id) steamIds.push(link.steam_id);
  }
  const personaMap = await fetchSteamPersonaNames(steamIds);
  const steamPersonaNames = [...personaMap.values()];

  return verifyReplay(buffer, {
    factionSlugs,
    mapName,
    matchCreatedAt: game.match.created_at,
    steamPersonaNames,
  });
}
