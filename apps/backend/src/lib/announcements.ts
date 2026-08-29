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
import { z } from 'zod';

export const ANNOUNCEMENT_DESTINATIONS_CONFIG_KEY = 'announcement_destinations';

// Sonnet 4.6 — plenty for short marketing copy, and cheaper than Opus for the
// N-destinations-per-tournament fan-out (each call reuses the cached facts).
const ANNOUNCEMENT_MODEL = 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// Destinations (persisted as AdminConfig JSON)
// ---------------------------------------------------------------------------

export const AnnouncementLengthSchema = z.enum(['SHORT', 'MEDIUM', 'LONG']);
export type AnnouncementLength = z.infer<typeof AnnouncementLengthSchema>;

export const AnnouncementDestinationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(120),
  /** Free-text focus/brief: what this server needs emphasised or assumed. */
  brief: z.string().max(4000).default(''),
  /** Free-text tone note, e.g. "warm and inviting to newcomers" or "plain". */
  tone: z.string().max(400).default(''),
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
  const parsed = AnnouncementDestinationsSchema.safeParse(value);
  return parsed.success ? parsed.data : [];
}

export function isAnnouncementAiConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
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

const MODE_EXPLAIN: Record<string, string> = {
  BPT: 'Every match includes a blind faction pick phase.',
  SFT: 'Players pre-select a faction at registration; revealed at tournament start.',
  SLT: 'Players upload their army list at registration; revealed after each completed match.',
  MATRIX: 'Each match: both players pick 3 factions blindly, then ban from the 3×3 grid.',
  TWO_D_THREE: 'Players pick 3 factions at registration; one is drawn at random for each game.',
  FREE_PICK: 'Each player chooses at registration: a fixed faction or to pick match-by-match.',
  ONE_V_THREE: "A coin flip sets roles: one player runs the host's set faction, the other brings three.",
  FACTION_WAR: 'Like SFT, but factions are exclusive — first come, first served, no mirror matches.',
};

const FORMAT_EXPLAIN: Record<string, string> = {
  SINGLE_ELIMINATION: "Single-elimination bracket — lose once and you're out.",
  DOUBLE_ELIMINATION: "Double-elimination bracket — two losses and you're out.",
  SWISS: 'Swiss rounds — everyone plays a fixed number of rounds, paired by record; no early elimination.',
  AUTO_SWISS: 'Self-running Swiss — rounds and playoffs are set automatically from the check-in count.',
  ROUND_ROBIN: 'Round robin — everyone plays everyone once.',
  LIECHTENSTEIN: 'Liechtenstein — a pre-drawn schedule with unique pairings every round.',
  BALANCED_LIECHTENSTEIN: 'Balanced Liechtenstein — skill-banded Swiss; each division plays its own playoff.',
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
  frontendUrl: string;
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
  lines.push(`Format: ${label(FORMAT_LABELS, t.format)} — ${label(FORMAT_EXPLAIN, t.format)}`);
  lines.push(`Mode: ${label(MODE_LABELS, t.mode)} — ${MODE_EXPLAIN[t.mode] ?? ''}`.trimEnd());
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
  parts.push(`Tone: ${d.tone.trim() || 'plain and direct'}`);
  parts.push(`Focus / brief: ${d.brief.trim() || 'none — use the standard facts'}`);
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

  const client = new Anthropic({ apiKey });
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
