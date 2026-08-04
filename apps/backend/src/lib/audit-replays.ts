// One-shot historical audit: run the full replay verification (factions, map, players, recorded
// time) over every stored game replay and report the discrepancies. Server-side so it can read
// the replay files from disk and use the Steam persona names. Used as a hardening/audit tool.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { PrismaClient } from '@rizzotto/db';
import { REPLAY_DIR } from './replays.js';
import { parseReplayMeta, replayContainsName, attributeFaction } from './replay-parser.js';
import { verifyReplayMeta, type ReplayIssue } from './replay-verify.js';
import { fetchSteamPersonaNames } from './steam.js';

export interface AuditRow {
  matchId: string;
  gameNumber: number;
  player1: string | null;
  player2: string | null;
  issues: ReplayIssue[];
  /** Per-player comparison: reported name/faction vs what the replay shows (attributed). */
  players: Array<{
    reportedName: string | null;
    reportedFaction: string | null;
    /** The player's current Steam persona (what we search the replay for). */
    persona: string | null;
    /** Whether that persona appears in the replay (false ⇒ rename or wrong replay). */
    inReplay: boolean;
    /** Faction attributed to this player IN the replay (nearest faction display to their name). */
    replayFaction: string | null;
  }>;
}

export interface AuditReport {
  checked: number;
  flagged: number;
  skippedNoFile: number;
  byType: Record<string, number>;
  rows: AuditRow[];
}

/** Resolve a stored replay_url (`/uploads/replays/<match>/<file>`) to an on-disk path. */
function replayPath(replayUrl: string): string | null {
  const m = replayUrl.match(/\/uploads\/replays\/(.+)$/);
  return m ? join(REPLAY_DIR, m[1]!) : null;
}

/** Audit up to `limit` COMPLETED games with a replay, newest first. */
export async function auditReplays(prisma: PrismaClient, limit = 5000): Promise<AuditReport> {
  const games = await prisma.matchGame.findMany({
    where: { replay_url: { not: null }, status: 'COMPLETED' },
    orderBy: { played_at: 'desc' },
    take: limit,
    select: {
      game_number: true,
      player1_faction_id: true,
      player2_faction_id: true,
      replay_url: true,
      map_decision: { select: { picked_map_id: true } },
      match: {
        select: {
          id: true,
          created_at: true,
          player1_id: true,
          player2_id: true,
          player1: { select: { username: true } },
          player2: { select: { username: true } },
        },
      },
    },
  });

  // Pre-load Map names + Steam personas once (batched) to avoid per-game round-trips.
  const mapIds = [...new Set(games.map((g) => g.map_decision?.picked_map_id).filter(Boolean) as string[])];
  const maps = await prisma.map.findMany({ where: { id: { in: mapIds } }, select: { id: true, name: true } });
  const mapName = new Map(maps.map((m) => [m.id, m.name]));

  const userIds = [...new Set(games.flatMap((g) => [g.match?.player1_id, g.match?.player2_id]).filter(Boolean) as string[])];
  const links = await prisma.steamLink.findMany({ where: { user_id: { in: userIds } }, select: { user_id: true, steam_id: true } });
  const steamByUser = new Map(links.map((l) => [l.user_id, l.steam_id]));
  const persona = new Map<string, string>();
  const allSteamIds = [...new Set(links.map((l) => l.steam_id))];
  for (let i = 0; i < allSteamIds.length; i += 100) {
    const batch = await fetchSteamPersonaNames(allSteamIds.slice(i, i + 100));
    for (const [k, v] of batch) persona.set(k, v);
  }
  const personaByUser = (uid: string): string | null => {
    const sid = steamByUser.get(uid);
    return sid ? persona.get(sid) ?? null : null;
  };

  const report: AuditReport = { checked: 0, flagged: 0, skippedNoFile: 0, byType: {}, rows: [] };
  for (const g of games) {
    if (!g.match || !g.replay_url) continue;
    const path = replayPath(g.replay_url);
    if (!path) { report.skippedNoFile++; continue; }
    let buf: Buffer;
    try { buf = await readFile(path); } catch { report.skippedNoFile++; continue; }

    const meta = parseReplayMeta(buf);
    const factionSlugs = g.player1_faction_id && g.player2_faction_id ? [g.player1_faction_id, g.player2_faction_id] : [];

    // Per-player comparison (aligned to match player1/player2): reported vs replay.
    const sides = [
      { uid: g.match.player1_id, name: g.match.player1?.username ?? null, reportedFaction: g.player1_faction_id },
      { uid: g.match.player2_id, name: g.match.player2?.username ?? null, reportedFaction: g.player2_faction_id },
    ];
    const players = sides.map((s) => {
      const pers = s.uid ? personaByUser(s.uid) : null;
      const inReplay = pers ? replayContainsName(buf, pers) : false;
      return {
        reportedName: s.name,
        reportedFaction: s.reportedFaction,
        persona: pers,
        inReplay,
        replayFaction: inReplay && pers ? attributeFaction(buf, pers) : null,
      };
    });
    const steamPersonaNames = players.map((p) => p.persona).filter(Boolean) as string[];

    const v = verifyReplayMeta(meta, (name) => replayContainsName(buf, name), {
      factionSlugs,
      mapName: g.map_decision?.picked_map_id ? mapName.get(g.map_decision.picked_map_id) ?? null : null,
      matchCreatedAt: g.match.created_at,
      steamPersonaNames,
    });
    report.checked++;
    if (!v.ok) {
      report.flagged++;
      for (const iss of v.issues) report.byType[iss.type] = (report.byType[iss.type] ?? 0) + 1;
      report.rows.push({
        matchId: g.match.id,
        gameNumber: g.game_number,
        player1: g.match.player1?.username ?? null,
        player2: g.match.player2?.username ?? null,
        issues: v.issues,
        players,
      });
    }
  }
  return report;
}
