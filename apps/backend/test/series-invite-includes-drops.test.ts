/**
 * Regression: the new-qualifier invite must reach EVERYONE who ever registered for a prior
 * qualifier — checked-in, late-joined, dropped or removed alike. Before the fix the recipient
 * query filtered `deleted_at: null`, so a player who registered and later dropped (even though
 * they played games) was silently excluded. This reproduces the wednesday-wars-by-rtk-2
 * incident and asserts the dropped player is now invited. sendDm/isBotConfigured are mocked.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const { sentDms, sendDmMock } = vi.hoisted(() => {
  const sentDms: { discordId: string; msg: string }[] = [];
  return {
    sentDms,
    sendDmMock: (discordId: string, msg: string) => {
      sentDms.push({ discordId, msg });
      return Promise.resolve();
    },
  };
});

vi.mock('../src/lib/discord-notify.js', () => ({
  isBotConfigured: () => true,
  sendDm: sendDmMock,
}));

import { prisma } from '@rizzotto/db';
import { maybeSendSeriesInvite } from '../src/lib/series-notify.js';

interface U {
  id: string;
  discord_id: string;
  username: string;
}

async function mkUser(username: string): Promise<U> {
  const id = randomUUID();
  const discord_id = `disc-${username}-${id.slice(0, 6)}`;
  await prisma.user.create({ data: { id, discord_id, username, email: null, bot_message_policy: 'NORMAL' } });
  return { id, discord_id, username };
}

async function mkQualifier(seriesId: string, hostId: string, status: 'OPEN_REGISTRATION' | 'COMPLETED', position: number): Promise<string> {
  const id = randomUUID();
  await prisma.tournament.create({
    data: {
      id,
      slug: `q-${id.slice(0, 8)}`,
      name: `Qualifier ${position}`,
      host_id: hostId,
      format: 'SWISS',
      mode: 'BPT',
      status,
      start_date: new Date('2026-09-16T18:30:00Z'),
      timezone: 'Europe/Istanbul',
      series_id: seriesId,
      series_position: position,
      is_series_final: false,
      series_invite_sent: status === 'COMPLETED',
    },
  });
  return id;
}

const created: { users: string[]; tournaments: string[]; series: string[] } = { users: [], tournaments: [], series: [] };

let dropped: U; // registered a prior qualifier, then dropped (soft-deleted participant)
let checkedIn: U; // active participant of a prior qualifier
let lateJoin: U; // late-joined participant of a prior qualifier
let newQualifierId: string;

beforeAll(async () => {
  dropped = await mkUser('Dropped');
  checkedIn = await mkUser('CheckedIn');
  lateJoin = await mkUser('LateJoin');
  created.users.push(dropped.id, checkedIn.id, lateJoin.id);

  const seriesId = randomUUID();
  created.series.push(seriesId);
  await prisma.tournamentSeries.create({
    data: {
      id: seriesId,
      slug: `wwrtk-${seriesId.slice(0, 8)}`,
      name: 'Wednesday Wars by RTK',
      owner_id: checkedIn.id,
      scoring_config: { model: 'A', points_per_game_played: 1, points_per_win: 1, final_size: 16, top_x: 2, tiebreakers: ['points', 'wins', 'games', 'random'] },
    },
  });

  const prior = await mkQualifier(seriesId, checkedIn.id, 'COMPLETED', 2);
  created.tournaments.push(prior);
  // Dropped: registered, played, then dropped → soft-deleted participant row.
  await prisma.tournamentParticipant.create({ data: { tournament_id: prior, user_id: dropped.id, deleted_at: new Date() } });
  const match = await prisma.match.create({
    data: { id: randomUUID(), tournament_id: prior, round: 1, match_number: 1, status: 'COMPLETED', player1_id: dropped.id, player2_id: checkedIn.id, phase: 'SWISS' },
  });
  await prisma.matchGame.create({ data: { match_id: match.id, game_number: 1, status: 'COMPLETED', winner_id: checkedIn.id, played_at: new Date() } });
  // Active + late-joined participants.
  await prisma.tournamentParticipant.create({ data: { tournament_id: prior, user_id: checkedIn.id } });
  await prisma.tournamentParticipant.create({ data: { tournament_id: prior, user_id: lateJoin.id, late_joined: true } });

  const newQ = await mkQualifier(seriesId, checkedIn.id, 'OPEN_REGISTRATION', 1);
  created.tournaments.push(newQ);
  newQualifierId = newQ;
});

afterAll(async () => {
  await prisma.matchGame.deleteMany({ where: { match: { tournament_id: { in: created.tournaments } } } });
  await prisma.match.deleteMany({ where: { tournament_id: { in: created.tournaments } } });
  await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: { in: created.tournaments } } });
  await prisma.tournament.deleteMany({ where: { id: { in: created.tournaments } } });
  await prisma.tournamentSeries.deleteMany({ where: { id: { in: created.series } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.$disconnect();
});

describe('series new-qualifier invite includes all prior registrants', () => {
  it('invites the dropped, checked-in and late-joined registrants alike', async () => {
    await maybeSendSeriesInvite(prisma, newQualifierId);
    const recipients = sentDms.map((d) => d.discordId).sort();

    expect(recipients).toContain(dropped.discord_id); // the fix: dropped registrant is now invited
    expect(recipients).toContain(checkedIn.discord_id);
    expect(recipients).toContain(lateJoin.discord_id);

    const t = await prisma.tournament.findUnique({ where: { id: newQualifierId }, select: { series_invite_sent: true } });
    expect(t?.series_invite_sent).toBe(true);
  });
});
