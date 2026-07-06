import type { FastifyInstance } from 'fastify';
import { randomBytes, randomInt } from 'node:crypto';

const BLIND_TIMEOUT_MS = 2 * 60 * 1000;   // 2 min for blind faction picks
const BAN_TIMEOUT_MS = 30 * 1000;          // 30s per ban/pick action (all bans + the final pick)
const FIRST_BAN_TIMEOUT_MS = 30 * 1000;    // 30s for the very first ban (same as the rest now)

function cellKey(row: number, col: number): string {
  return `${row},${col}`;
}

function allCells(): string[] {
  const cells: string[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      cells.push(cellKey(r, c));
    }
  }
  return cells;
}

function matchDecisionRoom(matchId: string): string {
  return `match_decision_${matchId}`;
}

function emitUpdate(fastify: FastifyInstance, matchId: string, matrix: {
  p1_locked_at: Date | null;
  p2_locked_at: Date | null;
  first_locked_at: Date | null;
  revealed_at: Date | null;
  top_player_id: string;
  bottom_player_id: string;
  p1_factions: unknown;
  p2_factions: unknown;
  bans: unknown;
  picked_cell: string | null;
  last_action_at: Date | null;
  decided_at: Date | null;
}): void {
  const room = matchDecisionRoom(matchId);
  const p1Factions = matrix.p1_factions as string[];
  const p2Factions = matrix.p2_factions as string[];
  const pickedRow = matrix.picked_cell ? Number(matrix.picked_cell.split(',')[0]) : null;
  const pickedCol = matrix.picked_cell ? Number(matrix.picked_cell.split(',')[1]) : null;

  fastify.io?.to(room).emit('match.matrix.update', {
    matchId,
    p1Locked: Boolean(matrix.p1_locked_at),
    p2Locked: Boolean(matrix.p2_locked_at),
    firstLockedAt: matrix.first_locked_at?.toISOString() ?? null,
    revealedAt: matrix.revealed_at?.toISOString() ?? null,
    p1Factions: matrix.revealed_at ? p1Factions : [],
    p2Factions: matrix.revealed_at ? p2Factions : [],
    bans: (matrix.bans as string[]) ?? [],
    pickedCell: matrix.picked_cell,
    lastActionAt: matrix.last_action_at?.toISOString() ?? null,
    decidedAt: matrix.decided_at?.toISOString() ?? null,
    p1FactionId: matrix.decided_at && pickedRow !== null ? (p1Factions[pickedRow] ?? null) : null,
    p2FactionId: matrix.decided_at && pickedCol !== null ? (p2Factions[pickedCol] ?? null) : null,
    topPlayerId: matrix.top_player_id,
    bottomPlayerId: matrix.bottom_player_id,
  });
}

/**
 * Scans for stale matrix actions and auto-resolves them:
 * Phase 1 — Blind-pick timeout (2 min): one player locked but opponent hasn't.
 * Phase 2 — Ban/pick timeout: 30s for the first ban, 15s for all subsequent bans/pick.
 * Called every 15 seconds by the cron plugin.
 */
export async function autoResolveStaleMatrixActions(fastify: FastifyInstance): Promise<number> {
  const now = new Date();
  const cutoffBlind = new Date(now.getTime() - BLIND_TIMEOUT_MS);
  const cutoffBan = new Date(now.getTime() - BAN_TIMEOUT_MS);
  const cutoffFirstBan = new Date(now.getTime() - FIRST_BAN_TIMEOUT_MS);
  let resolved = 0;

  // ---------------------------------------------------------------------------
  // Phase 1: Blind-pick timeout
  // One player locked but opponent hasn't responded within 2 minutes.
  // ---------------------------------------------------------------------------
  const staleBlind = await fastify.prisma.matchFactionMatrix.findMany({
    where: {
      revealed_at: null,
      first_locked_at: { not: null, lt: cutoffBlind },
    },
    include: {
      game: {
        select: {
          id: true,
          match: {
            select: {
              id: true,
              player1_id: true,
              player2_id: true,
              tournament: { select: { faction_allowlist: { select: { faction_id: true } } } },
            },
          },
          map_decision: { select: { picked_map_id: true } },
        },
      },
    },
  });

  const allFactions = await (staleBlind.length > 0
    ? fastify.prisma.faction.findMany({ select: { id: true } })
    : Promise.resolve([]));

  for (const matrix of staleBlind) {
    const p1Locked = Boolean(matrix.p1_locked_at);
    const p2Locked = Boolean(matrix.p2_locked_at);
    if (p1Locked && p2Locked) continue; // both locked, should have revealed — skip

    try {
      // #4: honour the tournament faction allowlist (if any); restricted factions
      // stay pickable. Open Play (no tournament) has no allowlist → full pool.
      const allowlist = matrix.game.match.tournament?.faction_allowlist.map((f) => f.faction_id) ?? [];
      const pool = (allowlist.length > 0 ? allFactions.filter((f) => allowlist.includes(f.id)) : allFactions).map((f) => f.id);
      const existingIds = [...(matrix.p1_factions as string[]), ...(matrix.p2_factions as string[])];
      const available = pool.filter((id) => !existingIds.includes(id));

      const pickRandom3 = (exclude: string[]): string[] => {
        const candidates = pool.filter((id) => !exclude.includes(id));
        const chosen: string[] = [];
        const shuffled = candidates.sort(() => Math.random() - 0.5);
        for (const id of shuffled) {
          if (chosen.length >= 3) break;
          chosen.push(id);
        }
        // Pad with any available if not enough distinct ones
        while (chosen.length < 3 && pool.length > 0) {
          chosen.push(pool[chosen.length % pool.length] as string);
        }
        return chosen;
      };

      const p1Factions = p1Locked ? (matrix.p1_factions as string[]) : pickRandom3([]);
      const p2Factions = p2Locked ? (matrix.p2_factions as string[]) : pickRandom3(p1Factions);

      const seed = randomBytes(16).toString('hex');
      const flip = randomInt(2);
      const match = matrix.game.match;
      const topPlayerId = flip === 0 ? match.player1_id : match.player2_id;
      const bottomPlayerId = flip === 0 ? match.player2_id : match.player1_id;

      const updated = await fastify.prisma.matchFactionMatrix.update({
        where: { game_id: matrix.game_id },
        data: {
          p1_factions: p1Factions,
          p2_factions: p2Factions,
          p1_locked_at: matrix.p1_locked_at ?? now,
          p2_locked_at: matrix.p2_locked_at ?? now,
          coin_flip_seed: seed,
          top_player_id: topPlayerId ?? '',
          bottom_player_id: bottomPlayerId ?? '',
          revealed_at: now,
          last_action_at: now,
        },
      });

      emitUpdate(fastify, match.id, updated);
      resolved++;
    } catch (err) {
      fastify.log.warn({ err, gameId: matrix.game_id }, 'Matrix blind-pick auto-resolve failed');
    }
  }

  // ---------------------------------------------------------------------------
  // Phase 2: Ban/pick timeout
  // Matrix revealed but no action taken within 15 seconds.
  // ---------------------------------------------------------------------------
  const staleBan = await fastify.prisma.matchFactionMatrix.findMany({
    where: {
      revealed_at: { not: null },
      decided_at: null,
      last_action_at: { not: null, lt: cutoffBan },
    },
    include: {
      game: {
        select: {
          id: true,
          match: { select: { id: true } },
          map_decision: { select: { picked_map_id: true } },
        },
      },
    },
  });

  for (const matrix of staleBan) {
    try {
      const bans = (matrix.bans as string[]) ?? [];
      // First ban gets 30s instead of 15s — skip if the longer grace period hasn't elapsed.
      if (bans.length === 0 && matrix.last_action_at! > cutoffFirstBan) continue;
      const remaining = allCells().filter((c) => !bans.includes(c));
      if (remaining.length === 0) continue;

      const isPick = bans.length >= 7;
      const randomCell = remaining[Math.floor(Math.random() * remaining.length)] as string;
      const [row, col] = randomCell.split(',').map(Number);
      const p1Factions = matrix.p1_factions as string[];
      const p2Factions = matrix.p2_factions as string[];

      let updated;
      if (isPick) {
        updated = await fastify.prisma.$transaction(async (tx) => {
          const m = await tx.matchFactionMatrix.update({
            where: { game_id: matrix.game_id },
            data: { picked_cell: randomCell, decided_at: now, last_action_at: now },
          });
          await tx.matchGame.update({
            where: { id: matrix.game.id },
            data: {
              player1_faction_id: p1Factions[row ?? 0] ?? null,
              player2_faction_id: p2Factions[col ?? 0] ?? null,
            },
          });
          return m;
        });
      } else {
        updated = await fastify.prisma.matchFactionMatrix.update({
          where: { game_id: matrix.game_id },
          data: { bans: [...bans, randomCell], last_action_at: now },
        });
      }

      const matchId = matrix.game.match.id;
      emitUpdate(fastify, matchId, updated);

      if (updated.decided_at && matrix.game.map_decision?.picked_map_id) {
        fastify.io?.to(matchDecisionRoom(matchId)).emit('match.decision.complete', {
          matchId,
          pickedMapId: matrix.game.map_decision.picked_map_id,
          decidedAt: updated.decided_at.toISOString(),
        });
      }

      resolved++;
    } catch (err) {
      fastify.log.warn({ err, gameId: matrix.game_id }, 'Matrix ban auto-resolve failed');
    }
  }

  return resolved;
}
