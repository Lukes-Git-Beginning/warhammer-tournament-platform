/**
 * Post the newest CHANGELOG.md release section to the Discord changelog channel via the bot.
 *
 *   pnpm -F @rizzotto/backend exec tsx scripts/post-changelog.mts           # dry-run (prints only)
 *   pnpm -F @rizzotto/backend exec tsx scripts/post-changelog.mts --post    # actually posts
 *
 * Channel: DISCORD_CHANGELOG_CHANNEL_ID (falls back to the configured default below).
 * Token:   DISCORD_BOT_TOKEN — only needed for --post; the dry-run needs no token.
 *
 * Only HTTP; no gateway/bot process. Mirrors apps/backend/src/lib/discord-notify.ts.
 * The newest section = the first "## " heading that is NOT "[Unreleased]".
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const DISCORD_API = 'https://discord.com/api/v10';
const CHANNEL_ID = process.env.DISCORD_CHANGELOG_CHANNEL_ID?.trim() || '1530338921903427665';
const MAX = 1900; // Discord's hard limit is 2000 — keep headroom for safety.

const here = dirname(fileURLToPath(import.meta.url));
const CHANGELOG_PATH = resolve(here, '../../../CHANGELOG.md');

/** Extract the newest released section: first `## ` heading that isn't `[Unreleased]`, up to the next `## `. */
function newestSection(md: string): string {
  const lines = md.split('\n');
  const headings = lines.map((l, i) => (/^## /.test(l) ? i : -1)).filter((i) => i >= 0);
  const start = headings.find((i) => !/\[unreleased\]/i.test(lines[i]!));
  if (start === undefined) throw new Error('No released section (non-[Unreleased] "## ") found in CHANGELOG.md');
  const end = headings.find((i) => i > start) ?? lines.length;
  return lines.slice(start, end).join('\n').trim();
}

/** Split into <=max-char messages on line boundaries (Discord caps a message at 2000). */
function chunk(text: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const line of text.split('\n')) {
    if (cur && (cur.length + 1 + line.length) > max) {
      out.push(cur);
      cur = line;
    } else {
      cur = cur ? `${cur}\n${line}` : line;
    }
  }
  if (cur) out.push(cur);
  return out;
}

async function postMessage(content: string): Promise<void> {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN not set — cannot post (dry-run works without it)');
  const res = await fetch(`${DISCORD_API}/channels/${CHANNEL_ID}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  if (!res.ok) throw new Error(`Discord ${res.status}: ${await res.text()}`);
}

const doPost = process.argv.includes('--post');
const section = newestSection(readFileSync(CHANGELOG_PATH, 'utf8'));
const parts = chunk(section, MAX);

console.log(`channel: ${CHANNEL_ID}`);
console.log(`message parts: ${parts.length} (${section.length} chars)`);
console.log(doPost ? '=== POSTING ===' : '=== DRY-RUN (pass --post to actually send) ===');
console.log('─'.repeat(70));
console.log(section);
console.log('─'.repeat(70));

if (doPost) {
  for (const [i, part] of parts.entries()) {
    await postMessage(part);
    console.log(`posted part ${i + 1}/${parts.length}`);
  }
  console.log('✓ posted to the changelog channel');
}
