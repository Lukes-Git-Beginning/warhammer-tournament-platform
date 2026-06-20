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
const BTN_DANGER = 4;  // red
const BTN_SECONDARY = 2; // grey

function actionRow(buttons: object[]) {
  return { type: 1, components: buttons };
}

function button(label: string, customId: string, style: number) {
  return { type: 2, style, label, custom_id: customId };
}

/**
 * DM both players when an Open Play match is created, with result buttons.
 * custom_id format: op_declare:<win|loss|cancel>:<matchId>:<playerId>
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

  const buildDm = (forPlayer: typeof p1, opponent: typeof p1) => ({
    content: `Match found! Open Play vs <@${opponent.discordId}>${mapLine}\nPick your faction → ${matchUrl}`,
    components: [
      actionRow([
        button('Declare Win', `op_declare:win:${matchId}:${forPlayer.discordId}`, BTN_SUCCESS),
        button('Cancel Match', `op_declare:cancel:${matchId}:${forPlayer.discordId}`, BTN_SECONDARY),
        button('Declare Loss', `op_declare:loss:${matchId}:${forPlayer.discordId}`, BTN_DANGER),
      ]),
    ],
  });

  const [ch1, ch2] = await Promise.all([openDmChannel(p1.discordId), openDmChannel(p2.discordId)]);

  await Promise.allSettled([
    ch1 ? discordRequest('POST', `/channels/${ch1}/messages`, buildDm(p1, p2)) : Promise.resolve(),
    ch2 ? discordRequest('POST', `/channels/${ch2}/messages`, buildDm(p2, p1)) : Promise.resolve(),
  ]);
}

/**
 * DM the opponent when a player declares a win, asking them to confirm or dispute.
 * custom_id format: op_confirm:<matchId>:<winnerId> / op_dispute:<matchId>:<winnerId>
 */
export async function notifyResultPending(
  opponentDiscordId: string,
  declarerUsername: string,
  matchId: string,
  winnerId: string,
): Promise<void> {
  const token = getToken();
  if (!token) return;

  await sendDmWithComponents(
    opponentDiscordId,
    `**${declarerUsername}** has reported a win for this match. Confirm or dispute?`,
    [
      actionRow([
        button('Confirm', `op_confirm:${matchId}:${winnerId}`, BTN_SUCCESS),
        button('Dispute', `op_dispute:${matchId}:${winnerId}`, BTN_DANGER),
      ]),
    ],
  ).catch((e) => console.warn('[discord-notify] notifyResultPending error:', e));
}

/**
 * DM the opponent when a player requests to cancel the match without a result.
 * custom_id format: op_cancel_accept:<matchId> / op_cancel_dispute:<matchId>:<opponentDiscordId>
 */
export async function notifyCancelPending(
  opponentDiscordId: string,
  declarerUsername: string,
  matchId: string,
): Promise<void> {
  const token = getToken();
  if (!token) return;

  await sendDmWithComponents(
    opponentDiscordId,
    `**${declarerUsername}** wants to cancel this match without recording a result. Accept or dispute?`,
    [
      actionRow([
        button('Accept', `op_cancel_accept:${matchId}`, BTN_SUCCESS),
        button('Dispute', `op_cancel_dispute:${matchId}:${opponentDiscordId}`, BTN_DANGER),
      ]),
    ],
  ).catch((e) => console.warn('[discord-notify] notifyCancelPending error:', e));
}

/**
 * DM the winner after match confirmation, reminding them to upload a replay for leaderboard credit.
 */
export async function notifyReplayReminder(winnerDiscordId: string, matchId: string): Promise<void> {
  const token = getToken();
  if (!token) return;

  const matchUrl = `${process.env.FRONTEND_URL ?? 'https://rizzotto.gg'}/matches/${matchId}`;
  await sendDmWithComponents(
    winnerDiscordId,
    `✅ Result recorded! Upload your replay at ${matchUrl} to have this win count for the leaderboard.`,
    [actionRow([button('Queue Again', `op_queue:${winnerDiscordId}`, BTN_SUCCESS)])],
  ).catch((e) => console.warn('[discord-notify] notifyReplayReminder error:', e));
}

/**
 * DM both players when a scheduled challenge match starts — no result buttons
 * since BO3/BO5 matches are played out on the website.
 */
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
    content: `⏰ Your **${format}** match with **${opponent.username}** starts <t:${ts}:R> (<t:${ts}:t>)! Let your opponent know you'll be there:`,
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
      `⚔️ Your **${format}** challenge was accepted by **${acceptor.username}**${mapLine} → ${matchUrl}`,
    ),
    sendDm(
      acceptor.discordId,
      `⚔️ You accepted **${proposer.username}**'s **${format}** challenge${mapLine} → ${matchUrl}`,
    ),
  ]);
}

export async function notifyMatchCancelledBothPlayers(
  p1DiscordId: string,
  p2DiscordId: string,
): Promise<void> {
  const token = getToken();
  if (!token) return;

  const msg = 'Match cancelled. No result recorded.';
  const components = [actionRow([button('Queue Again', `op_queue:PLACEHOLDER`, BTN_SUCCESS)])];

  await Promise.allSettled([
    sendDmWithComponents(p1DiscordId, msg, [
      actionRow([button('Queue Again', `op_queue:${p1DiscordId}`, BTN_SUCCESS)]),
    ]),
    sendDmWithComponents(p2DiscordId, msg, [
      actionRow([button('Queue Again', `op_queue:${p2DiscordId}`, BTN_SUCCESS)]),
    ]),
  ]);
  void components; // suppress unused warning
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
 * DM moderators about an Open Play dispute (no tournament organizer to notify).
 */
export async function notifyOpenPlayDispute(matchId: string, reporterUsername: string): Promise<void> {
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
      `Match ID: \`${matchId}\`\nReported by: **${reporterUsername}**\n\n` +
      `Please review at ${matchUrl}`;

    const recipients = [...new Set([...moderators, ...admins].map((u) => u.discord_id))];
    await Promise.allSettled(recipients.map((id) => sendDm(id, message)));
  } catch (err) {
    console.warn('[discord-notify] notifyOpenPlayDispute error (non-fatal):', err);
  }
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

/**
 * DM a user when someone joins the Open Play queue during their availability window.
 * Includes snooze buttons (1h / 4h / today) and a direct Join Queue button.
 */
export async function notifyAvailabilityPing(discordUserId: string, queueSize: number): Promise<void> {
  const token = getToken();
  if (!token) return;
  try {
    const baseUrl = process.env.FRONTEND_URL ?? 'https://rizzotto.gg';
    const ch = await openDmChannel(discordUserId);
    if (!ch) return;
    const playerWord = queueSize === 1 ? 'player is' : 'players are';
    await discordRequest('POST', `/channels/${ch}/messages`, {
      content: `**${queueSize}** ${playerWord} in the Open Play queue right now — it's a great time to play! 🎮\n${baseUrl}/open-play`,
      components: [
        actionRow([
          button('Join Queue',   `av_join:${discordUserId}`,         BTN_SUCCESS),
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
