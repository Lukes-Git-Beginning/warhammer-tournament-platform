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

/** Unit-key category segments that follow the race token (so `wh3_main_nur_inf_...` is a UNIT,
 *  whereas `wh3_main_nur_nurgle` is the faction DESIGNATION). Anything not in this set after the
 *  token marks a culture-level designation key. */
const UNIT_CATEGORIES = new Set(['inf', 'cav', 'mon', 'cha', 'art', 'veh', 'feral', 'mor', 'sub']);

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

/** Detect the two factions. SLUG-PRIMARY: a faction's culture-level DESIGNATION key
 *  (`wh3_main_nur_nurgle`, `wh_dlc05_wef_wood_elves`, …) names the faction directly and, unlike
 *  unit-token frequency, is NOT fooled by mono-god armies (a daemons_of_chaos player fields
 *  Nurgle *units* but only carries the `dae_daemons` designation, not `nur_nurgle`). Token
 *  frequency is used only to order/disambiguate when strays produce >2 designations, or as a
 *  fallback when no designation is found. One faction → mirror match (both players same). */
export function extractFactions(buf: Buffer): string[] {
  const text = buf.toString('latin1');

  // Token frequency across all wh keys (for ordering + fallback + mirror detection).
  const counts = new Map<string, number>();
  const tokRe = /wh[0-9]?_[a-z0-9]+_([a-z]{3})_/g;
  let mm: RegExpExecArray | null;
  while ((mm = tokRe.exec(text)) !== null) {
    if (TOKEN_TO_FACTION[mm[1]!]) counts.set(mm[1]!, (counts.get(mm[1]!) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const factionsByFreq: string[] = [];
  for (const [tok] of ranked) {
    const f = TOKEN_TO_FACTION[tok]!;
    if (!factionsByFreq.includes(f)) factionsByFreq.push(f);
  }

  // Designation factions: `wh*_<set>_<token>_<name>` where <name> is NOT a unit category.
  const designation = new Set<string>();
  const desRe = /wh[0-9]?_[a-z0-9]+_([a-z]{3})_([a-z]+)/g;
  let dm: RegExpExecArray | null;
  while ((dm = desRe.exec(text)) !== null) {
    const faction = TOKEN_TO_FACTION[dm[1]!];
    if (faction && !UNIT_CATEGORIES.has(dm[2]!)) designation.add(faction);
  }

  // Order designation factions by token frequency (drops stray designations to the tail).
  const ordered = factionsByFreq.filter((f) => designation.has(f));
  // Fill from raw frequency if fewer than 2 designations were found (fallback).
  for (const f of factionsByFreq) if (!ordered.includes(f)) ordered.push(f);

  // Mirror match: only one faction is really present — the 2nd-most-frequent token is a stray
  // (≤2 occurrences; a genuine 2nd faction fields dozens of unit keys). Frequency-based so a
  // stray DESIGNATION (e.g. an ability's cross-reference to another culture) can't defeat it.
  if (ranked.length > 1 && ranked[1]![1] <= 2) {
    return [ordered[0]!, ordered[0]!];
  }
  return ordered.slice(0, 2);
}

/** Faction DISPLAY name (as it appears in the replay's player-setup region) → platform slug.
 *  Used to attribute a faction to a specific player by proximity (see attributeFaction). */
export const FACTION_DISPLAY_TO_SLUG: Record<string, string> = {
  Empire: 'empire', Bretonnia: 'bretonnia', Kislev: 'kislev', 'Grand Cathay': 'grand_cathay',
  Dwarfs: 'dwarfs', 'High Elves': 'high_elves', Lizardmen: 'lizardmen', Greenskins: 'greenskins',
  'Dark Elves': 'dark_elves', Skaven: 'skaven', Norsca: 'norsca', 'Ogre Kingdoms': 'ogre_kingdoms',
  Beastmen: 'beastmen', Khorne: 'khorne', Nurgle: 'nurgle', Tzeentch: 'tzeentch', Slaanesh: 'slaanesh',
  'Daemons of Chaos': 'daemons_of_chaos', 'Warriors of Chaos': 'warriors_of_chaos',
  'Chaos Dwarfs': 'chaos_dwarfs', 'Vampire Counts': 'vampire_counts', 'Vampire Coast': 'vampire_coast',
  'Tomb Kings': 'tomb_kings', 'Wood Elves': 'wood_elves',
};

/** Byte offsets of every faction DISPLAY name in the buffer (UTF-16LE), with its slug. */
function factionDisplayPositions(buf: Buffer): Array<{ off: number; slug: string }> {
  const hay = buf.toString('latin1');
  const out: Array<{ off: number; slug: string }> = [];
  for (const [name, slug] of Object.entries(FACTION_DISPLAY_TO_SLUG)) {
    const needle = Buffer.from(name, 'utf16le').toString('latin1');
    let i = hay.indexOf(needle);
    while (i !== -1) {
      out.push({ off: i, slug });
      i = hay.indexOf(needle, i + 1);
    }
  }
  return out;
}

/** Attribute a faction to a specific player: find the player's name in the replay's setup region
 *  and return the slug of the NEAREST faction display name (by byte distance) — validated against
 *  prod (the per-player army block carries its own faction display name). Null when the name isn't
 *  found or no faction display is present. Requires the player's actual in-replay name (Steam persona). */
export function attributeFaction(buf: Buffer, playerName: string): string | null {
  if (!playerName || playerName.length < 2) return null;
  const hay = buf.toString('latin1').toLowerCase();
  const needle = Buffer.from(playerName, 'utf16le').toString('latin1').toLowerCase();
  const at = hay.indexOf(needle);
  if (at === -1) return null;
  const positions = factionDisplayPositions(buf);
  if (positions.length === 0) return null;
  let best = positions[0]!;
  for (const p of positions) if (Math.abs(p.off - at) < Math.abs(best.off - at)) best = p;
  return best.slug;
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
