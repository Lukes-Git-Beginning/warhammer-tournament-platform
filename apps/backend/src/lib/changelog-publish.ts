import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { postChannelMessage, isBotConfigured } from './discord-notify.js';

/**
 * Publish the versioned CHANGELOG.md to the Discord changelog channel from the server
 * (where the bot token lives), so an admin can post release notes via a single API call
 * — no external tooling, no local token. Dry-run by default; `confirm` actually posts.
 */

const DEFAULT_CHANGELOG_CHANNEL_ID = '1530338921903427665';
const DISCORD_MAX = 1900; // hard limit is 2000 — keep headroom
const POST_DELAY_MS = 1200; // stay comfortably under Discord's per-channel rate limit

export function changelogChannelId(): string {
  return process.env.DISCORD_CHANGELOG_CHANNEL_ID?.trim() || DEFAULT_CHANGELOG_CHANNEL_ID;
}

/** Locate CHANGELOG.md at the repo root, robust to the dist/src layout and the process cwd. */
function resolveChangelogPath(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), 'CHANGELOG.md'),
    resolve(process.cwd(), '../../CHANGELOG.md'),
    resolve(here, '../../../../CHANGELOG.md'), // apps/backend/{dist,src}/lib -> repo root
    resolve(here, '../../../CHANGELOG.md'),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error(`CHANGELOG.md not found (tried: ${candidates.join(', ')})`);
  return found;
}

export interface ChangelogSection {
  version: string; // e.g. "1.4.0" — the bracketed token in the heading
  heading: string; // the raw "## [x.y.z] — …" line
  body: string; // the full section text incl. heading, trimmed
}

/**
 * Parse every released `## [x.y.z] …` section (skips `## [Unreleased]`), returned newest
 * first as they appear in the file.
 */
export function parseChangelog(md: string): ChangelogSection[] {
  const lines = md.split('\n');
  const headingIdx = lines
    .map((l, i) => (/^##\s+\[/.test(l) ? i : -1))
    .filter((i) => i >= 0);

  const out: ChangelogSection[] = [];
  for (let k = 0; k < headingIdx.length; k++) {
    const start = headingIdx[k]!;
    const end = headingIdx[k + 1] ?? lines.length;
    const heading = lines[start]!;
    const versionMatch = heading.match(/^##\s+\[([^\]]+)\]/);
    const version = versionMatch?.[1] ?? '';
    if (/unreleased/i.test(version)) continue;
    out.push({ version, heading, body: lines.slice(start, end).join('\n').trim() });
  }
  return out;
}

/** Split a section into <=max-char messages on line boundaries. */
function chunk(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && cur.length + 1 + line.length > max) {
      out.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) out.push(cur);
  return out;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export interface PublishResult {
  channelId: string;
  dryRun: boolean;
  posted: Array<{ version: string; parts: number; chars: number }>;
  skipped: string[]; // versions filtered out
  /** Set when a live post failed partway: the versions in `posted` went through, the rest did not. */
  error?: string;
  failedAt?: string; // the version whose post failed
}

/**
 * Read CHANGELOG.md and post the selected released sections to the changelog channel,
 * oldest first (so the channel reads chronologically). `confirm=false` (default) is a
 * dry-run that returns exactly what would be posted without touching Discord. `versions`
 * optionally restricts to specific version strings (e.g. ['1.4.0']); omitted = all.
 */
export async function publishChangelog(opts: {
  confirm: boolean;
  versions?: string[];
}): Promise<PublishResult> {
  const md = readFileSync(resolveChangelogPath(), 'utf8');
  const all = parseChangelog(md);
  const wanted = opts.versions && opts.versions.length > 0 ? new Set(opts.versions) : null;

  // Oldest first for posting so the channel reads top-to-bottom in release order.
  const selected = [...all].reverse().filter((s) => (wanted ? wanted.has(s.version) : true));
  const skipped = wanted ? [...wanted].filter((v) => !all.some((s) => s.version === v)) : [];

  const channelId = changelogChannelId();
  const posted: PublishResult['posted'] = [];

  if (opts.confirm && !isBotConfigured()) {
    throw new Error('DISCORD_BOT_TOKEN not set — cannot post');
  }

  for (const section of selected) {
    const parts = chunk(section.body, DISCORD_MAX);
    if (opts.confirm) {
      try {
        for (const part of parts) {
          await postChannelMessage(channelId, part);
          await sleep(POST_DELAY_MS);
        }
      } catch (err) {
        // Stop on the first failure and report exactly what already posted, so the caller
        // can re-run with `versions` set to just the remaining ones (no duplicates).
        return {
          channelId,
          dryRun: false,
          posted,
          skipped,
          error: err instanceof Error ? err.message : String(err),
          failedAt: section.version,
        };
      }
    }
    posted.push({ version: section.version, parts: parts.length, chars: section.body.length });
  }

  return { channelId, dryRun: !opts.confirm, posted, skipped };
}
