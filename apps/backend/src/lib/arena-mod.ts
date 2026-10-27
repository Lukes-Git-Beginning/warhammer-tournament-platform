// RizzOtto's Arena Mod on the Steam Workshop: the one mod every arena game runs. Its current version is
// read from the Workshop item's public description (no API key needed once the item is listed). While the
// item is still unlisted Steam answers result 9 for it, so the site shows the mod without a version.

export const ARENA_MOD_WORKSHOP_ID = '3827143159';
export const ARENA_MOD_NAME = "RizzOtto's Arena Mod";
export const ARENA_MOD_URL = `https://steamcommunity.com/sharedfiles/filedetails/?id=${ARENA_MOD_WORKSHOP_ID}`;
export const ARENA_MOD_CHANGELOG_URL = `https://steamcommunity.com/sharedfiles/filedetails/changelog/${ARENA_MOD_WORKSHOP_ID}`;

/** The mod's upload script writes "Current version: 1.0" into the description (label maybe in BBCode bold). */
const VERSION_RE = /Current version:\s*(?:\[\/b\]\s*)?v?(\d+(?:\.\d+)+)/i;

export interface ArenaModInfo {
  workshopId: string;
  name: string;
  url: string;
  changelogUrl: string;
  /** False while the Workshop item is unlisted/not found (Steam result 9) or Steam couldn't be reached. */
  listed: boolean;
  /** "1.0", "1.1", … from the description; null when unlisted or no version line. */
  version: string | null;
  /** ISO time of the item's last update on the Workshop; null when unknown. */
  updatedAt: string | null;
}

interface PublishedFileDetails {
  result?: number;
  description?: string;
  time_updated?: number;
}

/** PURE: read listing state, version and update time out of a GetPublishedFileDetails response. */
export function parseArenaModDetails(json: unknown): Pick<ArenaModInfo, 'listed' | 'version' | 'updatedAt'> {
  const details = (json as { response?: { publishedfiledetails?: PublishedFileDetails[] } } | null)?.response
    ?.publishedfiledetails?.[0];
  if (!details || details.result !== 1) return { listed: false, version: null, updatedAt: null };
  const match = VERSION_RE.exec(details.description ?? '');
  return {
    listed: true,
    version: match?.[1] ?? null,
    updatedAt: typeof details.time_updated === 'number' ? new Date(details.time_updated * 1000).toISOString() : null,
  };
}

/** The mod's static facts with no live data (Steam unreachable, or before the first fetch). */
export function arenaModFallback(): ArenaModInfo {
  return {
    workshopId: ARENA_MOD_WORKSHOP_ID,
    name: ARENA_MOD_NAME,
    url: ARENA_MOD_URL,
    changelogUrl: ARENA_MOD_CHANGELOG_URL,
    listed: false,
    version: null,
    updatedAt: null,
  };
}

/** Ask Steam for the Workshop item. Throws on a network/HTTP failure so the caller doesn't cache it. */
export async function fetchArenaModInfo(): Promise<ArenaModInfo> {
  const resp = await fetch('https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `itemcount=1&publishedfileids[0]=${ARENA_MOD_WORKSHOP_ID}`,
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) throw new Error(`Steam GetPublishedFileDetails answered ${resp.status}`);
  return { ...arenaModFallback(), ...parseArenaModDetails(await resp.json()) };
}
