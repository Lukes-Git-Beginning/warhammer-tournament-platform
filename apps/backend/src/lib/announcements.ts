/**
 * Tournament announcements — AI-generated, per-Discord-tailored copy.
 *
 * The operator (admin) keeps a global list of announcement *destinations* — each a
 * reusable brief/persona for one Discord server (its focus, tone, length, role
 * mention, intro/outro). For a given tournament we hand Claude the tournament
 * facts plus one destination's brief and get back a ready-to-paste Discord post.
 *
 * Destinations are stored under the AdminConfig key `announcement_destinations`
 * (same key/value JSON pattern as `standard_ruleset`) — no new DB model.
 *
 * Generation requires `ANTHROPIC_API_KEY` (Luke sets it on prod). Until then the
 * route returns a clean 503 and the destination management + copy UI still work.
 */
import Anthropic from '@anthropic-ai/sdk';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { slugifyRef } from './referrals.js';

export const ANNOUNCEMENT_DESTINATIONS_CONFIG_KEY = 'announcement_destinations';
export const ANNOUNCEMENT_DRAFTS_CONFIG_KEY = 'announcement_drafts';
export const ANNOUNCEMENT_PUSH_TOKEN_HASH_KEY = 'announcement_push_token_hash';

// Model for announcement copy — a Sonnet-tier model is plenty for short marketing
// text and far cheaper than Opus for the N-destinations fan-out (each call reuses the
// cached facts). Env-overridable so the model can be swapped (e.g. to a newer, cheaper
// Sonnet) without a code change/deploy — just set ANNOUNCEMENT_MODEL and restart.
const ANNOUNCEMENT_MODEL = process.env.ANNOUNCEMENT_MODEL?.trim() || 'claude-sonnet-4-6';

// Bound every Anthropic call: the SDK default is a 10-minute timeout with 2 retries,
// which — across up to 10 parallel generations and our 10s shutdown guard — could hang
// deploys and rack up retries. A tight timeout + single retry keeps it snappy and cheap.
const ANTHROPIC_TIMEOUT_MS = 30_000;
const ANTHROPIC_MAX_RETRIES = 1;

// ---------------------------------------------------------------------------
// Destinations (persisted as AdminConfig JSON)
// ---------------------------------------------------------------------------

export const AnnouncementLengthSchema = z.enum(['SHORT', 'MEDIUM', 'LONG']);
export type AnnouncementLength = z.infer<typeof AnnouncementLengthSchema>;

/** How much to explain the format/mode for this destination's audience. */
export const ExplanationLevelSchema = z.enum(['NONE', 'BASIC', 'FULL']);
export type ExplanationLevel = z.infer<typeof ExplanationLevelSchema>;

export const AnnouncementDestinationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  /** Attribution ref code appended to the sign-up link as ?ref= (empty → derived from name). */
  ref: z.string().max(64).default(''),
  /** Free-text context: what this server is, its vibe, the general angle (was "tone / angle"). */
  brief: z.string().max(2000).default(''),
  /**
   * How much to explain the format/mode here. NONE = insiders, just name it; BASIC = one-line
   * reminder; FULL = real explanation (still scaled by how novel the format is — see writing rules).
   */
  explain_level: ExplanationLevelSchema.default('NONE'),
  /** Must-include points (e.g. "the cash prize; DLC for semi-finalists"). */
  always_mention: z.string().max(2000).default(''),
  /** What to leave out / never say. */
  avoid: z.string().max(2000).default(''),
  length: AnnouncementLengthSchema.default('MEDIUM'),
  /** Verbatim Discord mention(s) to lead with, e.g. "@everyone" or "<@&123>". */
  role_mention: z.string().max(400).default(''),
  intro: z.string().max(2000).default(''),
  outro: z.string().max(2000).default(''),
});
export type AnnouncementDestination = z.infer<typeof AnnouncementDestinationSchema>;

export const AnnouncementDestinationsSchema = z.array(AnnouncementDestinationSchema);

/**
 * Parse a raw AdminConfig value into a destination list (empty on missing/invalid).
 * PURE — the caller reads the AdminConfig row (keeps this module DB-free/testable).
 */
export function parseAnnouncementDestinations(value: unknown): AnnouncementDestination[] {
  // Migrate legacy fields in place: the old "tone" field is now "brief" (zod would strip it
  // otherwise, losing an existing destination's context). Old explain/assume_known are dropped.
  const migrated = Array.isArray(value)
    ? value.map((item) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          const o = item as Record<string, unknown>;
          if (o.brief === undefined && typeof o.tone === 'string') return { ...o, brief: o.tone };
        }
        return item;
      })
    : value;
  const parsed = AnnouncementDestinationsSchema.safeParse(migrated);
  return parsed.success ? parsed.data : [];
}

export function isAnnouncementAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// ---------------------------------------------------------------------------
// Drafts (pushed back from a Claude Code session) + the scoped push token.
// Drafts are stored as an AdminConfig map keyed by slug so several upcoming
// tournaments can hold drafts at once.
// ---------------------------------------------------------------------------

export const AnnouncementDraftResultSchema = z.object({
  destinationId: z.string().min(1),
  name: z.string().min(1).max(200),
  text: z.string().max(8000),
});
export type AnnouncementDraftResult = z.infer<typeof AnnouncementDraftResultSchema>;

export const AnnouncementDraftPushSchema = z.object({
  slug: z.string().min(1),
  results: z.array(AnnouncementDraftResultSchema).min(1).max(20),
});

/** One tournament's stored drafts. */
export const AnnouncementDraftEntrySchema = z.object({
  generatedAt: z.string(),
  results: z.array(AnnouncementDraftResultSchema),
});
export type AnnouncementDraftEntry = z.infer<typeof AnnouncementDraftEntrySchema>;

/** The whole drafts store: slug → entry. */
export const AnnouncementDraftsSchema = z.record(z.string(), AnnouncementDraftEntrySchema);
export type AnnouncementDrafts = z.infer<typeof AnnouncementDraftsSchema>;

export function parseAnnouncementDrafts(value: unknown): AnnouncementDrafts {
  const parsed = AnnouncementDraftsSchema.safeParse(value);
  return parsed.success ? parsed.data : {};
}

// --- Push token (a scoped, non-expiring credential — writes drafts, nothing else) ---

/** Generate a fresh push token (returned once to the admin, never stored in clear). */
export function generatePushToken(): string {
  return randomBytes(32).toString('hex');
}

/** SHA-256 of a token — only the hash is persisted. */
export function hashPushToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Constant-time check of a presented token against the stored hash. */
export function pushTokenMatches(presented: string, storedHash: string | null | undefined): boolean {
  if (!storedHash || !presented) return false;
  const a = Buffer.from(hashPushToken(presented), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------------------
// Tournament facts (PURE — unit-testable)
// ---------------------------------------------------------------------------

// Short human labels + explanations. Mirrors the frontend
// `lib/tournamentDescriptions.ts` (backend can't import across the app boundary);
// keep the two in sync when adding a format/mode.
const FORMAT_LABELS: Record<string, string> = {
  SINGLE_ELIMINATION: 'Single Elimination',
  DOUBLE_ELIMINATION: 'Double Elimination',
  SWISS: 'Swiss',
  AUTO_SWISS: 'Auto Swiss',
  ROUND_ROBIN: 'Round Robin',
  DOUBLE_ROUND_ROBIN: 'Double Round Robin',
  LIECHTENSTEIN: 'Liechtenstein',
  BALANCED_LIECHTENSTEIN: 'Balanced Liechtenstein',
};

const MODE_LABELS: Record<string, string> = {
  ONE_V_ONE: '1v1',
  THREE_V_THREE: '3v3',
  BLIND_PICK: 'Blind Pick',
  BPT: 'Blind Pick Tournament',
  SFT: 'Set Faction Tournament',
  SLT: 'Set List Tournament',
  MATRIX: '3×3 Faction Matrix',
  TWO_D_THREE: '2D3',
  FREE_PICK: 'Free Pick',
  ONE_V_THREE: '1v3',
  FACTION_WAR: 'Faction War',
};

// These MUST match the site's canonical descriptions VERBATIM (frontend
// `lib/tournamentDescriptions.ts` MODE_DESCRIPTIONS / FORMAT_DESCRIPTIONS) — announcements
// use the site's default wording, never a paraphrase. Keep them byte-identical if either
// side changes.
const MODE_EXPLAIN: Record<string, string> = {
  BPT: 'Every match includes a blind faction pick phase.',
  SFT: 'Players pre-select a faction at registration; revealed at tournament start.',
  SLT: 'Players upload their army list at registration. Reveal after each completed match.',
  MATRIX: 'Each match: both players pick 3 factions blindly, then ban from the 3×3 matchup grid.',
  TWO_D_THREE: 'Players pick 3 factions at registration; one is drawn at random for each player before every game.',
  FREE_PICK:
    'Each player chooses at registration: a fixed faction (like SFT) or to pick match-by-match. Two fixed players just play their factions; two pick-later players do a 3×3 matrix; a fixed vs pick-later match has the pick-later player offer 3 factions for the fixed player to choose from.',
  ONE_V_THREE:
    "A coin flip sets roles each match: one player runs the host's set faction, the other brings three, and the set-faction player picks which of the three their opponent plays.",
  FACTION_WAR:
    'Like SFT, but every faction is exclusive: once a player claims a faction at registration, no one else can pick it — first come, first served, and no mirror matches.',
};

const FORMAT_EXPLAIN: Record<string, string> = {
  SINGLE_ELIMINATION: "Single-elimination bracket — lose once and you're out. Optional third-place match.",
  DOUBLE_ELIMINATION: "Double-elimination bracket — a loss drops you to the lower bracket; two losses and you're out.",
  SWISS: 'Swiss rounds — everyone plays a fixed number of rounds, paired by record, with no early elimination. Optional top-cut playoffs.',
  AUTO_SWISS: 'Self-running Swiss — rounds, playoff size and match format are set automatically from the check-in count, and rounds advance on their own.',
  ROUND_ROBIN: 'Round robin — everyone plays everyone once.',
  LIECHTENSTEIN: 'Liechtenstein — a pre-drawn schedule with unique pairings every round (no repeat opponents).',
  BALANCED_LIECHTENSTEIN: 'Balanced Liechtenstein — skill-banded asynchronous Swiss: players are paired within their division, and each division plays its own playoff.',
};

function label(map: Record<string, string>, key: string): string {
  return map[key] ?? key.replace(/_/g, ' ');
}

/** Discord absolute-time token (`<t:unix:F>`) — renders in each reader's own timezone. */
function discordTime(date: Date): string {
  return `<t:${Math.floor(date.getTime() / 1000)}:F>`;
}

export interface TournamentFactsInput {
  name: string;
  slug: string;
  format: string;
  mode: string;
  /** The host's own description text — lean on this heavily when writing. */
  description?: string | null;
  startDate: Date | null;
  registrationDeadline: Date | null;
  maxParticipants: number | null;
  participantCount: number;
  entryFee: string | null;
  rules: string | null;
  standardRulesEnabled: boolean;
  restrictions: string | null;
  factionNames: string[];
  mapNames: string[];
  discordLink: string | null;
  streamUrl: string | null;
  isMajor: boolean;
  /** Configured playoff shape (TOP2/TOP4/TOP8/NONE), fixed at creation — state it, don't hedge. */
  playoffFormat?: string | null;
  /** Configured Swiss/BaLi round count if already set; null → derive the plan from the format. */
  roundsCount?: number | null;
  /** Whether a third-place match is set for this tournament (concrete, not the abstract "optional"). */
  hasThirdPlaceMatch?: boolean | null;
  frontendUrl: string;
}

/**
 * Human "planned structure" line: the fixed round + playoff plan for this tournament, so the
 * announcement can state it concretely instead of hedging. BaLi's round count is capped at 4
 * (4 at 8+ players, 3 under 8) per `balancedRounds`; other formats state the stored count if any.
 */
function planLine(format: string, roundsCount: number | null | undefined, playoffFormat: string | null | undefined): string | null {
  const parts: string[] = [];
  if (roundsCount && roundsCount > 0) {
    parts.push(`${roundsCount} rounds`);
  } else if (format === 'BALANCED_LIECHTENSTEIN') {
    parts.push('4 rounds (drops to 3 if fewer than 8 players sign up)');
  }
  const pf = (playoffFormat ?? '').toUpperCase();
  if (pf && pf !== 'NONE') {
    const label = pf === 'TOP2' ? 'a TOP 2 final' : pf === 'TOP4' ? 'TOP 4 playoffs' : pf === 'TOP8' ? 'TOP 8 playoffs' : `${pf} playoffs`;
    parts.push(label);
  }
  return parts.length > 0 ? `Planned structure: ${parts.join(', then ')}.` : null;
}

export interface TournamentFacts {
  name: string;
  signupUrl: string;
  /** Rendered fact block handed to the model as the source of truth. */
  block: string;
}

/**
 * Turn a tournament (with faction/map names already resolved) into the fact
 * block the model gets. PURE: no I/O, no env reads — the caller supplies
 * `frontendUrl`. Only includes fields that are actually set.
 */
export function buildTournamentFacts(t: TournamentFactsInput): TournamentFacts {
  const base = t.frontendUrl.replace(/\/+$/, '');
  const signupUrl = `${base}/tournaments/${t.slug}`;

  const lines: string[] = [];
  lines.push(`Tournament name: ${t.name}`);
  if (t.isMajor) lines.push('This is a MAJOR tournament (counts extra on the leaderboard).');
  const description = (t.description ?? '').trim();
  if (description) lines.push(`Host's description (lean on this — lift wording where it's good): ${truncate(description, 1500)}`);
  lines.push(`Format: ${label(FORMAT_LABELS, t.format)}. Reference explanation (use only per the destination's explanation level — do NOT recite verbatim to insiders): ${label(FORMAT_EXPLAIN, t.format)}`);
  const modeExplain = MODE_EXPLAIN[t.mode] ?? '';
  lines.push(`Mode: ${label(MODE_LABELS, t.mode)}.${modeExplain ? ` Reference explanation (same caveat): ${modeExplain}` : ''}`);
  const plan = planLine(t.format, t.roundsCount, t.playoffFormat);
  if (plan) lines.push(plan);
  // Only surface a third-place match when it EXISTS (a positive detail, e.g. if a prize is on it).
  // Never announce its absence, and don't force it into every post — see writing rules.
  if (t.hasThirdPlaceMatch) {
    lines.push('There is a third-place match (semifinal losers play for 3rd). Only mention it if a prize is on it or it is worth highlighting — not by default.');
  }
  lines.push(`Sign-up link: ${signupUrl}`);
  if (t.startDate) lines.push(`Starts: ${discordTime(t.startDate)}`);
  if (t.registrationDeadline) lines.push(`Registration deadline: ${discordTime(t.registrationDeadline)}`);

  const cap = t.maxParticipants ? ` (cap ${t.maxParticipants})` : '';
  lines.push(`Players registered so far: ${t.participantCount}${cap}`);

  if (t.entryFee && t.entryFee.trim()) lines.push(`Entry fee: ${t.entryFee.trim()}`);

  if (t.factionNames.length > 0) {
    lines.push(`Faction pool (only these are allowed): ${t.factionNames.join(', ')}`);
  } else {
    lines.push('Faction pool: all factions allowed.');
  }
  if (t.mapNames.length > 0) lines.push(`Map pool: ${t.mapNames.join(', ')}`);

  if (t.standardRulesEnabled) {
    lines.push('The community Standard Ruleset applies (funds, unit scale, ticket count, banned units, conduct).');
  }
  const restrictions = (t.restrictions ?? '').trim();
  if (restrictions) lines.push(`Custom restrictions: ${truncate(restrictions, 600)}`);
  const rules = (t.rules ?? '').trim();
  if (rules) lines.push(`Rules notes: ${truncate(rules, 600)}`);

  if (t.discordLink) lines.push(`Discord invite: ${t.discordLink}`);
  if (t.streamUrl) lines.push(`Stream: ${t.streamUrl}`);

  return { name: t.name, signupUrl, block: lines.join('\n') };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// Prompt assembly (PURE) — for the "Copy prompt for Claude" button. Produces a
// self-contained instruction that, pasted into a Claude Code session, tells the
// assistant to write one polished Discord post per destination and push the
// results back to the site. No LLM call, no API key — just text assembly.
// ---------------------------------------------------------------------------

const EXPLAIN_LEVEL_HINT: Record<ExplanationLevel, string> = {
  NONE: 'insiders — name the format/mode, no explanation at all',
  BASIC: 'a one-line reminder, not a tutorial',
  FULL: 'real explanation — but standard formats (Swiss, elimination) still get at most a line; only novel ones (Balanced Liechtenstein, our custom modes) get a genuine explanation',
};

export function buildAnnouncementPrompt(
  facts: TournamentFacts,
  posterUrl: string | null,
  slug: string,
  destinations: AnnouncementDestination[],
  notes?: string | null,
): string {
  const out: string[] = [];
  out.push(
    "Write Discord tournament announcements for RizzOtto's Arena (rizzotto.gg). Produce ONE ready-to-paste " +
      "Discord post per destination below, in Alex's own plain, direct voice. Follow the announcement-writing-rules " +
      'in project memory (recalled automatically). Key points: the audience are Total War tournament REGULARS by ' +
      'default, so do NOT explain the scene or formats as if new — honour each destination\'s explanation level. ' +
      "Lean hard on the host's description (lift wording where it's good). State the concrete plan (rounds, playoff), " +
      'do not hedge. No filler openers or sign-offs, no fluff, no em dashes. Light Discord markdown only. Always ' +
      'include the sign-up link, with ?ref=<the destination ref> appended, wrapped in <> to suppress its preview. ' +
      "If there is a poster, attach it by turning the post's FINAL period into a masked link — e.g. `…Bo3.` becomes " +
      '`…Bo3[.](POSTER_URL)` (Discord shows the image, no visible URL). If no closing period, append `[.](POSTER_URL)` ' +
      'on its own final line. Preserve any <t:…> timestamp tokens exactly. Role mention (if any) on the first line; ' +
      'use intro/outro if given.',
  );
  out.push('');
  out.push(
    `When the posts are ready, push them to the site: POST https://rizzotto.gg/api/announcements/push with ` +
      `{ "slug": "${slug}", "results": [{ "destinationId", "name", "text" }, …] } and the stored announcement ` +
      `push token in the X-Push-Token header. Then they appear in the Announcements tab with a Copy button per ` +
      `destination.`,
  );
  out.push('');
  out.push('=== TOURNAMENT FACTS (source of truth — do not invent beyond these) ===');
  out.push(facts.block);
  out.push(`Poster link: ${posterUrl ?? 'none'}`);
  const trimmedNotes = (notes ?? '').trim();
  if (trimmedNotes) {
    out.push('');
    out.push('=== SPECIFIC TO THIS ANNOUNCEMENT (host notes — weave in, this is what matters most this time) ===');
    out.push(trimmedNotes);
  }
  out.push('');
  out.push('=== DESTINATIONS ===');
  if (destinations.length === 0) {
    out.push('(none configured — write one general-purpose announcement)');
  } else {
    destinations.forEach((d, i) => {
      out.push(`[${i + 1}] destinationId=${d.id}`);
      out.push(`    name: ${d.name}`);
      out.push(`    sign-up ref (append ?ref=<this> to the sign-up link): ${d.ref.trim() || slugifyRef(d.name)}`);
      out.push(`    length: ${d.length}`);
      out.push(`    explanation level: ${d.explain_level} (${EXPLAIN_LEVEL_HINT[d.explain_level]})`);
      out.push(`    general brief (what this server is / the angle): ${d.brief.trim() || 'plain and direct, insider audience'}`);
      out.push(`    always mention: ${d.always_mention.trim() || 'none'}`);
      out.push(`    avoid / never say: ${d.avoid.trim() || 'none'}`);
      out.push(`    role mention: ${d.role_mention.trim() || 'none'}`);
      out.push(`    intro: ${d.intro.trim() || 'none'}`);
      out.push(`    outro: ${d.outro.trim() || 'none'}`);
    });
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------
// Generation (Anthropic)
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You write short Discord announcement posts for Total War: Warhammer tournaments hosted on Rizzotto (rizzotto.gg). The operator pastes your text, unedited, into one specific Discord server, so it must be ready to post as-is.

Rules:
- Write in plain, direct English. Be genuine and clear. Do NOT invent lore, grimdark flavour, faux-medieval phrasing, or made-up "Karaz Ankor"-style names. Never state facts that are not in the tournament facts below.
- Output ONLY the message text. No preamble, no explanation, no code fences, no "Here is the post".
- Use light Discord markdown: **bold** for the title/key facts, bullet lists for details, the occasional heading (#). Do not overformat.
- Always include the sign-up link exactly as given.
- Preserve any <t:NUMBER:STYLE> timestamp tokens EXACTLY as written — Discord renders them in each reader's local time. Never replace one with a literal date or time.
- Respect the destination's brief, tone, length and focus. Some servers need extra context (e.g. spelling out what a specific ruleset or mode means); others assume it. Some must be especially welcoming to newcomers; others can be plain.
- Emojis: none by default; at most one or two, and only if the destination's tone clearly invites it.
- If a role mention is provided, put it on its very first line, alone.
- If an intro or outro is provided, use it (you may lightly adapt for flow) at the start / end.
- Length: SHORT = 2–3 sentences. MEDIUM = one short paragraph plus the key facts as a few bullets. LONG = two short paragraphs with more context and a warm invitation.`;

function buildDestinationInstruction(d: AnnouncementDestination): string {
  const parts: string[] = [];
  parts.push(`Write the announcement for this destination server.`);
  parts.push(`Destination: ${d.name}`);
  parts.push(`Length: ${d.length}`);
  parts.push(`Explanation level: ${d.explain_level} (${EXPLAIN_LEVEL_HINT[d.explain_level]})`);
  parts.push(`General brief (what this server is / the angle): ${d.brief.trim() || 'plain and direct, insider audience'}`);
  parts.push(`Always mention: ${d.always_mention.trim() || 'none'}`);
  parts.push(`Avoid / never say: ${d.avoid.trim() || 'none'}`);
  parts.push(`Role mention to lead with: ${d.role_mention.trim() || 'none'}`);
  parts.push(`Intro to use: ${d.intro.trim() || 'none'}`);
  parts.push(`Outro to use: ${d.outro.trim() || 'none'}`);
  return parts.join('\n');
}

function maxTokensForLength(length: AnnouncementLength): number {
  if (length === 'SHORT') return 400;
  if (length === 'LONG') return 1400;
  return 800;
}

function extractText(message: Anthropic.Message): string {
  return message.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * Generate one destination's announcement. Caches the system prompt + tournament
 * facts (they're identical across every destination in a request), so a fan-out
 * over N destinations only pays for the facts once.
 */
export async function generateAnnouncement(args: {
  facts: TournamentFacts;
  destination: AnnouncementDestination;
}): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');

  const client = new Anthropic({
    apiKey,
    timeout: ANTHROPIC_TIMEOUT_MS,
    maxRetries: ANTHROPIC_MAX_RETRIES,
  });
  const message = await client.messages.create({
    model: ANNOUNCEMENT_MODEL,
    max_tokens: maxTokensForLength(args.destination.length),
    system: [
      { type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
      {
        type: 'text',
        text: `Tournament facts (the source of truth — do not add anything beyond these):\n\n${args.facts.block}`,
        cache_control: { type: 'ephemeral' },
      },
    ],
    messages: [{ role: 'user', content: buildDestinationInstruction(args.destination) }],
  });

  return extractText(message);
}
