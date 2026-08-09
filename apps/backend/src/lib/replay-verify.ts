// Replay verification: compare a replay's extracted metadata against the reported game and
// return the specific discrepancies (if any). Used at report time to flag a mismatch so the
// reporter can either upload the correct replay or explain the deviation for host review.
//
// Design (Alex, 2026-08-03): FLAG, never hard-reject on the parse itself — an inconclusive
// signal (empty extraction, unknown map) is skipped, so a parser edge-case never blocks an
// honest report. Only a POSITIVE contradiction produces an issue.

import { parseReplayMeta } from './replay-parser.js';
import { mapNameFromTerrain } from './replay-maps.js';

/** How far BEFORE the match was generated a replay may have been recorded (clock skew grace).
 *  Recorded meaningfully earlier than this ⇒ a recycled/old replay. */
const RECYCLE_GRACE_MS = 12 * 60 * 60 * 1000; // 12h

export type ReplayIssueType = 'FACTIONS' | 'MAP' | 'PLAYER' | 'RECORDED_TIME';

export interface ReplayIssue {
  type: ReplayIssueType;
  /** Human-readable "reported X — replay shows Y". */
  message: string;
}

export interface ExpectedGame {
  /** Reported faction slugs (both sides). */
  factionSlugs: string[];
  /** Reported Map name (Map.name), or null when the game has no map recorded. */
  mapName: string | null;
  /** When the match was generated — the recycled-replay reference point. */
  matchCreatedAt: Date;
  /** The two participants' current Steam persona names (from fetchSteamPersonaNames). */
  steamPersonaNames: string[];
}

export interface ReplayVerification {
  /** True when no contradiction was found (matches, or every signal was inconclusive). */
  ok: boolean;
  issues: ReplayIssue[];
}

const titleCase = (slug: string): string =>
  slug.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
/** Alphanumeric-only, lowercased — for name matching that ignores clan-tag brackets/pipes/spaces.
 *  The game strips some punctuation when recording (Steam "[-ODM-] flower" → replay "-ODM- flower"),
 *  so an exact substring check false-flags an honest replay; normalising both sides fixes that. */
export const normName = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const sameSet = (a: string[], b: string[]): boolean => {
  const A = [...a].sort(), B = [...b].sort();
  return A.length === B.length && A.every((x, i) => x === B[i]);
};

/** The Chaos-god factions. Distinguishing these from each other and from daemons_of_chaos /
 *  Warriors of Chaos in a replay is genuinely ambiguous (a daemons army fields god units; mono-god
 *  and Warriors rosters overlap), so a faction diff *entirely within this family* is unreliable and
 *  must not raise a false flag — validated over 2209 prod replays (86% of faction-only flags were
 *  chaos-god). A real wrong replay by such a player is still caught by the map / name / time signals. */
export const CHAOS_GODS = new Set(['daemons_of_chaos', 'khorne', 'nurgle', 'tzeentch', 'slaanesh', 'warriors_of_chaos']);
/** True when every faction that differs between the two sets is a Chaos-god (→ suppress the flag). */
export const diffIsChaosGodOnly = (a: string[], b: string[]): boolean => {
  const A = new Set(a), B = new Set(b);
  const diff = [...new Set([...a, ...b])].filter((f) => A.has(f) !== B.has(f));
  return diff.length > 0 && diff.every((f) => CHAOS_GODS.has(f));
};

/** Compare an already-extracted replay against the expected game. Pure + synchronous. */
export function verifyReplayMeta(
  meta: ReturnType<typeof parseReplayMeta>,
  expected: ExpectedGame,
): ReplayVerification {
  const issues: ReplayIssue[] = [];

  // Factions — only when the replay yielded two (or a mirror pair). Empty/partial → inconclusive.
  // A discrepancy confined to the Chaos-god family is suppressed (unreliable to tell apart).
  if (meta.factions.length >= 1 && expected.factionSlugs.length === 2) {
    const got = meta.factions.length === 1 ? [meta.factions[0]!, meta.factions[0]!] : meta.factions;
    if (!sameSet(got, expected.factionSlugs) && !diffIsChaosGodOnly(got, expected.factionSlugs)) {
      issues.push({
        type: 'FACTIONS',
        message: `Reported ${expected.factionSlugs.map(titleCase).join(' vs ')} — replay shows ${got.map(titleCase).join(' vs ')}`,
      });
    }
  }

  // Map — only when both the reported map and the replay terrain resolve to a known name.
  const replayMap = mapNameFromTerrain(meta.mapTerrain);
  if (replayMap && expected.mapName && replayMap !== expected.mapName) {
    issues.push({
      type: 'MAP',
      message: `Reported "${expected.mapName}" — replay is on "${replayMap}"`,
    });
  }

  // Recorded time — replay recorded well before the match was generated ⇒ recycled/old replay.
  if (meta.recordedAt && meta.recordedAt.getTime() < expected.matchCreatedAt.getTime() - RECYCLE_GRACE_MS) {
    issues.push({
      type: 'RECORDED_TIME',
      message: `Replay was recorded ${meta.recordedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC — before this match was created`,
    });
  }

  // Player names — the reported participants' current Steam names vs the names the replay actually
  // recorded, by EXACT alphanumeric-normalised equality (case, brackets, pipes, spaces and glyphs
  // collapse, so Steam "[-ODM-] flower" == replay "-ODM- flower"). Exact, NOT substring: a shared
  // clan token (`odm`, `rtk`, … — present in a large share of names) must never make two different
  // people match. Flag PLAYER only when NEITHER reported player equals any recorded name (a wholly
  // foreign replay); a single rename/tag change still leaves the other player matching. Skipped when
  // the replay yielded no names (inconclusive → fail-open).
  const replayNorms = new Set(meta.players.map((p) => normName(p.name)).filter((n) => n.length >= 2));
  const personas = expected.steamPersonaNames.filter(Boolean);
  if (replayNorms.size > 0 && personas.length > 0) {
    const matches = (persona: string): boolean => {
      const ns = normName(persona);
      return ns.length >= 2 && replayNorms.has(ns);
    };
    if (!personas.some(matches)) {
      issues.push({
        type: 'PLAYER',
        message: `None of the reported players (${personas.join(', ')}) appear among the replay's recorded names (${meta.players.map((p) => p.name).join(', ')})`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Convenience: extract + verify a replay buffer against the expected game. */
export function verifyReplay(buffer: Buffer, expected: ExpectedGame): ReplayVerification {
  return verifyReplayMeta(parseReplayMeta(buffer), expected);
}
