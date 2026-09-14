/**
 * Ingest the REAL production games into this LOCAL gs-history instance via the public API.
 * Source: GET https://rizzotto.gg/api/meta/games (already the leaderboard-eligible, non-deleted set).
 * Purely read-only against prod; writes only to the local tww3_gshistory DB. Idempotent
 * (createMany skipDuplicates by id). Prod has no 2v2/teams yet → every competitor is a User (1v1).
 *
 * Run: DATABASE_URL=<gshistory> pnpm -F @rizzotto/backend exec tsx scripts/ingest-prod-games.ts
 */
import { prisma } from '@rizzotto/db';

const BASE = 'https://rizzotto.gg';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const LIMIT = 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface FeedPlayer { id: string; username: string; avatar_url: string | null }
interface FeedGame {
  id: string; matchId: string; gameNumber: number;
  player1: FeedPlayer | null; player2: FeedPlayer | null;
  winnerId: string | null;
  player1FactionId: string | null; player2FactionId: string | null;
  playedAt: string | null; countsForLeaderboard: boolean;
  round: number; matchNumber: number; matchSource: string | null; tournament: unknown;
}

async function fetchPage(page: number): Promise<{ total: number; games: FeedGame[] }> {
  const res = await fetch(`${BASE}/api/meta/games?page=${page}&limit=${LIMIT}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`meta/games page ${page} → ${res.status}`);
  return res.json() as Promise<{ total: number; games: FeedGame[] }>;
}

async function fetchAll(): Promise<FeedGame[]> {
  const first = await fetchPage(1);
  const total = first.total;
  const pages = Math.ceil(total / LIMIT);
  const all: FeedGame[] = [...first.games];
  for (let p = 2; p <= pages; p++) {
    const r = await fetchPage(p);
    all.push(...r.games);
    process.stdout.write(`\r  fetched page ${p}/${pages} (${all.length}/${total})   `);
    await sleep(150);
  }
  process.stdout.write('\n');
  if (all.length !== total) console.warn(`  WARN: fetched ${all.length} != total ${total}`);
  return all;
}

async function chunkCreate(model: 'user' | 'match' | 'matchGame', rows: unknown[]): Promise<void> {
  const SIZE = 1000;
  let done = 0;
  for (let i = 0; i < rows.length; i += SIZE) {
    const chunk = rows.slice(i, i + SIZE);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = await (prisma as any)[model].createMany({ data: chunk, skipDuplicates: true });
    done += r.count;
  }
  console.log(`  ${model}: ${done} inserted (of ${rows.length} candidates; existing skipped)`);
}

async function main(): Promise<void> {
  console.log('Ingesting production games into the local gs-history DB…');
  const version = await prisma.gameVersion.findFirst({ where: { is_active: true }, select: { id: true } });
  const versionId = version?.id ?? null;
  console.log('local version_id for matches:', versionId);

  const games = await fetchAll();
  console.log(`fetched ${games.length} games`);

  // Users — every distinct competitor (all users on prod: no 2v2 yet).
  const usersById = new Map<string, FeedPlayer>();
  for (const g of games) for (const p of [g.player1, g.player2]) if (p?.id) usersById.set(p.id, p);
  await chunkCreate('user', [...usersById.values()].map((p) => ({
    id: p.id,
    discord_id: `imported-${p.id}`,
    username: p.username ?? p.id.slice(0, 8),
    avatar_url: p.avatar_url ?? null,
  })));

  // Matches — one per matchId (Bo3 shares a matchId). Opaque competitor ids (no FK). Tournament
  // membership is irrelevant to the GS fit (eligibleStatGameWhere ignores match.type/tournament).
  const matchById = new Map<string, {
    id: string; type: string; source: string | null; round: number; match_number: number;
    player1_id: string; player2_id: string; winner_id: string | null; status: string;
    version_id: string | null; played_at: Date | null; counts_for_leaderboard: boolean;
    tournament_id: null; deleted_at: null;
  }>();
  let skippedNoPlayers = 0;
  for (const g of games) {
    if (!g.matchId || !g.player1?.id || !g.player2?.id) { skippedNoPlayers++; continue; }
    const played = g.playedAt ? new Date(g.playedAt) : null;
    const cur = matchById.get(g.matchId);
    if (!cur) {
      matchById.set(g.matchId, {
        id: g.matchId, type: 'OPEN_PLAY', source: g.matchSource ?? null,
        round: g.round ?? 0, match_number: g.matchNumber ?? 0,
        player1_id: g.player1.id, player2_id: g.player2.id, winner_id: g.winnerId ?? null,
        status: 'COMPLETED', version_id: versionId, played_at: played,
        counts_for_leaderboard: g.countsForLeaderboard ?? true, tournament_id: null, deleted_at: null,
      });
    } else if (played && (!cur.played_at || played > cur.played_at)) {
      cur.played_at = played;
    }
  }
  await chunkCreate('match', [...matchById.values()]);

  // MatchGames — the statistical unit the fit reads (faction + winner per battle).
  const validMatchIds = new Set(matchById.keys());
  const gameRows = games
    .filter((g) => g.matchId && validMatchIds.has(g.matchId))
    .map((g) => ({
      id: g.id, match_id: g.matchId, game_number: g.gameNumber ?? 1, battle_type: 'DOMINATION',
      status: 'COMPLETED', winner_id: g.winnerId ?? null,
      player1_faction_id: g.player1FactionId ?? null, player2_faction_id: g.player2FactionId ?? null,
      played_at: g.playedAt ? new Date(g.playedAt) : null,
      counts_for_leaderboard: g.countsForLeaderboard ?? true,
    }));
  await chunkCreate('matchGame', gameRows);

  const [uCount, mCount, gCount, decisive] = await Promise.all([
    prisma.user.count(),
    prisma.match.count(),
    prisma.matchGame.count(),
    prisma.matchGame.count({ where: { winner_id: { not: null }, player1_faction_id: { not: null }, player2_faction_id: { not: null } } }),
  ]);
  console.log('\n=== IMPORT SUMMARY ===');
  console.log(`feed games:        ${games.length}`);
  console.log(`skipped (no both players): ${skippedNoPlayers}`);
  console.log(`users:             ${uCount}`);
  console.log(`matches:           ${mCount}`);
  console.log(`match games:       ${gCount}`);
  console.log(`decisive+attributed games (fit input): ${decisive}`);
  await prisma.$disconnect();
}

main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
