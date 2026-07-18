/**
 * Discord notification helpers using the Discord Bot HTTP API.
 * Only performs HTTP requests — no bot process, no gateway connection.
 *
 * If DISCORD_BOT_TOKEN is not set, all functions skip silently and log a warning.
 */

import { prisma } from '@rizzotto/db';

const DISCORD_API = 'https://discord.com/api/v10';

// ---------------------------------------------------------------------------
// Types (local — minimal shapes matching what we query from DB)
// ---------------------------------------------------------------------------

interface TournamentForNotify {
  id: string;
  name: string;
  slug: string;
  start_date: Date;
}

interface PairingForNotify {
  matchId: string;
  player1: { discord_id: string; username: string };
  player2: { discord_id: string; username: string };
  round: number;
  map?: string | null;
}

interface MatchForNotify {
  id: string;
  tournament: TournamentForNotify;
}

interface ReporterForNotify {
  id: string;
  username: string;
  discord_id: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getToken(): string | null {
  return process.env.DISCORD_BOT_TOKEN ?? null;
}

/** P7 (#50): append the host's stream link to spectator-facing DMs, if one is set. */
function streamLine(url?: string | null): string {
  return url ? `\n📺 Watch the action live: <${url}>` : '';
}

async function discordRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<Response> {
  const token = getToken();
  if (!token) throw new Error('DISCORD_BOT_TOKEN not set');

  return fetch(`${DISCORD_API}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      'Content-Type': 'application/json',
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

/** True when the guild membership lookup is configured (bot token + guild id). */
export function isGuildLookupConfigured(): boolean {
  return !!process.env.DISCORD_GUILD_ID && !!getToken();
}

/**
 * #47: given Discord user IDs, return the subset that are NOT members of the
 * configured guild. Checks each via `GET /guilds/{guild}/members/{id}` (404 = not a
 * member — the same call auth.ts uses on login). Only a hard 404 flags a non-member;
 * rate-limits / errors are treated as "unknown" and skipped to avoid false positives.
 * Returns null when the lookup isn't configured.
 */
export async function getNonGuildMemberIds(discordIds: string[]): Promise<Set<string> | null> {
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId || !getToken()) return null;

  const notMembers = new Set<string>();
  const CONCURRENCY = 8;
  for (let i = 0; i < discordIds.length; i += CONCURRENCY) {
    const batch = discordIds.slice(i, i + CONCURRENCY);
    await Promise.all(
      batch.map(async (id) => {
        try {
          const resp = await discordRequest('GET', `/guilds/${guildId}/members/${id}`);
          if (resp.status === 404) notMembers.add(id);
          // 200 = member; 429/5xx → leave as unknown (don't flag).
        } catch {
          /* network error — skip */
        }
      }),
    );
  }
  return notMembers;
}

/**
 * Open (or fetch existing) DM channel for a Discord user.
 * Returns the channel ID or null on failure.
 */
async function openDmChannel(discordUserId: string): Promise<string | null> {
  try {
    const resp = await discordRequest('POST', '/users/@me/channels', {
      recipient_id: discordUserId,
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { id: string };
    return data.id;
  } catch {
    return null;
  }
}

export async function sendDm(discordUserId: string, content: string): Promise<void> {
  const channelId = await openDmChannel(discordUserId);
  if (!channelId) return;

  await discordRequest('POST', `/channels/${channelId}/messages`, { content });
}

async function sendDmWithComponents(discordUserId: string, content: string, components: object[]): Promise<void> {
  const channelId = await openDmChannel(discordUserId);
  if (!channelId) return;

  await discordRequest('POST', `/channels/${channelId}/messages`, { content, components });
}

// Button styles
const BTN_SUCCESS = 3; // green
const BTN_SECONDARY = 2; // grey

function actionRow(buttons: object[]) {
  return { type: 1, components: buttons };
}

function button(label: string, customId: string, style: number) {
  return { type: 2, style, label, custom_id: customId };
}

// Link button (style 5) — opens a URL, does NOT fire an interaction.
function linkButton(label: string, url: string) {
  return { type: 2, style: 5, label, url };
}

/**
 * DM both players when an Open Play match is created. Result reporting happens on
 * the website (a replay is mandatory there), so this is a notification with a link
 * button to the match page — no result/cancel buttons.
 */
export async function notifyMatchFoundWithButtons(
  matchId: string,
  p1: { discordId: string; username: string },
  p2: { discordId: string; username: string },
  mapName: string | null,
): Promise<void> {
  const token = getToken();
  if (!token) return;

  const baseUrl = process.env.FRONTEND_URL ?? 'https://rizzotto.gg';
  const matchUrl = `${baseUrl}/matches/${matchId}`;
  const mapLine = mapName ? ` · Map: **${mapName}**` : '';

  const buildDm = (opponent: typeof p1) => ({
    content: `⚔️ Match found! Open Play vs <@${opponent.discordId}>${mapLine}\nPick your faction and report the result with your replay on the website:`,
    components: [actionRow([linkButton('Open match', matchUrl)])],
  });

  const [ch1, ch2] = await Promise.all([openDmChannel(p1.discordId), openDmChannel(p2.discordId)]);

  await Promise.allSettled([
    ch1 ? discordRequest('POST', `/channels/${ch1}/messages`, buildDm(p2)) : Promise.resolve(),
    ch2 ? discordRequest('POST', `/channels/${ch2}/messages`, buildDm(p1)) : Promise.resolve(),
  ]);
}

/**
 * DM both players ~1h before their scheduled match with a ready-check button.
 * custom_id format: sc_ready:<matchupId>:<receiverDiscordId>
 */
export async function notifyScheduledMatchReminder(
  matchupId: string,
  proposedAt: Date,
  format: string,
  proposer: { discordId: string; username: string },
  acceptor: { discordId: string; username: string },
): Promise<void> {
  const token = getToken();
  if (!token) return;

  const ts = Math.floor(proposedAt.getTime() / 1000);

  const buildDm = (forPlayer: typeof proposer, opponent: typeof proposer) => ({
    content: `⏰ Your **${format}** match with <@${opponent.discordId}> starts <t:${ts}:R> (<t:${ts}:t>)! Let your opponent know you'll be there:`,
    components: [
      actionRow([
        button("✅ I'm Ready", `sc_ready:${matchupId}:${forPlayer.discordId}`, BTN_SUCCESS),
      ]),
    ],
  });

  const [ch1, ch2] = await Promise.all([
    openDmChannel(proposer.discordId),
    openDmChannel(acceptor.discordId),
  ]);

  await Promise.allSettled([
    ch1 ? discordRequest('POST', `/channels/${ch1}/messages`, buildDm(proposer, acceptor)) : Promise.resolve(),
    ch2 ? discordRequest('POST', `/channels/${ch2}/messages`, buildDm(acceptor, proposer)) : Promise.resolve(),
  ]);
}

export async function notifyChallengeMatchFound(
  matchId: string,
  format: string,
  proposer: { discordId: string; username: string },
  acceptor: { discordId: string; username: string },
  mapName: string | null,
): Promise<void> {
  const token = getToken();
  if (!token) return;

  const matchUrl = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/matches/${matchId}`;
  const mapLine = mapName ? ` · Map: **${mapName}**` : '';

  await Promise.allSettled([
    sendDm(
      proposer.discordId,
      `⚔️ Your **${format}** challenge was accepted by <@${acceptor.discordId}>${mapLine} → ${matchUrl}`,
    ),
    sendDm(
      acceptor.discordId,
      `⚔️ You accepted <@${proposer.discordId}>'s **${format}** challenge${mapLine} → ${matchUrl}`,
    ),
  ]);
}

/**
 * DM a queued player to check whether they're still looking for a game.
 * Sent ~5 minutes before the queue slot expires.
 */
export async function notifyReQueuePrompt(discordId: string): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    await sendDmWithComponents(
      discordId,
      "⏱️ You've been in the Open Play queue for 30 minutes — still looking for a game?",
      [actionRow([button('Stay in Queue', `op_queue:${discordId}`, BTN_SUCCESS)])],
    );
  } catch {
    // non-fatal — user may have DMs disabled
  }
}

/**
 * DM moderators about an Open Play dispute (no tournament host to notify).
 */
export async function notifyOpenPlayDispute(matchId: string, reporterDiscordId: string): Promise<void> {
  const token = getToken();
  if (!token) return;

  try {
    const moderators = await prisma.user.findMany({
      where: { role: 'MODERATOR', deleted_at: null },
      select: { discord_id: true },
    });
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', deleted_at: null },
      select: { discord_id: true },
    });

    const matchUrl = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/matches/${matchId}`;
    const message =
      `**[RizzOtto's Arena] ⚠️ Open Play Dispute**\n\n` +
      `Match ID: \`${matchId}\`\nReported by: <@${reporterDiscordId}>\n\n` +
      `Please review at <${matchUrl}>`;

    const recipients = [...new Set([...moderators, ...admins].map((u) => u.discord_id))];
    await Promise.allSettled(recipients.map((id) => sendDm(id, message)));
  } catch (err) {
    console.warn('[discord-notify] notifyOpenPlayDispute error (non-fatal):', err);
  }
}

async function sendEmbed(channelId: string, embed: object): Promise<void> {
  // parse: [] keeps any <@id> mentions in the embed clickable but silent — no
  // notification spam when a pairing list names the whole field.
  await discordRequest('POST', `/channels/${channelId}/messages`, {
    embeds: [embed],
    allowed_mentions: { parse: [] },
  });
}

async function getAdminConfig(): Promise<Record<string, string>> {
  try {
    const rows = await prisma.adminConfig.findMany({
      where: { key: { in: ['discord_announce_channel_id', 'discord_ping_role_id'] } },
    });
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value as string;
    }
    return result;
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Public notification functions
// ---------------------------------------------------------------------------

/**
 * Announce a new/published tournament to the configured Discord channel.
 * Optionally pings a role if `discord_ping_role_id` is configured in AdminConfig.
 */
export async function notifyTournamentAnnounce(tournament: TournamentForNotify): Promise<void> {
  const token = getToken();
  if (!token) {
    console.warn('[discord-notify] DISCORD_BOT_TOKEN not set — skipping tournament announce');
    return;
  }

  try {
    const config = await getAdminConfig();
    const channelId = config['discord_announce_channel_id'];
    if (!channelId) {
      console.warn('[discord-notify] discord_announce_channel_id not configured in AdminConfig');
      return;
    }

    const pingRole = config['discord_ping_role_id'];
    const content = pingRole ? `<@&${pingRole}>` : undefined;

    const embed = {
      title: `⚔️ Tournament Announced: ${tournament.name}`,
      description: `A new tournament has been published on RizzOtto's Arena!\n\n**Start:** <t:${Math.floor(tournament.start_date.getTime() / 1000)}:F>`,
      url: `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${tournament.slug}`,
      color: 0xc8a96e, // Iron/Gold token
      timestamp: new Date().toISOString(),
      footer: { text: "RizzOtto's Arena — Where Lists Are Forged" },
    };

    const body: Record<string, unknown> = { embeds: [embed] };
    if (content) body.content = content;

    const resp = await discordRequest('POST', `/channels/${channelId}/messages`, body);
    if (!resp.ok) {
      const err = await resp.text();
      console.warn(`[discord-notify] Tournament announce failed: ${err}`);
    }
  } catch (err) {
    console.warn('[discord-notify] Tournament announce error (non-fatal):', err);
  }
}

/**
 * DM all REGISTERED participants of a tournament reminding them to check in.
 */
export async function notifyCheckInReminder(tournament: TournamentForNotify): Promise<void> {
  const token = getToken();
  if (!token) {
    console.warn('[discord-notify] DISCORD_BOT_TOKEN not set — skipping check-in reminder');
    return;
  }

  try {
    const participants = await prisma.tournamentParticipant.findMany({
      where: {
        tournament_id: tournament.id,
        status: 'REGISTERED',
        deleted_at: null,
      },
      select: { user: { select: { discord_id: true, username: true } } },
    });

    if (participants.length === 0) return;

    const startTs = Math.floor(tournament.start_date.getTime() / 1000);
    const message =
      `**[RizzOtto's Arena] Check-in Reminder: ${tournament.name}**\n\n` +
      `The tournament starts <t:${startTs}:R>. ` +
      `Please check in at ${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${tournament.slug} before the start time!`;

    // Fire-and-forget DMs — don't fail the cron job if one DM fails
    const dmPromises = participants.map(({ user }) => sendDm(user.discord_id, message));
    await Promise.allSettled(dmPromises);
  } catch (err) {
    console.warn('[discord-notify] Check-in reminder error (non-fatal):', err);
  }
}

/** Per-player pairing DM text — playoff rounds get a special, celebratory line. */
function pairingDmText(name: string, label: string, opponentDiscordId: string, map: string | null | undefined, url: string): string {
  const vs = `<@${opponentDiscordId}>` + (map ? ` on *${map}*` : '');
  if (label === 'Final') {
    return `**[RizzOtto's Arena] The Grand Final — ${name}** 🏆\n` +
      `This is it — the last match of the tournament. You face ${vs}. Leave nothing on the field; the title is decided here. GG in advance, and may the best general win. <${url}>`;
  }
  if (label === 'Third-Place Match') {
    return `**[RizzOtto's Arena] The Third-Place Match — ${name}** 🥉\n` +
      `One last battle to close out the tournament — you face ${vs} for the bronze. Finish strong. GG! <${url}>`;
  }
  if (label === 'Semi-Finals' || label === 'Quarter-Finals' || label === 'Playoffs') {
    return `**[RizzOtto's Arena] ${label} — ${name}** 🏆\n` +
      `Congratulations on reaching the ${label}! You face ${vs}. This is where legends are forged — good luck, and may your dice run hot. <${url}>`;
  }
  return `**[RizzOtto's Arena] ${label} Pairing — ${name}**\nYou are playing against ${vs}.\nOpen your match: <${url}>`;
}

/**
 * Notify round pairings to the tournament channel + DM each player.
 */
export async function notifyRoundPairings(
  tournament: TournamentForNotify,
  round: number,
  pairings: PairingForNotify[],
  roundLabel?: string,
): Promise<void> {
  const token = getToken();
  if (!token) {
    console.warn('[discord-notify] DISCORD_BOT_TOKEN not set — skipping round pairings');
    return;
  }

  try {
    const config = await getAdminConfig();
    const channelId = config['discord_announce_channel_id'];
    const label = roundLabel ?? `Round ${round}`;

    const pairingLines = pairings
      .map(
        (p) =>
          `• <@${p.player1.discord_id}> vs <@${p.player2.discord_id}>` +
          (p.map ? ` on *${p.map}*` : ''),
      )
      .join('\n');

    if (channelId) {
      const embed = {
        title: `⚔️ ${label} Pairings — ${tournament.name}`,
        description: pairingLines,
        color: 0xc8a96e,
        timestamp: new Date().toISOString(),
      };
      await sendEmbed(channelId, embed).catch((e) =>
        console.warn('[discord-notify] Round pairing embed error:', e),
      );
    }

    const url = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${tournament.slug}`;
    // DM each player their specific opponent — playoff rounds get a special text.
    const dmPromises = pairings.flatMap((p) => [
      sendDm(p.player1.discord_id, pairingDmText(tournament.name, label, p.player2.discord_id, p.map, url)),
      sendDm(p.player2.discord_id, pairingDmText(tournament.name, label, p.player1.discord_id, p.map, url)),
    ]);

    await Promise.allSettled(dmPromises);
  } catch (err) {
    console.warn('[discord-notify] Round pairings error (non-fatal):', err);
  }
}

/** Map the round's match phases to a human label; null for Swiss/group (caller uses "Round N"). */
function playoffRoundLabel(phases: (string | null)[]): string | null {
  if (phases.includes('PLAYOFF_FINAL')) return 'Final';
  if (phases.includes('PLAYOFF_SF')) return 'Semi-Finals';
  if (phases.includes('PLAYOFF_QF')) return 'Quarter-Finals';
  if (phases.length > 0 && phases.every((p) => p === 'PLAYOFF_THIRD_PLACE')) return 'Third-Place Match';
  if (phases.some((p) => typeof p === 'string' && p.startsWith('PLAYOFF'))) return 'Playoffs';
  return null;
}

/**
 * High-level helper: given freshly created matches (with player ids), looks up the
 * tournament + players and notifies pairings. Skips matches without both players
 * (BYE / not-yet-filled playoff slots). Fully fire-and-forget safe (never throws).
 * Used for round 1, every Swiss round, and all playoff match creations.
 */
export async function notifyMatchesCreated(
  tournamentId: string,
  round: number,
  matches: { id: string; player1_id: string | null; player2_id: string | null }[],
): Promise<void> {
  if (!getToken()) return;
  try {
    const tournament = await prisma.tournament.findFirst({
      where: { id: tournamentId },
      select: { id: true, name: true, slug: true, start_date: true },
    });
    if (!tournament) return;

    const playable = matches.filter((m) => m.player1_id && m.player2_id);
    const byeMatches = matches.filter((m) => m.player1_id && !m.player2_id);
    if (playable.length === 0 && byeMatches.length === 0) return;

    const userIds = [...new Set([
      ...playable.flatMap((m) => [m.player1_id as string, m.player2_id as string]),
      ...byeMatches.map((m) => m.player1_id as string),
    ])];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, discord_id: true, username: true },
    });
    const byId = new Map(users.map((u) => [u.id, u]));

    const pairings: PairingForNotify[] = [];
    for (const m of playable) {
      const p1 = byId.get(m.player1_id as string);
      const p2 = byId.get(m.player2_id as string);
      if (!p1 || !p2) continue;
      pairings.push({
        matchId: m.id,
        player1: { discord_id: p1.discord_id, username: p1.username },
        player2: { discord_id: p2.discord_id, username: p2.username },
        round,
        map: null,
      });
    }

    const phaseRows = await prisma.match.findMany({
      where: { id: { in: matches.map((m) => m.id) } },
      select: { phase: true },
    });
    const roundLabel = playoffRoundLabel(phaseRows.map((r) => r.phase));

    if (pairings.length > 0) {
      await notifyRoundPairings(tournament, round, pairings, roundLabel ?? undefined);
    }

    // Bye players advance automatically — encouraging DM. Elimination on the final
    // Swiss round is handled in auto-swiss-service (it has the standings), so here
    // (round 1 / playoff byes) it's always "you advance".
    for (const m of byeMatches) {
      const p = byId.get(m.player1_id as string);
      if (p?.discord_id) {
        await notifyBye(
          { name: tournament.name, slug: tournament.slug },
          round,
          { discord_id: p.discord_id, username: p.username },
          { eliminated: false, roundLabel: roundLabel ?? undefined },
        );
      }
    }
  } catch (err) {
    console.warn('[discord-notify] notifyMatchesCreated error (non-fatal):', err);
  }
}

/**
 * DM the player who drew a bye this round. Encouraging by default; if it's the final
 * Swiss round and they can no longer reach the playoffs, gently tell them their run is
 * over and point them at the ongoing tournament (to catch a stream of the rest).
 */
export async function notifyBye(
  tournament: { name: string; slug: string; stream_url?: string | null },
  round: number,
  byePlayer: { discord_id: string; username: string },
  opts: { eliminated: boolean; roundLabel?: string },
): Promise<void> {
  const token = getToken();
  if (!token) return;
  const url = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${tournament.slug}`;
  const label = opts.roundLabel ?? `Round ${round}`;
  const streamUrl =
    tournament.stream_url ??
    (await prisma.tournament.findFirst({ where: { slug: tournament.slug }, select: { stream_url: true } }))?.stream_url ??
    null;
  const msg = (opts.eliminated
    ? `**[RizzOtto's Arena] Bye — ${tournament.name}**\n` +
      `You drew a bye in ${label}, and that's a wrap on your run this time — a playoff spot is just out of reach now. ` +
      `No shame in it at all: the pairings roll the dice, and someone always draws the short straw. 🎲 Thanks for battling — GG!\n` +
      `The tournament rolls on without you in the fight — see if the remaining matches are being streamed and enjoy the show: <${url}>`
    : `**[RizzOtto's Arena] Bye — ${tournament.name}**\n` +
      `You drew a bye in ${label} — a free win, and honestly a well-earned breather. ☕ ` +
      `You advance automatically, so rest up and sharpen your blades — you're back in the fray next round. Standings: <${url}>`)
    + streamLine(streamUrl);
  try {
    await sendDm(byePlayer.discord_id, msg);
  } catch (err) {
    console.warn('[discord-notify] notifyBye error (non-fatal):', err);
  }
}

/**
 * P1/P2 (#23): at playoff start, congratulate the qualifiers and give everyone else
 * a warm "your run ends here". Fire-and-forget safe.
 */
export async function notifyPlayoffResults(
  tournamentId: string,
  qualifierIds: string[],
  eliminatedIds: string[],
): Promise<void> {
  if (!getToken()) return;
  try {
    const tournament = await prisma.tournament.findFirst({
      where: { id: tournamentId },
      select: { name: true, slug: true, stream_url: true },
    });
    if (!tournament) return;
    const url = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${tournament.slug}`;
    const users = await prisma.user.findMany({
      where: { id: { in: [...qualifierIds, ...eliminatedIds] } },
      select: { id: true, discord_id: true },
    });
    const disc = new Map(users.map((u) => [u.id, u.discord_id]));
    const p1 = `**[RizzOtto's Arena] You're in the Playoffs — ${tournament.name}** 🏆\n` +
      `The Swiss rounds are done, and you've fought your way through — congratulations, you've qualified for the playoffs! Sharpen your blades; the real battle begins now. Your bracket + next match: <${url}>`;
    const p2 = `**[RizzOtto's Arena] Your run ends here — ${tournament.name}**\n` +
      `The final Swiss round is in the books, and a playoff spot slipped just out of reach this time. You fought well — GG! The tournament rolls on; if the remaining matches are streamed, grab a drink and enjoy the show: <${url}>` +
      streamLine(tournament.stream_url);
    const dms = [
      ...qualifierIds.map((id) => disc.get(id)).filter((d): d is string => !!d).map((d) => sendDm(d, p1)),
      ...eliminatedIds.map((id) => disc.get(id)).filter((d): d is string => !!d).map((d) => sendDm(d, p2)),
    ];
    await Promise.allSettled(dms);
  } catch (err) {
    console.warn('[discord-notify] notifyPlayoffResults error (non-fatal):', err);
  }
}

/**
 * P5 (#23): a tournament with no playoffs just finished its last round — thank the
 * players and point them at the final standings.
 */
export async function notifyNoPlayoffComplete(tournamentId: string, playerIds: string[]): Promise<void> {
  if (!getToken() || playerIds.length === 0) return;
  try {
    const tournament = await prisma.tournament.findFirst({
      where: { id: tournamentId },
      select: { name: true, slug: true, stream_url: true },
    });
    if (!tournament) return;
    const url = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${tournament.slug}`;
    const users = await prisma.user.findMany({
      where: { id: { in: playerIds } },
      select: { discord_id: true },
    });
    const msg = `**[RizzOtto's Arena] That's a wrap — ${tournament.name}**\n` +
      `You've played your final round — thanks for battling through the whole event! Final standings are up: <${url}>. GG, and see you at the next muster. ⚔️` +
      streamLine(tournament.stream_url);
    await Promise.allSettled(users.map((u) => sendDm(u.discord_id, msg)));
  } catch (err) {
    console.warn('[discord-notify] notifyNoPlayoffComplete error (non-fatal):', err);
  }
}

/**
 * P6 (#40): the auto-sizing changed the round count / playoff size during the round
 * that just finished — tell the active players once, at round-end.
 */
export async function notifyAutoSizeChanged(
  tournamentId: string,
  activeCount: number,
  rounds: number,
  playoffFormat: string,
): Promise<void> {
  if (!getToken()) return;
  try {
    const tournament = await prisma.tournament.findFirst({
      where: { id: tournamentId },
      select: { name: true, slug: true },
    });
    if (!tournament) return;
    const url = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${tournament.slug}`;
    const players = await prisma.tournamentParticipant.findMany({
      where: { tournament_id: tournamentId, deleted_at: null, status: { in: ['REGISTERED', 'CHECKED_IN'] } },
      select: { user: { select: { discord_id: true } } },
    });
    const playoffText = playoffFormat === 'NONE' ? ' · no playoffs' : ` · **${playoffFormat}** playoffs`;
    const msg = `**[RizzOtto's Arena] Bracket updated — ${tournament.name}**\n` +
      `The field is now at ${activeCount} players, so the tournament has been re-sized: **${rounds} rounds**${playoffText}. Next-round pairings are up: <${url}>`;
    await Promise.allSettled(players.map((p) => sendDm(p.user.discord_id, msg)));
  } catch (err) {
    console.warn('[discord-notify] notifyAutoSizeChanged error (non-fatal):', err);
  }
}

/**
 * B20: DM the tournament host + co-hosts when a player drops/withdraws — so drops
 * don't go unnoticed in large fields. Fire-and-forget safe (never throws).
 */
export async function notifyHostsOfWithdrawal(
  tournamentId: string,
  userId: string,
  excludeUserId?: string,
): Promise<void> {
  if (!getToken()) return;
  try {
    const [tournament, user] = await Promise.all([
      prisma.tournament.findFirst({
        where: { id: tournamentId },
        select: { name: true, slug: true, host_id: true, co_hosts: { select: { user_id: true } } },
      }),
      prisma.user.findUnique({ where: { id: userId }, select: { username: true, discord_id: true } }),
    ]);
    if (!tournament || !user) return;

    const hostIds = [...new Set([tournament.host_id, ...tournament.co_hosts.map((h) => h.user_id)])]
      .filter((hid) => hid !== excludeUserId);
    if (hostIds.length === 0) return;
    const hosts = await prisma.user.findMany({
      where: { id: { in: hostIds } },
      select: { discord_id: true },
    });
    const msg =
      `**[RizzOtto's Arena] Player dropped — ${tournament.name}**\n` +
      `<@${user.discord_id}> is no longer in the tournament. ` +
      `Review the bracket at <${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${tournament.slug}>.`;
    await Promise.allSettled(hosts.map((h) => sendDm(h.discord_id, msg)));
  } catch (err) {
    console.warn('[discord-notify] notifyHostsOfWithdrawal error (non-fatal):', err);
  }
}

/**
 * DM the tournament host + co-hosts when a user requests to join a running
 * tournament (late-join). Points them to the in-app requests panel where they
 * approve/decline. Fire-and-forget safe (never throws).
 */
export async function notifyHostsLateJoinRequest(
  tournamentId: string,
  applicantUserId: string,
): Promise<void> {
  if (!getToken()) return;
  try {
    const [tournament, applicant] = await Promise.all([
      prisma.tournament.findFirst({
        where: { id: tournamentId },
        select: { name: true, slug: true, host_id: true, co_hosts: { select: { user_id: true } } },
      }),
      prisma.user.findUnique({ where: { id: applicantUserId }, select: { username: true } }),
    ]);
    if (!tournament || !applicant) return;

    const hostIds = [...new Set([tournament.host_id, ...tournament.co_hosts.map((h) => h.user_id)])];
    if (hostIds.length === 0) return;
    const hosts = await prisma.user.findMany({
      where: { id: { in: hostIds } },
      select: { discord_id: true },
    });
    const msg =
      `**[RizzOtto's Arena] Late-join request — ${tournament.name}**\n` +
      `**${applicant.username}** asked to join the running tournament. ` +
      `Approve or decline it on the tournament page: ` +
      `<${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${tournament.slug}>.`;
    await Promise.allSettled(hosts.map((h) => sendDm(h.discord_id, msg)));
  } catch (err) {
    console.warn('[discord-notify] notifyHostsLateJoinRequest error (non-fatal):', err);
  }
}

/**
 * DM a user the outcome of their late-join request (approved / declined).
 * Fire-and-forget safe (never throws).
 */
export async function notifyLateJoinDecision(
  tournamentId: string,
  applicantUserId: string,
  approved: boolean,
): Promise<void> {
  if (!getToken()) return;
  try {
    const [tournament, applicant] = await Promise.all([
      prisma.tournament.findFirst({ where: { id: tournamentId }, select: { name: true, slug: true } }),
      prisma.user.findUnique({ where: { id: applicantUserId }, select: { discord_id: true } }),
    ]);
    if (!tournament || !applicant) return;
    const url = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${tournament.slug}`;
    const msg = approved
      ? `**[RizzOtto's Arena] You're in — ${tournament.name}**\n` +
        `Your request to join was approved. Head to the tournament: <${url}>.`
      : `**[RizzOtto's Arena] Late-join declined — ${tournament.name}**\n` +
        `The host declined your request to join <${url}>.`;
    await sendDm(applicant.discord_id, msg);
  } catch (err) {
    console.warn('[discord-notify] notifyLateJoinDecision error (non-fatal):', err);
  }
}

/**
 * P9: DM the tournament host + co-hosts when a match participant reports an issue
 * with their match (e.g. wrong result, wrong factions). Fire-and-forget safe.
 */
export async function notifyHostsOfMatchReport(
  tournamentId: string,
  matchId: string,
  reporterId: string,
  comment: string,
): Promise<void> {
  if (!getToken()) return;
  try {
    const [tournament, reporter] = await Promise.all([
      prisma.tournament.findFirst({
        where: { id: tournamentId },
        select: { name: true, slug: true, host_id: true, co_hosts: { select: { user_id: true } } },
      }),
      prisma.user.findUnique({ where: { id: reporterId }, select: { username: true, discord_id: true } }),
    ]);
    if (!tournament || !reporter) return;

    const hostIds = [...new Set([tournament.host_id, ...tournament.co_hosts.map((h) => h.user_id)])];
    if (hostIds.length === 0) return;
    const hosts = await prisma.user.findMany({
      where: { id: { in: hostIds } },
      select: { discord_id: true },
    });
    const base = process.env.FRONTEND_URL ?? 'https://rizzotto.gg';
    const msg =
      `**[RizzOtto's Arena] Match issue reported — ${tournament.name}**\n` +
      `<@${reporter.discord_id}> reported an issue with their match:\n` +
      `> ${comment.replace(/\n/g, '\n> ')}\n` +
      `Review the match at <${base}/matches/${matchId}>.`;
    await Promise.allSettled(hosts.map((h) => sendDm(h.discord_id, msg)));
  } catch (err) {
    console.warn('[discord-notify] notifyHostsOfMatchReport error (non-fatal):', err);
  }
}

/**
 * Notify host + all moderators about a match dispute via DM.
 */
export async function notifyDispute(
  match: MatchForNotify,
  reporter: ReporterForNotify,
): Promise<void> {
  const token = getToken();
  if (!token) {
    console.warn('[discord-notify] DISCORD_BOT_TOKEN not set — skipping dispute notify');
    return;
  }

  try {
    // Fetch host + all moderators
    const [tournament, moderators] = await Promise.all([
      prisma.tournament.findUnique({
        where: { id: match.tournament.id },
        select: { host: { select: { discord_id: true, username: true } } },
      }),
      prisma.user.findMany({
        where: { role: 'MODERATOR', deleted_at: null },
        select: { discord_id: true },
      }),
    ]);

    const message =
      `**[RizzOtto's Arena] ⚠️ Match Dispute — ${match.tournament.name}**\n\n` +
      `Match ID: \`${match.id}\`\n` +
      `Reported by: <@${reporter.discord_id}>\n\n` +
      `Please review and resolve the dispute at <${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${match.tournament.slug}>`;

    const recipients: string[] = moderators.map((m) => m.discord_id);
    if (tournament?.host.discord_id) {
      recipients.push(tournament.host.discord_id);
    }
    // Deduplicate
    const unique = [...new Set(recipients)];

    await Promise.allSettled(unique.map((discordId) => sendDm(discordId, message)));
  } catch (err) {
    console.warn('[discord-notify] Dispute notify error (non-fatal):', err);
  }
}

/**
 * DM the surviving player of a group match when their opponent has withdrawn.
 * Instructs them to either report the result (if the match was played) or void it
 * via the match page. Fire-and-forget safe (never throws).
 */
export async function notifyOpponentOfWithdrawal(matchId: string, survivorUserId: string): Promise<void> {
  if (!getToken()) return;
  try {
    const [match, survivor] = await Promise.all([
      prisma.match.findFirst({
        where: { id: matchId },
        select: {
          id: true,
          tournament: { select: { name: true, slug: true } },
        },
      }),
      prisma.user.findUnique({
        where: { id: survivorUserId },
        select: { discord_id: true },
      }),
    ]);
    if (!match || !survivor?.discord_id) return;

    const base = process.env.FRONTEND_URL ?? 'https://rizzotto.gg';
    // Link to the tournament page (My Match → GameTile), NOT /matches/:id — the /matches page
    // renders the replay-less dual-submit for tournament matches, which bypasses both the replay
    // requirement and the played/void decision. The tournament GameTile has both.
    const slug = match.tournament?.slug;
    const url = slug ? `${base}/tournaments/${slug}` : `${base}/matches/${matchId}`;
    const tournamentName = match.tournament?.name ?? 'your tournament';

    const msg =
      `**[RizzOtto's Arena] Opponent withdrew — ${tournamentName}**\n\n` +
      `Your opponent has withdrawn from the tournament. Open your match on the tournament page to decide:\n` +
      `• **Match was played** — report the result and upload your replay as normal.\n` +
      `• **Match was not played** — void it so you can be re-paired for this round.\n\n` +
      `Your match: <${url}>`;

    await sendDm(survivor.discord_id, msg);
  } catch (err) {
    console.warn('[discord-notify] notifyOpponentOfWithdrawal error (non-fatal):', err);
  }
}

/**
 * DM a user while players are waiting in the Open Play queue during their
 * availability window. [Match Now] pairs the clicker with the oldest player in
 * the queue (resolved when clicked, so the link stays valid indefinitely).
 * Includes snooze buttons (1h / 4h / today). No player name is shared.
 */
export async function notifyAvailabilityPing(
  discordUserId: string,
  queueSize: number,
): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    const ch = await openDmChannel(discordUserId);
    if (!ch) return;
    const playerWord = queueSize === 1 ? 'player is' : 'players are';
    await discordRequest('POST', `/channels/${ch}/messages`, {
      content: `**${queueSize}** ${playerWord} in the Open Play queue right now — it's a great time to play! 🎮`,
      components: [
        actionRow([
          button('Match Now',    `av_join:${discordUserId}`,         BTN_SUCCESS),
          button('Snooze 1h',    `av_snooze:1h:${discordUserId}`,    BTN_SECONDARY),
          button('Snooze 4h',    `av_snooze:4h:${discordUserId}`,    BTN_SECONDARY),
          button('Snooze Today', `av_snooze:today:${discordUserId}`, BTN_SECONDARY),
        ]),
      ],
    });
  } catch (err) {
    console.warn('[discord-notify] Availability ping error (non-fatal):', err);
  }
}

function formatDuration(seconds: number): string {
  if (seconds >= 86400) {
    const d = Math.round(seconds / 86400);
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  if (seconds >= 3600) {
    const h = Math.round(seconds / 3600);
    return `${h} hour${h === 1 ? '' : 's'}`;
  }
  const m = Math.max(1, Math.round(seconds / 60));
  return `${m} minute${m === 1 ? '' : 's'}`;
}

/**
 * #14 — first offense: a friendly heads-up only, NO sanction. Education-first.
 */
export async function notifyQueueWarning(discordUserId: string): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    await sendDm(
      discordUserId,
      `**[RizzOtto's Arena] 👋 Quick heads-up**\n\n` +
        `We noticed you've joined and left the Open Play queue a few times right after queueing. ` +
        `We understand that real life happens, and it's certainly better to leave than to go AFK ` +
        `while queued. Nothing happens this time — just please try to avoid it when you can, since ` +
        `leaving right after queueing can leave other players hanging. Thanks for keeping matchmaking smooth! ⚔️`,
    );
  } catch {
    // non-fatal — user may have DMs disabled
  }
}

/**
 * #14 — repeat offense: DM the player about the cooldown that's now in effect.
 */
export async function notifyQueueTimeout(discordUserId: string, timeoutSeconds: number): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    await sendDm(
      discordUserId,
      `**[RizzOtto's Arena] ⏳ Queue cooldown**\n\n` +
        `You've kept joining and leaving the Open Play queue in quick succession, so you're on a ` +
        `**${formatDuration(timeoutSeconds)}** cooldown. It keeps matchmaking fair for everyone waiting — ` +
        `hop back in once it's up. See you on the field! ⚔️`,
    );
  } catch {
    // non-fatal — user may have DMs disabled
  }
}

/**
 * #14 — from the second offense (first actual sanction) onward, notify staff.
 */
export async function notifyQueueAbuseToStaff(
  username: string,
  level: number,
  timeoutSeconds: number,
): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    const staff = await prisma.user.findMany({
      where: { role: { in: ['ADMIN', 'MODERATOR'] }, deleted_at: null },
      select: { discord_id: true },
    });
    const consequence = timeoutSeconds > 0 ? `a ${formatDuration(timeoutSeconds)} cooldown` : 'a warning only';
    const message =
      `**[RizzOtto's Arena] ⚠️ Queue abuse**\n\n` +
      `**${username}** hit queue-abuse level **${level}** (repeatedly joining and leaving the Open Play ` +
      `queue). Applied: ${consequence}.`;
    const recipients = [...new Set(staff.map((u) => u.discord_id))];
    await Promise.allSettled(recipients.map((id) => sendDm(id, message)));
  } catch {
    // non-fatal
  }
}
