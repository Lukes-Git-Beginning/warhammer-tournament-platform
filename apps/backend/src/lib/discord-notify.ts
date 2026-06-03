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

async function sendDm(discordUserId: string, content: string): Promise<void> {
  const channelId = await openDmChannel(discordUserId);
  if (!channelId) return;

  await discordRequest('POST', `/channels/${channelId}/messages`, { content });
}

async function sendEmbed(channelId: string, embed: object): Promise<void> {
  await discordRequest('POST', `/channels/${channelId}/messages`, { embeds: [embed] });
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

/**
 * Notify round pairings to the tournament channel + DM each player.
 */
export async function notifyRoundPairings(
  tournament: TournamentForNotify,
  round: number,
  pairings: PairingForNotify[],
): Promise<void> {
  const token = getToken();
  if (!token) {
    console.warn('[discord-notify] DISCORD_BOT_TOKEN not set — skipping round pairings');
    return;
  }

  try {
    const config = await getAdminConfig();
    const channelId = config['discord_announce_channel_id'];

    const pairingLines = pairings
      .map(
        (p) =>
          `• **${p.player1.username}** vs **${p.player2.username}**` +
          (p.map ? ` on *${p.map}*` : ''),
      )
      .join('\n');

    if (channelId) {
      const embed = {
        title: `⚔️ Round ${round} Pairings — ${tournament.name}`,
        description: pairingLines,
        color: 0xc8a96e,
        timestamp: new Date().toISOString(),
      };
      await sendEmbed(channelId, embed).catch((e) =>
        console.warn('[discord-notify] Round pairing embed error:', e),
      );
    }

    // DM each player with their specific opponent
    const dmPromises = pairings.flatMap((p) => {
      const p1Msg =
        `**[RizzOtto's Arena] Round ${round} Pairing — ${tournament.name}**\n` +
        `You are playing against **${p.player2.username}**` +
        (p.map ? ` on *${p.map}*` : '') +
        `.`;
      const p2Msg =
        `**[RizzOtto's Arena] Round ${round} Pairing — ${tournament.name}**\n` +
        `You are playing against **${p.player1.username}**` +
        (p.map ? ` on *${p.map}*` : '') +
        `.`;

      return [
        sendDm(p.player1.discord_id, p1Msg),
        sendDm(p.player2.discord_id, p2Msg),
      ];
    });

    await Promise.allSettled(dmPromises);
  } catch (err) {
    console.warn('[discord-notify] Round pairings error (non-fatal):', err);
  }
}

/**
 * Notify organizer + all moderators about a match dispute via DM.
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
    // Fetch organizer + all moderators
    const [organizer, moderators] = await Promise.all([
      prisma.tournament.findUnique({
        where: { id: match.tournament.id },
        select: { organizer: { select: { discord_id: true, username: true } } },
      }),
      prisma.user.findMany({
        where: { role: 'MODERATOR', deleted_at: null },
        select: { discord_id: true },
      }),
    ]);

    const message =
      `**[RizzOtto's Arena] ⚠️ Match Dispute — ${match.tournament.name}**\n\n` +
      `Match ID: \`${match.id}\`\n` +
      `Reported by: **${reporter.username}**\n\n` +
      `Please review and resolve the dispute at ${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/tournaments/${match.tournament.slug}`;

    const recipients: string[] = moderators.map((m) => m.discord_id);
    if (organizer?.organizer.discord_id) {
      recipients.push(organizer.organizer.discord_id);
    }
    // Deduplicate
    const unique = [...new Set(recipients)];

    await Promise.allSettled(unique.map((discordId) => sendDm(discordId, message)));
  } catch (err) {
    console.warn('[discord-notify] Dispute notify error (non-fatal):', err);
  }
}
