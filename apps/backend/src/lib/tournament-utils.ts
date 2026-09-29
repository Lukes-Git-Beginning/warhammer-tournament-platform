import {
  TournamentStatus,
  type PrismaClient,
  type TournamentFormat,
  type TournamentMode,
  type TournamentVisibility,
  type ParticipantStatus,
  type MatchStatus,
} from '@rizzotto/db';
import type { FastifyInstance } from 'fastify';
import { recordTournamentEvent } from './tournament-events.js';
import { emitBracketUpdate } from './emit.js';

// Re-export enums so routes can import from one place
export {
  TournamentStatus,
  TournamentFormat,
  TournamentMode,
  TournamentVisibility,
  ParticipantStatus,
  MatchStatus,
};

// ---------------------------------------------------------------------------
// Slug generation
// ---------------------------------------------------------------------------

const UMLAUT_MAP: Record<string, string> = {
  ä: 'a',
  ö: 'o',
  ü: 'u',
  Ä: 'a',
  Ö: 'o',
  Ü: 'u',
  ß: 'ss',
  é: 'e',
  è: 'e',
  ê: 'e',
  à: 'a',
  â: 'a',
  ô: 'o',
  î: 'i',
  ï: 'i',
  ù: 'u',
  û: 'u',
  ç: 'c',
  ñ: 'n',
};

/**
 * Generate a URL-safe kebab-case slug from a tournament name.
 * Collision resolution (P2002) is the responsibility of the caller —
 * simply append a numeric suffix and retry.
 */
export function generateSlug(name: string): string {
  let s = name;
  for (const [char, replacement] of Object.entries(UMLAUT_MAP)) {
    s = s.replaceAll(char, replacement);
  }
  return s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // strip non-alphanum except spaces/dashes
    .trim()
    .replace(/[\s_]+/g, '-') // spaces/underscores → dash
    .replace(/-+/g, '-') // collapse multiple dashes
    .replace(/^-+|-+$/g, '') // trim leading/trailing dashes
    .slice(0, 80); // hard cap to keep URLs sane
}

// ---------------------------------------------------------------------------
// Status transition validation
// ---------------------------------------------------------------------------

/**
 * Allowed status transitions for a tournament.
 * DRAFT → OPEN_REGISTRATION → REGISTRATION_CLOSED → ONGOING → COMPLETED.
 * The only permitted backwards step is REGISTRATION_CLOSED → OPEN_REGISTRATION ("reopen
 * registration" — safe pre-start: no matches exist yet), so a host can undo an accidental close.
 */
const ALLOWED_TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
  [TournamentStatus.DRAFT]: [TournamentStatus.OPEN_REGISTRATION],
  [TournamentStatus.OPEN_REGISTRATION]: [TournamentStatus.REGISTRATION_CLOSED],
  [TournamentStatus.REGISTRATION_CLOSED]: [TournamentStatus.ONGOING, TournamentStatus.OPEN_REGISTRATION],
  [TournamentStatus.ONGOING]: [TournamentStatus.COMPLETED],
  [TournamentStatus.COMPLETED]: [],
};

export function validateStatusTransition(
  from: TournamentStatus,
  to: TournamentStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

// ---------------------------------------------------------------------------
// Tournament management permission (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Whether a user may manage a tournament. True for global MODERATOR/ADMIN, for
 * the host, and for any co-host. Every management endpoint should gate on
 * this instead of an inline `host_id === userId` check, so co-hosts get
 * full host parity automatically.
 *
 * NOTE: ownership-control actions (transfer ownership, edit the co-host list)
 * deliberately do NOT use this — they stay host + MODERATOR/ADMIN only.
 */
export async function canManageTournament(
  prisma: PrismaClient,
  tournamentId: string,
  userId: string,
  role: string,
): Promise<boolean> {
  if (role === 'MODERATOR' || role === 'ADMIN') return true;
  // No tournament to manage (e.g. an Open Play match has tournament_id = null,
  // passed in as ''). A non-staff user can never "manage" a non-existent
  // tournament — and querying `findUnique({ id: '' })` throws P2007 because the
  // id column is a UUID. Bail out before the lookup.
  if (!tournamentId) return false;
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { host_id: true, co_hosts: { select: { user_id: true } } },
  });
  if (!t) return false;
  return t.host_id === userId || t.co_hosts.some((h) => h.user_id === userId);
}

// ---------------------------------------------------------------------------
// Balanced Liechtenstein — manual-pairing guard
// ---------------------------------------------------------------------------

/**
 * Balanced Liechtenstein owns its own pairing: the auto-engine derives each player's
 * next round from a completed-match count (byes included). Hand-editing the bracket —
 * filling byes, swapping players, creating/deleting matches, full-reset, backfill —
 * desyncs that count and cascades into phantom byes and a broken bracket (e.g. merging
 * two resting players across a large skill-band gap, which the engine deliberately
 * refuses for fairness). So for BaLi these structure-editing ops are locked: HOST /
 * MODERATOR are refused outright; ADMIN keeps the emergency-repair path but must pass an
 * explicit confirm flag, so it can never be an accidental desync. Every other format is
 * host-driven and unaffected.
 */
export const BALANCED_MANUAL_PAIRING_MESSAGE =
  'Balanced Liechtenstein manages pairings automatically. Manual pairing is disabled here to keep rounds fair and the bracket intact.';

export interface ManualPairingBlock {
  status: number;
  body: { error: string; message: string; statusCode: number };
}

/**
 * Returns `null` if a manual pairing op may proceed, or an error `{status, body}` to
 * send back otherwise. Only gates `BALANCED_LIECHTENSTEIN`; other formats always pass.
 * PURE — unit-testable.
 */
export function blockBalancedManualPairing(
  format: string | null | undefined,
  role: string,
  confirmed: boolean,
): ManualPairingBlock | null {
  if (format !== 'BALANCED_LIECHTENSTEIN') return null;
  if (role !== 'ADMIN') {
    return {
      status: 403,
      body: { error: 'Forbidden', message: BALANCED_MANUAL_PAIRING_MESSAGE, statusCode: 403 },
    };
  }
  if (!confirmed) {
    return {
      status: 409,
      body: {
        error: 'ConfirmationRequired',
        message:
          'Balanced Liechtenstein safety: this manual pairing change can desync the bracket. Re-send with confirmBalancedOverride:true to proceed as admin.',
        statusCode: 409,
      },
    };
  }
  return null;
}

/**
 * Look up the tournament format and apply {@link blockBalancedManualPairing}. Returns
 * `null` to proceed, or an error `{status, body}`. Call right after the manage check in
 * every structure-editing manual pairing endpoint. One tiny lookup per (rare) host action.
 */
export async function guardBalancedManualPairing(
  prisma: PrismaClient,
  tournamentId: string,
  role: string,
  confirmed: boolean,
): Promise<ManualPairingBlock | null> {
  if (!tournamentId) return null;
  const t = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { format: true },
  });
  return blockBalancedManualPairing(t?.format, role, confirmed);
}

// ---------------------------------------------------------------------------
// Late joiner: BYE for a player checked in mid-tournament
// ---------------------------------------------------------------------------

/**
 * When a player is checked in after a Swiss / Auto-Swiss tournament has already
 * started (i.e. at least one Swiss round exists), give them a CATCHUP_BYE in the
 * current (latest) Swiss round. This:
 *   - inserts a match row for them so the round generator folds them into future rounds, and
 *   - awards 0 points (not a scoring BYE) — late joiners earn points only through real wins.
 *
 * No-op unless: tournament is ONGOING, format is SWISS / AUTO_SWISS, a Swiss round
 * already exists, and the player has no match in that round yet. Returns the
 * created CATCHUP_BYE match ({ id, round }) or null when nothing was created.
 * Callers should treat failures as non-fatal — the check-in itself must still succeed.
 */
export async function createLateJoinerBye(
  prisma: PrismaClient,
  tournamentId: string,
  userId: string,
): Promise<{ id: string; round: number } | null> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { status: true, format: true },
  });
  if (!tournament) return null;
  if (tournament.status !== TournamentStatus.ONGOING) return null;
  if (tournament.format !== 'SWISS' && tournament.format !== 'AUTO_SWISS') return null;

  // Current Swiss round = highest existing SWISS-phase round.
  const latest = await prisma.match.aggregate({
    where: { tournament_id: tournamentId, phase: 'SWISS', deleted_at: null },
    _max: { round: true },
  });
  const round = latest._max.round;
  if (round == null) return null; // no Swiss round generated yet

  // Already paired or byed this round → nothing to do.
  const existing = await prisma.match.findFirst({
    where: {
      tournament_id: tournamentId,
      round,
      deleted_at: null,
      OR: [{ player1_id: userId }, { player2_id: userId }],
    },
    select: { id: true },
  });
  if (existing) return null;

  // Next match_number for this round (ignore deleted rows so we don't collide
  // with the [tournament_id, round, match_number] unique constraint).
  const agg = await prisma.match.aggregate({
    where: { tournament_id: tournamentId, round },
    _max: { match_number: true },
  });
  const matchNumber = (agg._max.match_number ?? 0) + 1;

  const match = await prisma.match.create({
    data: {
      tournament_id: tournamentId,
      round,
      match_number: matchNumber,
      player1_id: userId,
      player2_id: null,
      winner_id: null,
      status: 'CATCHUP_BYE',
      phase: 'SWISS',
    },
    select: { id: true, round: true },
  });

  await prisma.auditLog.create({
    data: {
      entity_type: 'Match',
      entity_id: match.id,
      action: 'late_joiner_catchup_bye',
      new_value: { tournamentId, userId, round },
    },
  });

  void recordTournamentEvent({ tournamentId, type: 'match_created', actor: 'system', subjectId: userId, payload: { phase: 'catchup_bye' } });

  return match;
}

/**
 * Reconciler safety net for Swiss / Auto-Swiss byes (Alex 2026-09-27, mirroring the Balanced
 * Liechtenstein reconciler pattern from 2026-08-07). Instead of bolting a bye-fill onto every path
 * that can strand a player (late join, undrop, mid-round drop, forfeit, ...), a single periodic pass
 * reconciles the CURRENT round: any active player who is idle (no live game) is paired against another
 * idle player, reusing an existing bye row where possible, so two players who could face each other
 * never both sit out. Idempotent: once at most one idle player remains (a legitimate odd-count bye) it
 * is a no-op.
 *
 * "Idle" = a CHECKED_IN participant not currently in a live two-player match this round. That covers a
 * bye-holder, a late joiner / returner with no (or only a catch-up-bye) row, and a survivor orphaned
 * by an opponent's withdrawal. Orphaned rows of a re-paired survivor are cancelled. Returns the number
 * of pairing actions taken. SWISS / AUTO_SWISS + ONGOING only.
 */
export async function reconcileSwissByes(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<number> {
  const tournament = await prisma.tournament.findUnique({
    where: { id: tournamentId },
    select: { status: true, format: true },
  });
  if (!tournament || tournament.status !== TournamentStatus.ONGOING) return 0;
  if (tournament.format !== 'SWISS' && tournament.format !== 'AUTO_SWISS') return 0;

  const latest = await prisma.match.aggregate({
    where: { tournament_id: tournamentId, phase: 'SWISS', deleted_at: null },
    _max: { round: true },
  });
  const round = latest._max.round;
  if (round == null) return 0;

  const matches = await prisma.match.findMany({
    where: { tournament_id: tournamentId, round, phase: 'SWISS', deleted_at: null },
    select: { id: true, player1_id: true, player2_id: true, status: true, withdrawn_player_id: true, match_number: true },
  });

  const matched = new Set<string>(); // competitors in a live two-player game
  const byeRowByHolder = new Map<string, string>(); // competitor -> their open (unfilled) bye row id
  const orphanRowsByComp = new Map<string, string[]>(); // survivor -> their orphaned (opponent-withdrew) row ids
  let maxMatchNumber = 0;
  for (const m of matches) {
    if (m.match_number > maxMatchNumber) maxMatchNumber = m.match_number;
    const twoPlayers = !!m.player1_id && !!m.player2_id;
    if (twoPlayers && m.status !== 'CANCELLED' && !m.withdrawn_player_id) {
      matched.add(m.player1_id!);
      matched.add(m.player2_id!);
    } else if ((m.status === 'BYE' || m.status === 'CATCHUP_BYE') && m.player1_id && !m.player2_id) {
      byeRowByHolder.set(m.player1_id, m.id);
    } else if (twoPlayers && m.withdrawn_player_id && m.status !== 'CANCELLED') {
      const survivor = m.player1_id === m.withdrawn_player_id ? m.player2_id! : m.player1_id!;
      orphanRowsByComp.set(survivor, [...(orphanRowsByComp.get(survivor) ?? []), m.id]);
    }
  }

  let actions = 0;

  // A competitor can't both play and bye in the same round: cancel a stray solo bye held by someone
  // who already has a live game (e.g. a catch-up bye left behind when a host manually paired a late
  // joiner). This also self-heals that orphaned-bye residue after the fact.
  for (const [holder, rowId] of [...byeRowByHolder]) {
    if (matched.has(holder)) {
      await prisma.match.update({ where: { id: rowId }, data: { status: 'CANCELLED', winner_id: null } });
      byeRowByHolder.delete(holder);
      actions += 1;
    }
  }

  const participants = await prisma.tournamentParticipant.findMany({
    where: { tournament_id: tournamentId, deleted_at: null, status: 'CHECKED_IN' },
    select: { user_id: true, team_id: true },
  });
  const idle = participants.map((p) => p.team_id ?? p.user_id).filter((id) => !matched.has(id));

  if (idle.length === 0) return actions;
  if (idle.length === 1 && byeRowByHolder.has(idle[0]!)) return actions; // a single legitimate bye — leave it

  idle.sort(); // deterministic pairing order

  const cancelOrphans = async (comp: string) => {
    for (const rowId of orphanRowsByComp.get(comp) ?? []) {
      await prisma.match.update({ where: { id: rowId }, data: { status: 'CANCELLED', winner_id: null } });
    }
  };

  const queue = [...idle];
  while (queue.length >= 2) {
    const a = queue.shift()!;
    const b = queue.shift()!;
    await cancelOrphans(a);
    await cancelOrphans(b);
    const aBye = byeRowByHolder.get(a);
    const bBye = byeRowByHolder.get(b);
    if (aBye) {
      await prisma.match.update({ where: { id: aBye }, data: { player2_id: b, status: 'PENDING', winner_id: null } });
      if (bBye) await prisma.match.update({ where: { id: bBye }, data: { status: 'CANCELLED', winner_id: null } });
    } else if (bBye) {
      await prisma.match.update({ where: { id: bBye }, data: { player2_id: a, status: 'PENDING', winner_id: null } });
    } else {
      maxMatchNumber += 1;
      await prisma.match.create({
        data: { tournament_id: tournamentId, round, match_number: maxMatchNumber, player1_id: a, player2_id: b, winner_id: null, status: 'PENDING', phase: 'SWISS' },
      });
    }
    await prisma.auditLog.create({
      data: { entity_type: 'Match', entity_id: aBye ?? bBye ?? tournamentId, action: 'swiss_bye_reconciled', new_value: { tournamentId, round, a, b } },
    });
    void recordTournamentEvent({ tournamentId, type: 'match_created', actor: 'system', payload: { phase: 'swiss_bye_reconciled' } });
    actions += 1;
  }

  // Odd leftover: make sure the lone idle player holds a bye row so they are folded into the next round.
  if (queue.length === 1) {
    const c = queue[0]!;
    if (!byeRowByHolder.has(c)) {
      await cancelOrphans(c);
      maxMatchNumber += 1;
      await prisma.match.create({
        data: { tournament_id: tournamentId, round, match_number: maxMatchNumber, player1_id: c, player2_id: null, winner_id: null, status: 'CATCHUP_BYE', phase: 'SWISS' },
      });
      actions += 1;
    }
  }

  return actions;
}

/**
 * Reconciler cron entry: run reconcileSwissByes on every ONGOING Swiss / Auto-Swiss tournament and
 * emit a bracket update for any that changed. Mirrors reconcileBalancedTournaments. Returns the total
 * number of pairing actions taken across all tournaments.
 */
export async function reconcileSwissTournaments(fastify: FastifyInstance): Promise<number> {
  const tournaments = await fastify.prisma.tournament.findMany({
    where: { OR: [{ format: 'SWISS' }, { format: 'AUTO_SWISS' }], status: 'ONGOING', deleted_at: null },
    select: { id: true },
  });
  let total = 0;
  for (const t of tournaments) {
    try {
      const actions = await reconcileSwissByes(fastify.prisma, t.id);
      if (actions > 0) {
        total += actions;
        emitBracketUpdate(fastify.io, t.id);
      }
    } catch (err) {
      fastify.log.error({ err, tournamentId: t.id }, 'Swiss bye reconcile failed');
    }
  }
  return total;
}
