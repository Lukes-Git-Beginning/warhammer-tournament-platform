// ---------------------------------------------------------------------------
// Competitor resolution — the seam between opaque match slots and their actors.
//
// Match.player1_id/player2_id/winner_id are opaque competitor ids: a User id for
// 1v1, a Team id for 2v2 (team-as-actor). There is no FK on the slots, so a slot is
// resolved here — by looking up both User and Team. See plans/2v2-competitor-
// implementation.md and design doc §5.
//
// Display uniformity: a Team resolves with `username = team.name` so existing 1v1
// render paths (which read `.username`/`.avatar_url`) show the team name unchanged.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@rizzotto/db';
import { SUPPORTER_FLAG_SELECT, effectiveTiersOf, NO_TIERS } from './supporter-service.js';
import type { SupporterTiers } from './supporter-status.js';

/** A team's competitor format string. */
export function isTeamFormat(competitorFormat: string | null | undefined): boolean {
  return competitorFormat === 'TWO_V_TWO';
}

/** The opaque competitor id for a participant row: the team for 2v2, else the user. */
export function resolveCompetitorId(p: { team_id?: string | null; user_id: string }): string {
  return p.team_id ?? p.user_id;
}

export interface ResolvedCompetitorMember {
  user_id: string;
  username: string;
  avatar_url: string | null;
  is_captain: boolean;
  accepted: boolean;
}

export interface ResolvedCompetitor {
  id: string;
  type: 'USER' | 'TEAM';
  /** Display name — the username for a user, the team name for a team. */
  username: string;
  avatar_url: string | null;
  tiers: SupporterTiers;
  /** Team roster (null for a user competitor). */
  members: ResolvedCompetitorMember[] | null;
  /** Captain user id for a team (null for a user competitor). */
  captain_id: string | null;
}

/**
 * Batch-resolve opaque competitor ids to a uniform display shape. Ids may be User ids
 * (1v1) or Team ids (2v2) — both tables are queried, so a mixed set resolves correctly.
 * Unknown ids simply don't appear in the returned map.
 */
export async function resolveCompetitors(
  prisma: PrismaClient,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, ResolvedCompetitor>> {
  const clean = [...new Set(ids.filter((x): x is string => !!x))];
  const map = new Map<string, ResolvedCompetitor>();
  if (clean.length === 0) return map;

  const [users, teams] = await Promise.all([
    prisma.user.findMany({
      where: { id: { in: clean } },
      select: { id: true, username: true, avatar_url: true, ...SUPPORTER_FLAG_SELECT },
    }),
    prisma.team.findMany({
      where: { id: { in: clean } },
      select: {
        id: true,
        name: true,
        captain_id: true,
        members: {
          select: {
            user_id: true,
            accepted_at: true,
            user: { select: { username: true, avatar_url: true } },
          },
        },
      },
    }),
  ]);

  for (const u of users) {
    map.set(u.id, {
      id: u.id,
      type: 'USER',
      username: u.username,
      avatar_url: u.avatar_url ?? null,
      tiers: effectiveTiersOf(u),
      members: null,
      captain_id: null,
    });
  }
  for (const t of teams) {
    // Captain first, then the teammate(s) — matches the picker/draft order (captain then mate).
    const members: ResolvedCompetitorMember[] = t.members
      .map((m) => ({
        user_id: m.user_id,
        username: m.user.username,
        avatar_url: m.user.avatar_url ?? null,
        is_captain: m.user_id === t.captain_id,
        accepted: m.accepted_at !== null,
      }))
      .sort((a, b) => (a.is_captain === b.is_captain ? 0 : a.is_captain ? -1 : 1));
    map.set(t.id, {
      id: t.id,
      type: 'TEAM',
      username: t.name,
      avatar_url: null,
      tiers: NO_TIERS,
      members,
      captain_id: t.captain_id,
    });
  }
  return map;
}

/** Map of team id → captain user id for the given ids (non-team ids are ignored). */
export async function captainMap(
  prisma: PrismaClient,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const clean = [...new Set(ids.filter((x): x is string => !!x))];
  if (clean.length === 0) return new Map();
  const teams = await prisma.team.findMany({
    where: { id: { in: clean } },
    select: { id: true, captain_id: true },
  });
  return new Map(teams.map((t) => [t.id, t.captain_id]));
}

/**
 * The user id that acts for a competitor slot: the team's captain for a Team id, else
 * the id itself (already a user). Used at draft start (Socket.IO room + pick attribution
 * need a real user id) and anywhere a single "acting user" is required per slot.
 * Batch form to avoid N+1.
 */
export async function resolveActingUserIds(
  prisma: PrismaClient,
  ids: ReadonlyArray<string | null | undefined>,
): Promise<Map<string, string>> {
  const caps = await captainMap(prisma, ids);
  const out = new Map<string, string>();
  for (const id of ids) {
    if (!id) continue;
    out.set(id, caps.get(id) ?? id);
  }
  return out;
}

/**
 * Whether `userSub` is a member of either competitor slot — the read-visibility counterpart to
 * resolveActorFlags (which is captain-only). 1v1: identity against the slot. 2v2: membership in
 * either team (any member, captain or teammate). Used to gate non-authoritative reads/writes like
 * seeing lobby codes, where both teammates qualify (unlike result reporting = captain-as-actor).
 */
export async function isCompetitorMember(
  prisma: PrismaClient,
  userSub: string,
  match: { player1_id: string | null; player2_id: string | null },
  isTeam: boolean,
): Promise<boolean> {
  if (!isTeam) return userSub === match.player1_id || userSub === match.player2_id;
  const slotIds = [match.player1_id, match.player2_id].filter((x): x is string => !!x);
  if (slotIds.length === 0) return false;
  const membership = await prisma.teamMember.findFirst({
    where: { team_id: { in: slotIds }, user_id: userSub },
    select: { id: true },
  });
  return membership !== null;
}

export interface ActorFlags {
  isPlayer1: boolean;
  isPlayer2: boolean;
  isParticipant: boolean;
}

/**
 * Which match slots the caller acts for, competitor-format-aware. 1v1: identity against the
 * slot id. 2v2: the caller must be the CAPTAIN of the team in that slot (team-as-actor). The
 * single seam that turns the in-match participant checks (map decision, blind pick, report)
 * captain-aware without touching each endpoint's logic.
 */
export async function resolveActorFlags(
  prisma: PrismaClient,
  userSub: string,
  match: { player1_id: string | null; player2_id: string | null },
  isTeam: boolean,
): Promise<ActorFlags> {
  if (!isTeam) {
    const isPlayer1 = match.player1_id !== null && userSub === match.player1_id;
    const isPlayer2 = match.player2_id !== null && userSub === match.player2_id;
    return { isPlayer1, isPlayer2, isParticipant: isPlayer1 || isPlayer2 };
  }
  const caps = await captainMap(prisma, [match.player1_id, match.player2_id]);
  const isPlayer1 = match.player1_id !== null && caps.get(match.player1_id) === userSub;
  const isPlayer2 = match.player2_id !== null && caps.get(match.player2_id) === userSub;
  return { isPlayer1, isPlayer2, isParticipant: isPlayer1 || isPlayer2 };
}

/**
 * Whether `userSub` may act for competitor slot `slotId`. 1v1: identity. 2v2: the caller
 * must be the captain of that team. Pass `captains` (from captainMap) to avoid a query
 * when the caller already loaded them; otherwise a team lookup resolves it.
 */
export async function canActForSlot(
  prisma: PrismaClient,
  userSub: string,
  slotId: string | null,
  isTeam: boolean,
  captains?: Map<string, string>,
): Promise<boolean> {
  if (!slotId) return false;
  if (!isTeam) return userSub === slotId;
  const captainId = captains?.get(slotId) ?? (await captainMap(prisma, [slotId])).get(slotId);
  return captainId === userSub;
}
