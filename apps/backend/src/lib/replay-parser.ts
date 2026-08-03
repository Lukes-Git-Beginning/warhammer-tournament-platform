// Total War replay (ESF) metadata extractor — pulls the recording time, map, factions and
// player-name presence out of a .replay buffer for report verification.
//
// This is NOT a full ESF tree parser: it uses targeted, empirically-validated extraction
// (see test/replay-parser.test.ts + the prod-validation done 2026-08-03). It is meant to
// FLAG report/replay mismatches (fail-open), not to be a byte-perfect decoder.

/** CA race token (the 3-letter culture code in `wh*_..._<token>_...` keys) → platform faction slug.
 *  The token uniquely identifies the faction, EXCEPT daemons_of_chaos (dae) vs the four mono-gods
 *  (kho/nur/tze/sla): a daemons army fields mono-god units, so those are disambiguated by the
 *  faction DESIGNATION slug (see extractFactions). */
export const TOKEN_TO_FACTION: Record<string, string> = {
  emp: 'empire', brt: 'bretonnia', ksl: 'kislev', cth: 'grand_cathay', dwf: 'dwarfs',
  grn: 'greenskins', skv: 'skaven', lzd: 'lizardmen', hef: 'high_elves', def: 'dark_elves',
  wef: 'wood_elves', vmp: 'vampire_counts', cst: 'vampire_coast', tmb: 'tomb_kings',
  bst: 'beastmen', nor: 'norsca', chs: 'warriors_of_chaos', chd: 'chaos_dwarfs',
  ogr: 'ogre_kingdoms', dae: 'daemons_of_chaos', kho: 'khorne', nur: 'nurgle',
  tze: 'tzeentch', sla: 'slaanesh',
};

/** The mono-god factions whose UNIT tokens also appear inside a daemons_of_chaos army. */
const MONO_GODS = new Set(['khorne', 'nurgle', 'tzeentch', 'slaanesh']);

export interface ReplayMeta {
  /** Recording time from the ESF header (offset-8 uint32 LE, UTC). */
  recordedAt: Date | null;
  /** Terrain slug, e.g. "test_domination_jade_tomb" or "waka_def_desert_dunes_of_khaine_070809". */
  mapTerrain: string | null;
  /** Platform faction slugs detected (1 for a mirror match, else 2). */
  factions: string[];
}

/** ESF signature: byte[1]=0xAB, byte[0] in 0xCA–0xCF. */
export function isEsf(buf: Buffer): boolean {
  return buf.length >= 2 && buf[1] === 0xab && buf[0]! >= 0xca && buf[0]! <= 0xcf;
}

/** Recording timestamp — uint32 LE at header offset 8, interpreted as a unix time. */
export function readRecordedAt(buf: Buffer): Date | null {
  if (buf.length < 12) return null;
  const ts = buf.readUInt32LE(8);
  // sanity: plausible 2020..2030 window
  if (ts < 1577836800 || ts > 1893456000) return null;
  return new Date(ts * 1000);
}

/** The map's stable identifier. Most maps expose a `terrain/battles/<slug>` path; some (e.g.
 *  "Battle for Itza") only carry a `wh*_..._domination_<slug>` key instead. Either is a stable
 *  per-map identifier that the verify step resolves to a Map via a terrain→map table. */
export function extractMapTerrain(buf: Buffer): string | null {
  const text = buf.toString('latin1');
  const t = text.match(/terrain\/battles\/([a-z0-9_]+)/);
  if (t) return t[1]!;
  const d = text.match(/wh[0-9]?_[a-z_]*domination_([a-z0-9_]+)/);
  if (d) return d[1]!;
  return null;
}

/** Detect the two factions. Token frequency (each faction's units carry its token dozens of times)
 *  is the primary signal; a daemons_of_chaos DESIGNATION slug overrides a mono-god that only shows
 *  up as units. A single dominant token → mirror match (both players same faction). */
export function extractFactions(buf: Buffer): string[] {
  const text = buf.toString('latin1');
  // count race tokens across all wh keys
  const counts = new Map<string, number>();
  const re = /wh[0-9]?_[a-z0-9]+_([a-z]{3})_/g;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(text)) !== null) {
    const tok = mm[1]!;
    if (TOKEN_TO_FACTION[tok]) counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);

  // Daemons override: if a daemons DESIGNATION slug is present, the daemons player's mono-god
  // unit tokens must not masquerade as a mono-god faction.
  const hasDaemonsDesignation = /wh[0-9]?_[a-z0-9]+_dae_daemons\b/.test(text);

  const slugs: string[] = [];
  for (const [tok] of ranked) {
    let slug = TOKEN_TO_FACTION[tok]!;
    // a mono-god token that is really the daemons player → daemons_of_chaos
    if (MONO_GODS.has(slug) && hasDaemonsDesignation && !slugs.includes('daemons_of_chaos')) {
      slug = 'daemons_of_chaos';
    }
    if (!slugs.includes(slug)) slugs.push(slug);
    // mirror match: exactly one real faction present — every other token is a stray (ability /
    // cross-reference), which occurs only once or twice. A genuine 2nd faction shows many units.
    if (slugs.length === 1 && ranked.length > 1) {
      const [, second] = ranked[1]!;
      if (second <= 2) return [slug, slug];
    }
    if (slugs.length === 2) break;
  }
  return slugs.slice(0, 2);
}

/** Whether a display name occurs in the replay (UTF-16LE, case-insensitive) — used to check a
 *  participant's live Steam persona name against the recorded players. */
export function replayContainsName(buf: Buffer, name: string): boolean {
  if (!name || name.length < 2) return false;
  const needle = Buffer.from(name, 'utf16le');
  // case-insensitive: lowercase both. UTF-16 lowercase of ASCII is byte-wise on even bytes.
  const hay = buf.toString('latin1').toLowerCase();
  const nd = needle.toString('latin1').toLowerCase();
  return hay.includes(nd);
}

/** Full metadata extraction. */
export function parseReplayMeta(buf: Buffer): ReplayMeta {
  return {
    recordedAt: readRecordedAt(buf),
    mapTerrain: extractMapTerrain(buf),
    factions: extractFactions(buf),
  };
}
