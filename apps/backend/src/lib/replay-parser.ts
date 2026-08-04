// Total War replay (ESF) metadata extractor — pulls the recording time, map, factions and
// player-name presence out of a .replay buffer for report verification.
//
// The recording time / map / faction SET use targeted, empirically-validated string extraction
// (see test/replay-parser.test.ts + the prod-validation done 2026-08-03). Per-player faction
// attribution (extractReplayPlayers) uses a real ESF tree walk (ported from RPFM's cbab spec),
// because that association is NOT positionally recoverable — validated at scale: string proximity
// is ~60% (a coin flip), the tree walk is ~98% (229/233 real games, the misses being wrong-replay
// uploads or chaos-god ambiguity, i.e. exactly what an audit wants to surface). Fail-open throughout.

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
  /** Player handles + factions recorded in the replay (ESF tree walk). */
  players: ReplayPlayer[];
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

// ─── Minimal ESF tree walker (ported from RPFM's cbab spec, Frodo45127/rpfm) ─────────────────────
// Only what extractReplayPlayers needs: resolve the string pools by index and DFS the metadata tree
// (the command log — QUEUES/SAVED_TICK — is skipped by block size). Read-only, bounds-checked.

/** CAULEB128 varint: big-endian 7-bit groups, high bit = continuation. Returns [value, nextPos]. */
function cauleb128(b: Buffer, pos: number): [number, number] {
  let v = 0;
  for (;;) { const x = b[pos++]!; v = v * 128 + (x & 0x7f); if (!(x & 0x80)) break; }
  return [v, pos];
}

/** ESF primitive field size (bytes AFTER the type byte). Missing ⇒ record/array/variable. */
const ESF_FIELD_SIZE: Record<number, number> = {
  0x01: 1, 0x02: 1, 0x03: 2, 0x04: 4, 0x05: 8, 0x06: 1, 0x07: 2, 0x08: 4, 0x09: 8,
  0x0a: 4, 0x0b: 8, 0x0c: 8, 0x0d: 12, 0x0e: 4, 0x0f: 4, 0x10: 2,
  0x12: 0, 0x13: 0, 0x14: 0, 0x15: 0, 0x16: 1, 0x17: 2, 0x18: 3,
  0x19: 0, 0x1a: 1, 0x1b: 2, 0x1c: 3, 0x1d: 0, 0x21: 4, 0x23: 1, 0x24: 2, 0x25: 4,
};

interface EsfPools { RN: string[]; u16: Record<number, string>; u8: Record<number, string> }

/** Resolve the three CBAB string tables at the file tail (offset in header[12]):
 *  record-name table `[u16 count][u16 len + ascii]…`, then the UTF-16 and UTF-8 pools, each
 *  `[u32 count]` then entries `[u32 charLen][chars][u32 index]` (the index is what STR16[…]/KEY[…]
 *  fields reference). This exact index mapping is the piece the old heuristic pool got wrong. */
function buildEsfPools(b: Buffer): EsfPools {
  const recOff = b.readUInt32LE(12);
  let p = recOff;
  const rnCount = b.readUInt16LE(p); p += 2;
  const RN: string[] = [];
  for (let i = 0; i < rnCount; i++) { const l = b.readUInt16LE(p); p += 2; RN.push(b.toString('ascii', p, p + l)); p += l; }
  const u16: Record<number, string> = {};
  { const c = b.readUInt32LE(p); p += 4;
    for (let i = 0; i < c && p + 4 <= b.length; i++) {
      const cl = b.readUInt32LE(p); p += 4;
      if (cl > 2000 || p + 2 * cl + 4 > b.length) break;
      const s = b.toString('utf16le', p, p + 2 * cl); p += 2 * cl;
      u16[b.readUInt32LE(p)] = s; p += 4;
    } }
  const u8: Record<number, string> = {};
  { const c = b.readUInt32LE(p); p += 4;
    for (let i = 0; i < c && p + 4 <= b.length; i++) {
      const l = b.readUInt32LE(p); p += 4;
      if (l > 2000 || p + l + 4 > b.length) break;
      const s = b.toString('ascii', p, p + l); p += l;
      u8[b.readUInt32LE(p)] = s; p += 4;
    } }
  return { RN, u16, u8 };
}

type EsfVisit = (name: string | undefined, start: number, end: number) => void;
type EsfVisitField = (type: number, pos: number, parentName: string | undefined) => void;

/** DFS the ESF metadata tree from the root at 0x10, skipping the command log. `visit` fires per
 *  record (with its byte range), `visitField` per primitive field (pos = the data byte). */
function walkEsf(b: Buffer, RN: string[], visit: EsfVisit, visitField: EsfVisitField): void {
  const HAS_NESTED = 0x40, HAS_NON_OPT = 0x20;
  function fieldEnd(t: number, pos: number): number {
    const sz = ESF_FIELD_SIZE[t];
    if (sz !== undefined) return pos + sz;
    if (t === 0) return pos;
    if ((t >= 0x41 && t <= 0x50) || (t >= 0x52 && t <= 0x5d) || t === 0x26) {
      const [byteSize, np] = cauleb128(b, pos); return np + byteSize;
    }
    return -1;
  }
  function readNode(pos: number, isRoot: boolean, parentName: string | undefined): number {
    const t = b[pos]!;
    if (t < 0x80) { visitField(t, pos + 1, parentName); return fieldEnd(t, pos + 1); }
    const flags = t;
    const hasNested = (flags & HAS_NESTED) !== 0;
    let p = pos + 1, name: number;
    if ((flags & HAS_NON_OPT) !== 0 || isRoot) { name = b.readUInt16LE(p); p += 3; /* +2 name, +1 version */ }
    else { name = ((flags & 1) << 8) | b[p]!; p += 1; /* version packed in flags, no bytes */ }
    const [blockSize, afterSize] = cauleb128(b, p); p = afterSize;
    const finalBlockOffset = p + blockSize;
    if (finalBlockOffset > b.length || finalBlockOffset <= pos) return -1;
    const nm = RN[name];
    visit(nm, pos, finalBlockOffset);
    if (nm === 'QUEUES' || nm === 'SAVED_TICK') return finalBlockOffset;
    let groupCount = 1;
    if (hasNested) { [groupCount, p] = cauleb128(b, p); }
    for (let g = 0; g < groupCount; g++) {
      let finalEntryOffset: number;
      if (hasNested) { const [es, afterEs] = cauleb128(b, p); p = afterEs; finalEntryOffset = p + es; }
      else finalEntryOffset = finalBlockOffset;
      if (finalEntryOffset > finalBlockOffset) finalEntryOffset = finalBlockOffset;
      while (p < finalEntryOffset) {
        const e = readNode(p, false, nm);
        if (e <= p || e > finalEntryOffset) { p = finalEntryOffset; break; }
        p = e;
      }
    }
    return finalBlockOffset;
  }
  readNode(0x10, true, undefined);
}

/** A player handle read from the replay, with the faction they actually fielded. */
export interface ReplayPlayer { name: string; faction: string | null }

/** Extract each player's handle + faction via the ESF tree: pair the i-th real BATTLE_SETUP_ARMY
 *  (faction = its dominant unit-race token) with the i-th distinct PLAYER_DATA name. Validated 8/8
 *  on labelled replays and 229/233 across prod (misses = wrong-replay uploads / chaos-god ambiguity,
 *  which the audit wants surfaced). Fail-open: any parse trouble ⇒ [] rather than throwing. */
export function extractReplayPlayers(buf: Buffer): ReplayPlayer[] {
  if (!isEsf(buf) || buf.length < 16) return [];
  try {
    const { RN, u16, u8 } = buildEsfPools(buf);
    const armies: Array<{ start: number; end: number; tokens: Map<string, number> }> = [];
    const keyHits: Array<{ pos: number; str: string }> = [];
    const names: string[] = [];
    walkEsf(buf, RN,
      (nm, start, end) => { if (nm === 'BATTLE_SETUP_ARMY') armies.push({ start, end, tokens: new Map() }); },
      (t, pos, parent) => {
        if (t === 0x0f) { const s = u8[buf.readUInt32LE(pos)]; if (s) keyHits.push({ pos, str: s }); }
        else if (t === 0x0e && parent === 'PLAYER_DATA') { const s = u16[buf.readUInt32LE(pos)]; if (s !== undefined) names.push(s); }
      });
    // Tally unit-race tokens into the army whose byte-range contains each key → dominant = faction.
    const tokenRe = /wh[0-9]?_[a-z0-9]+_([a-z]{2,4})_/;
    for (const k of keyHits) {
      const m = tokenRe.exec(k.str);
      const slug = m ? TOKEN_TO_FACTION[m[1]!] : undefined;
      if (!slug) continue;
      const a = armies.find((army) => k.pos >= army.start && k.pos < army.end);
      if (!a) continue;
      a.tokens.set(m![1]!, (a.tokens.get(m![1]!) ?? 0) + 1);
    }
    const armyFactions = armies
      .map((a) => { const r = [...a.tokens.entries()].sort((x, y) => y[1] - x[1]); return r.length ? TOKEN_TO_FACTION[r[0]![0]]! : null; })
      .filter((f): f is string => f !== null);
    const distinctNames = [...new Set(names)];
    const out: ReplayPlayer[] = [];
    for (let i = 0; i < distinctNames.length; i++) out.push({ name: distinctNames[i]!, faction: armyFactions[i] ?? null });
    return out.slice(0, 4);
  } catch { return []; }
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
    players: extractReplayPlayers(buf),
  };
}
