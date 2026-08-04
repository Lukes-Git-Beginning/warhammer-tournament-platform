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

/** A player entry read from the replay: their in-game name + the faction attributed to them. */
export interface ReplayPlayer { name: string; faction: string | null }

/** Best-effort extraction of the actual player names (+ their factions) recorded in the replay,
 *  so a human can eyeball whether a flagged game is a rename, a faction misreport or a wrong replay.
 *  Player names are handle-like strings (digits / _ / | / a lone lowercase token) sitting in the
 *  player-setup region next to their own faction display name. This is a heuristic — it surfaces the
 *  real handles near the top but may include the odd unit name; it is NOT a byte-perfect parser. */
export function extractReplayPlayers(buf: Buffer): ReplayPlayer[] {
  const hay = buf.toString('latin1');
  const positions = factionDisplayPositions(buf);
  if (positions.length === 0) return [];
  const nearestFaction = (off: number): string =>
    positions.reduce((b, p) => (Math.abs(p.off - off) < Math.abs(b.off - off) ? p : b), positions[0]!).slug;
  const displayNames = new Set(Object.keys(FACTION_DISPLAY_TO_SLUG));

  // eslint-disable-next-line no-control-regex -- \x00 is intentional: matches UTF-16LE strings.
  const re = /(?:[\x20-\x7e]\x00){3,30}/g;
  const scored: Array<{ score: number; name: string; faction: string }> = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(hay)) !== null) {
    const s = Buffer.from(m[0], 'latin1').toString('utf16le').trim();
    if (s.length < 3 || s.includes('(') || s.includes(')') || displayNames.has(s) || /^\d+$/.test(s)) continue;
    if (seen.has(s.toLowerCase())) continue;
    // Only strings sitting near a faction block (the player-setup region), not army-list noise elsewhere.
    const off = m.index;
    if (positions.every((p) => Math.abs(p.off - off) > 600)) continue;
    // Handle-like: digits / underscore / pipe, or a single all-lowercase token.
    const handleish = /[0-9_|]/.test(s) || (!/\s/.test(s) && s === s.toLowerCase());
    if (!handleish) continue;
    seen.add(s.toLowerCase());
    scored.push({ score: /[0-9_|]/.test(s) ? 3 : 2, name: s, faction: nearestFaction(off) });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map(({ name, faction }) => ({ name, faction }));
}

/** Reliable per-player faction attribution: given the two players' in-replay names and the two
 *  factions the replay actually contains (from extractFactions — already trustworthy), assign each
 *  player one of those two factions by the minimum-total-distance 2×2 assignment (name position →
 *  nearest display of each faction). This GUARANTEES each present player gets a distinct one of the
 *  two real factions — never a stray, never both the same (unless a mirror). Returns a slug (or null
 *  when the name isn't in the replay) aligned to `names`. Validated 8/8 on prod. */
export function attributeFactionsForPlayers(buf: Buffer, names: Array<string | null>, factions: string[]): Array<string | null> {
  const hay = buf.toString('latin1');
  const positions = factionDisplayPositions(buf);
  const namePos = (n: string | null): number | null => {
    if (!n || n.length < 2) return null;
    const at = hay.toLowerCase().indexOf(Buffer.from(n, 'utf16le').toString('latin1').toLowerCase());
    return at === -1 ? null : at;
  };
  const distToFaction = (off: number, slug: string): number => {
    const ps = positions.filter((p) => p.slug === slug);
    return ps.length ? Math.min(...ps.map((p) => Math.abs(p.off - off))) : Number.POSITIVE_INFINITY;
  };
  const uniqFactions = [...new Set(factions)];
  const offs = names.map(namePos);

  // Mirror (one faction) → every present player is that faction.
  if (uniqFactions.length === 1) return offs.map((o) => (o === null ? null : uniqFactions[0]!));

  // Two factions + both players located → constrained 2×2 assignment (minimise total distance).
  if (uniqFactions.length >= 2 && offs.length === 2 && offs[0] !== null && offs[1] !== null) {
    const [x, y] = [uniqFactions[0]!, uniqFactions[1]!];
    const straight = distToFaction(offs[0]!, x) + distToFaction(offs[1]!, y);
    const swapped = distToFaction(offs[0]!, y) + distToFaction(offs[1]!, x);
    return straight <= swapped ? [x, y] : [y, x];
  }

  // Otherwise (≤1 player located): assign each located player its nearest of the two factions.
  return offs.map((o) => {
    if (o === null) return null;
    return uniqFactions.reduce((best, f) => (distToFaction(o, f) < distToFaction(o, best) ? f : best), uniqFactions[0]!);
  });
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
