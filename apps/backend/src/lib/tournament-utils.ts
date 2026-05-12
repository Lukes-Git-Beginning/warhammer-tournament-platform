import {
  TournamentStatus,
  type TournamentFormat,
  type TournamentMode,
  type TournamentVisibility,
  type ParticipantStatus,
  type MatchStatus,
} from '@tww3/db';

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
// Points calculation (stub — will be refined in M2)
// ---------------------------------------------------------------------------

/**
 * Calculate placement points for a tournament result.
 * Stub formula: (participantCount - placement + 1) * 10
 * TODO M2: Replace with ELO-weighted formula that accounts for format,
 * is_major flag, and opponent strength.
 */
export function calculatePoints(placement: number, participantCount: number): number {
  return Math.max(0, participantCount - placement + 1) * 10;
}
