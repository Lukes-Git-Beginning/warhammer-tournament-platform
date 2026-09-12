import type { PrismaClient } from '@rizzotto/db';

// ---------------------------------------------------------------------------
// Tournament Series — permissions + slug helpers.
// ---------------------------------------------------------------------------

/**
 * Whether a user may manage a series. True for global MODERATOR/ADMIN and for the
 * series owner. Mirrors {@link canManageTournament} — every series mutation gates on
 * this. Attaching a tournament additionally requires canManageTournament(tournament).
 */
export async function canManageSeries(
  prisma: PrismaClient,
  seriesId: string,
  userId: string,
  role: string,
): Promise<boolean> {
  if (role === 'MODERATOR' || role === 'ADMIN') return true;
  if (!seriesId) return false;
  const s = await prisma.tournamentSeries.findUnique({
    where: { id: seriesId },
    select: { owner_id: true },
  });
  return !!s && s.owner_id === userId;
}

/**
 * Resolve a unique series slug from a base (kebab-case already applied by the caller
 * via generateSlug). Appends -2, -3… on collision, timestamp fragment as a last resort.
 */
export async function resolveSeriesSlug(prisma: PrismaClient, base: string): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const existing = await prisma.tournamentSeries.findUnique({ where: { slug: candidate } });
    if (!existing) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
