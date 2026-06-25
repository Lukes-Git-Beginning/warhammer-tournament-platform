import {
  TournamentStatus,
  type PrismaClient,
  type TournamentFormat,
  type TournamentMode,
  type TournamentVisibility,
  type ParticipantStatus,
  type MatchStatus,
} from '@rizzotto/db';

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
 * Allowed one-way status transitions for a tournament.
 * DRAFT → OPEN_REGISTRATION → REGISTRATION_CLOSED → ONGOING → COMPLETED.
 * No backwards transitions are permitted.
 */
const ALLOWED_TRANSITIONS: Record<TournamentStatus, TournamentStatus[]> = {
  [TournamentStatus.DRAFT]: [TournamentStatus.OPEN_REGISTRATION],
  [TournamentStatus.OPEN_REGISTRATION]: [TournamentStatus.REGISTRATION_CLOSED],
  [TournamentStatus.REGISTRATION_CLOSED]: [TournamentStatus.ONGOING],
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
// Points calculation (M2.2)
// ---------------------------------------------------------------------------

export function getPlacementPoints(placement: number, _totalPlayers: number): number {
  if (placement === 1) return 100;
  if (placement === 2) return 70;
  if (placement === 3) return 50;
  if (placement === 4) return 35;
  if (placement <= 8) return 20;
  if (placement <= 16) return 10;
  return 5;
}

export function getSizeMultiplier(playerCount: number): number {
  if (playerCount >= 65) return 1.5;
  if (playerCount >= 33) return 1.25;
  if (playerCount >= 17) return 1.0;
  if (playerCount >= 8) return 0.75;
  return 0.5;
}

export function calculateTournamentPoints(opts: {
  placement: number;
  playerCount: number;
  isMajor: boolean;
}): number {
  const base = getPlacementPoints(opts.placement, opts.playerCount);
  const mult = getSizeMultiplier(opts.playerCount) * (opts.isMajor ? 1.5 : 1.0);
  return Math.max(0, Math.round(base * mult));
}

// ---------------------------------------------------------------------------
// Tournament management permission (single source of truth)
// ---------------------------------------------------------------------------

/**
 * Whether a user may manage a tournament. True for global MODERATOR/ADMIN, for
 * the organizer, and for any co-host. Every management endpoint should gate on
 * this instead of an inline `organizer_id === userId` check, so co-hosts get
 * full host parity automatically.
 *
 * NOTE: ownership-control actions (transfer ownership, edit the co-host list)
 * deliberately do NOT use this — they stay organizer + MODERATOR/ADMIN only.
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
    select: { organizer_id: true, co_hosts: { select: { user_id: true } } },
  });
  if (!t) return false;
  return t.organizer_id === userId || t.co_hosts.some((h) => h.user_id === userId);
}
