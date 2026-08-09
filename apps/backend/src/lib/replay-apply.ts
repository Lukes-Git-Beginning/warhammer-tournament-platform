// Resolve a game's uploaded replay into the values to APPLY in the player-driven dispute flow: the
// factions each participant actually fielded (ESF tree walk) + the map, attributed to player1/player2.
// See plans/replay-dispute-player-resolution.md. Faction ids in this codebase ARE the slugs, so the
// attributed slug is written straight to player{1,2}_faction_id; only the map needs a name→id lookup.

import type { PrismaClient } from '@rizzotto/db';
import { extractReplayPlayers, parseReplayMeta, type ReplayPlayer } from './replay-parser.js';
import { mapNameFromTerrain } from './replay-maps.js';
import { normName, diffIsChaosGodOnly } from './replay-verify.js';
import { fetchSteamPersonaNames } from './steam.js';

export interface AttributedFactions {
  player1FactionSlug: string | null;
  player2FactionSlug: string | null;
  /** Attribution is unreliable (a participant didn't match a replay player, a faction is missing, or
   *  the diff vs the report is entirely within the Chaos-god family) — the flow escalates these to
   *  host review instead of asking the opponent to confirm. */
  ambiguous: boolean;
}

/** Match each participant to a replay player by normalised name, then read that player's faction. Pure. */
export function attributeReplayFactions(
  replayPlayers: ReplayPlayer[],
  player1Name: string | null,
  player2Name: string | null,
  reportedSlugs: string[],
): AttributedFactions {
  const match = (name: string | null, exclude?: ReplayPlayer): ReplayPlayer | undefined => {
    if (!name) return undefined;
    const n = normName(name);
    if (n.length === 0) return undefined;
    return replayPlayers.find(
      (rp) =>
        rp !== exclude &&
        (normName(rp.name) === n || normName(rp.name).includes(n) || n.includes(normName(rp.name))),
    );
  };
  const rp1 = match(player1Name);
  const rp2 = match(player2Name, rp1);
  const player1FactionSlug = rp1?.faction ?? null;
  const player2FactionSlug = rp2?.faction ?? null;
  let ambiguous = !rp1 || !rp2 || !player1FactionSlug || !player2FactionSlug;
  if (!ambiguous && reportedSlugs.length === 2) {
    // A diff entirely within the Chaos-god family can't be reliably attributed → host review.
    if (diffIsChaosGodOnly([player1FactionSlug!, player2FactionSlug!], reportedSlugs)) ambiguous = true;
  }
  return { player1FactionSlug, player2FactionSlug, ambiguous };
}

export interface ReplayValues extends AttributedFactions {
  mapName: string | null;
  mapId: string | null;
}

/**
 * Full DB-integrated resolution of a game's uploaded replay into applicable values (factions + map),
 * attributed to the two participants. Fail-open: a parse/lookup gap yields ambiguous=true (→ host
 * review), never throws.
 */
export async function resolveReplayValues(
  prisma: PrismaClient,
  buffer: Buffer,
  args: { player1Id: string | null; player2Id: string | null; reportedSlugs: string[] },
): Promise<ReplayValues> {
  try {
    const replayPlayers = extractReplayPlayers(buffer);
    const meta = parseReplayMeta(buffer);
    const mapName = mapNameFromTerrain(meta.mapTerrain);
    const mapId = mapName
      ? ((await prisma.map.findFirst({ where: { name: mapName }, select: { id: true } }))?.id ?? null)
      : null;

    // Each participant's current Steam persona name — what the replay records.
    const nameOf = async (uid: string | null): Promise<string | null> => {
      if (!uid) return null;
      const link = await prisma.steamLink.findFirst({ where: { user_id: uid }, select: { steam_id: true } });
      if (!link?.steam_id) return null;
      const personas = await fetchSteamPersonaNames([link.steam_id]);
      return personas.get(link.steam_id) ?? null;
    };
    const [p1Name, p2Name] = await Promise.all([nameOf(args.player1Id), nameOf(args.player2Id)]);

    const attr = attributeReplayFactions(replayPlayers, p1Name, p2Name, args.reportedSlugs);
    return { ...attr, mapName, mapId };
  } catch {
    return { player1FactionSlug: null, player2FactionSlug: null, ambiguous: true, mapName: null, mapId: null };
  }
}
