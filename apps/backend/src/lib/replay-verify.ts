// Replay verification: compare a replay's extracted metadata against the reported game and
// return the specific discrepancies (if any). Used at report time to flag a mismatch so the
// reporter can either upload the correct replay or explain the deviation for host review.
//
// Design (Alex, 2026-08-03): FLAG, never hard-reject on the parse itself — an inconclusive
// signal (empty extraction, unknown map) is skipped, so a parser edge-case never blocks an
// honest report. Only a POSITIVE contradiction produces an issue.

import { parseReplayMeta, replayContainsName } from './replay-parser.js';
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
const sameSet = (a: string[], b: string[]): boolean => {
  const A = [...a].sort(), B = [...b].sort();
  return A.length === B.length && A.every((x, i) => x === B[i]);
};

/** Compare an already-extracted replay against the expected game. Pure + synchronous. */
export function verifyReplayMeta(
  meta: ReturnType<typeof parseReplayMeta>,
  containsName: (name: string) => boolean,
  expected: ExpectedGame,
): ReplayVerification {
  const issues: ReplayIssue[] = [];

  // Factions — only when the replay yielded two (or a mirror pair). Empty/partial → inconclusive.
  if (meta.factions.length >= 1 && expected.factionSlugs.length === 2) {
    const got = meta.factions.length === 1 ? [meta.factions[0]!, meta.factions[0]!] : meta.factions;
    if (!sameSet(got, expected.factionSlugs)) {
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

  // Player names — each participant's Steam name should appear in the replay (played just now).
  for (const name of expected.steamPersonaNames) {
    if (name && !containsName(name)) {
      issues.push({
        type: 'PLAYER',
        message: `"${name}" does not appear among the replay's players`,
      });
    }
  }

  return { ok: issues.length === 0, issues };
}

/** Convenience: extract + verify a replay buffer against the expected game. */
export function verifyReplay(buffer: Buffer, expected: ExpectedGame): ReplayVerification {
  const meta = parseReplayMeta(buffer);
  return verifyReplayMeta(meta, (name) => replayContainsName(buffer, name), expected);
}
