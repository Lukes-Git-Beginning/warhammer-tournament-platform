import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { PrismaClient } from '@rizzotto/db';
import type { FastifyBaseLogger } from 'fastify';
import { postChannelMessage, isBotConfigured } from './discord-notify.js';

/** AdminConfig key that stores the newest CHANGELOG version already posted to Discord. */
export const CHANGELOG_LAST_PUBLISHED_KEY = 'changelog_last_published';

/**
 * Publish the versioned CHANGELOG.md to the Discord changelog channel from the server
 * (where the bot token lives), so an admin can post release notes via a single API call
 * — no external tooling, no local token. Dry-run by default; `confirm` actually posts.
 */

const DEFAULT_CHANGELOG_CHANNEL_ID = '1530338921903427665';
const DISCORD_MAX = 1900; // hard limit is 2000 — keep headroom
const POST_DELAY_MS = 1200; // stay comfortably under Discord's per-channel rate limit

/**
 * When each version went live on prod (Unix seconds), from the deploy workflow completion
 * times. Used to stamp every changelog post with a Discord `<t:…>` timestamp so it renders in
 * each reader's own timezone. A version NOT listed here (any future release) falls back to the
 * current time — which, since new versions are auto-posted on the boot right after their deploy,
 * IS the moment they went live.
 */
export const DEPLOY_TIMESTAMPS: Record<string, number> = {
  '1.0.0': 1782586800, // launch tournament (2026-06-27 21:00 CEST)
  '1.1.0': 1782775900,
  '1.2.0': 1782949206,
  '1.3.0': 1783009142,
  '1.4.0': 1783119060,
  '1.5.0': 1783378428,
  '1.6.0': 1783463380,
  '1.7.0': 1783530362,
  '1.8.0': 1783616753,
  '1.8.1': 1783726940,
  '1.9.0': 1783795178,
  '1.10.0': 1783898826,
  '1.11.0': 1783925540,
  '1.12.0': 1784064661,
  '1.13.0': 1784198502,
  '1.14.0': 1784305379,
  '1.15.0': 1784392887,
  '1.15.1': 1784505170,
  '1.15.2': 1784590987,
  '1.16.0': 1784646227,
  '1.16.1': 1784909420,
  '1.17.0': 1784962802,
};

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

/**
 * Render a section for Discord: the changelog body plus a "went live on prod" line using a
 * Discord timestamp (`<t:unix:F>` absolute + `<t:unix:R>` relative), which each reader sees in
 * their own timezone. Historical versions use their real deploy time; a future version falls
 * back to now (= its deploy moment, since it is auto-posted on the boot right after deploy).
 */
export function renderSectionForDiscord(
  section: ChangelogSection,
  nowUnix: number = Math.floor(Date.now() / 1000),
): string {
  const ts = DEPLOY_TIMESTAMPS[section.version] ?? nowUnix;
  return `${section.body}\n\n🚀 **Live on prod:** <t:${ts}:F> · <t:${ts}:R>`;
}

/**
 * Given all sections (newest-first, as parsed) and the last-published version, return the
 * sections still to post, OLDEST-first. Everything above the last-published section is newer;
 * an unknown/absent cursor (first run) means every section is new. Pure — unit-tested.
 */
export function selectSectionsToPost(
  sections: ChangelogSection[],
  lastPublished: string | null,
): ChangelogSection[] {
  const idx = lastPublished ? sections.findIndex((s) => s.version === lastPublished) : -1;
  return (idx >= 0 ? sections.slice(0, idx) : sections).slice().reverse();
}

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
    const rendered = renderSectionForDiscord(section);
    const parts = chunk(rendered, DISCORD_MAX);
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
    posted.push({ version: section.version, parts: parts.length, chars: rendered.length });
  }

  return { channelId, dryRun: !opts.confirm, posted, skipped };
}

/**
 * Auto-publish any CHANGELOG versions that have appeared since the last one posted — called
 * once on backend boot (every deploy restarts the backend). Fully hands-off: RizzBOTto posts
 * new release notes itself. Idempotent via the `changelog_last_published` AdminConfig key, so a
 * plain restart with no new version posts nothing; the very first run backfills the whole file.
 * Posts oldest-first, advances the stored cursor after each success, and stops (without losing
 * progress) on the first failure so the next boot resumes. Never throws — logs and returns.
 */
export async function publishNewChangelogOnBoot(
  prisma: PrismaClient,
  log: FastifyBaseLogger,
): Promise<void> {
  if (!isBotConfigured()) {
    log.info('[changelog] no bot token — skipping auto-publish');
    return;
  }

  let sections: ChangelogSection[];
  try {
    sections = parseChangelog(readFileSync(resolveChangelogPath(), 'utf8'));
  } catch (err) {
    log.warn({ err: String(err) }, '[changelog] CHANGELOG.md unreadable — skipping auto-publish');
    return;
  }
  if (sections.length === 0) return;

  const row = await prisma.adminConfig.findUnique({
    where: { key: CHANGELOG_LAST_PUBLISHED_KEY },
    select: { value: true },
  });
  const lastPublished = typeof row?.value === 'string' ? row.value : null;

  // Sections newer than the last-published one, oldest-first. First run → the whole backfill.
  const toPost = selectSectionsToPost(sections, lastPublished);
  if (toPost.length === 0) {
    log.info({ lastPublished }, '[changelog] nothing new to auto-publish');
    return;
  }

  const channelId = changelogChannelId();
  log.info({ count: toPost.length, lastPublished, channelId }, '[changelog] auto-publishing new versions');

  for (const section of toPost) {
    try {
      for (const part of chunk(renderSectionForDiscord(section), DISCORD_MAX)) {
        await postChannelMessage(channelId, part);
        await sleep(POST_DELAY_MS);
      }
    } catch (err) {
      log.error({ err: String(err), version: section.version }, '[changelog] auto-publish failed — retrying next boot');
      return; // cursor left at the last success; the next boot resumes from here
    }
    await prisma.adminConfig.upsert({
      where: { key: CHANGELOG_LAST_PUBLISHED_KEY },
      create: { key: CHANGELOG_LAST_PUBLISHED_KEY, value: section.version, updated_by: 'system' },
      update: { value: section.version, updated_by: 'system' },
    });
  }
  log.info({ published: toPost.map((s) => s.version) }, '[changelog] auto-publish complete');
}
