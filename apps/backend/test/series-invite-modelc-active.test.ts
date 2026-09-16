/**
 * Repro (LotET R4): a Model-C series where a player is an ACTIVE (non-deleted) participant of a
 * prior qualifier but did NOT place in the top-X (so is NOT already-qualified) must still be
 * invited to the next qualifier. This isolates the live "no DM" symptom: if this passes, the
 * recipient LOGIC includes the case, so the miss is on the delivery/trigger side, not the query.
 * sendDm/isBotConfigured are mocked.
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

async function mkQualifier(
  seriesId: string,
  hostId: string,
  status: 'OPEN_REGISTRATION' | 'COMPLETED',
  position: number,
): Promise<string> {
  const id = randomUUID();
  await prisma.tournament.create({
    data: {
      id,
      slug: `qc-${id.slice(0, 8)}`,
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

const created: { users: string[]; tournaments: string[]; series: string[] } = {
  users: [],
  tournaments: [],
  series: [],
};

let qualifiedA: U; // placed 1st in the prior → already qualified (Model C top_x=2)
let qualifiedB: U; // placed 2nd → already qualified
let activeNotQualified: U; // checked-in, placed 3rd → NOT qualified — this is Alex's exact case
let newQualifierId: string;

beforeAll(async () => {
  qualifiedA = await mkUser('QualA');
  qualifiedB = await mkUser('QualB');
  activeNotQualified = await mkUser('ActiveNotQual');
  created.users.push(qualifiedA.id, qualifiedB.id, activeNotQualified.id);

  const seriesId = randomUUID();
  created.series.push(seriesId);
  await prisma.tournamentSeries.create({
    data: {
      id: seriesId,
      slug: `lotet-c-${seriesId.slice(0, 8)}`,
      name: 'Model C Prize Fight',
      owner_id: activeNotQualified.id, // the host is also a (non-qualified) player, like Alex
      scoring_config: { model: 'C', top_x: 2 },
    },
  });

  // Prior qualifier: completed; top-2 = A,B (qualified); activeNotQualified finished 3rd.
  const prior = await mkQualifier(seriesId, activeNotQualified.id, 'COMPLETED', 1);
  created.tournaments.push(prior);
  for (const u of [qualifiedA, qualifiedB, activeNotQualified]) {
    await prisma.tournamentParticipant.create({ data: { tournament_id: prior, user_id: u.id } });
  }
  await prisma.tournamentResult.createMany({
    data: [
      { tournament_id: prior, user_id: qualifiedA.id, placement: 1 },
      { tournament_id: prior, user_id: qualifiedB.id, placement: 2 },
      { tournament_id: prior, user_id: activeNotQualified.id, placement: 3 },
    ],
  });

  const newQ = await mkQualifier(seriesId, activeNotQualified.id, 'OPEN_REGISTRATION', 2);
  created.tournaments.push(newQ);
  newQualifierId = newQ;
});

afterAll(async () => {
  await prisma.tournamentResult.deleteMany({ where: { tournament_id: { in: created.tournaments } } });
  await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: { in: created.tournaments } } });
  await prisma.tournament.deleteMany({ where: { id: { in: created.tournaments } } });
  await prisma.tournamentSeries.deleteMany({ where: { id: { in: created.series } } });
  await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.$disconnect();
});

describe('Model-C series invite: active-but-not-qualified prior participant', () => {
  it('invites the checked-in non-qualified player and skips the already-qualified', async () => {
    await maybeSendSeriesInvite(prisma, newQualifierId);
    const recipients = sentDms.map((d) => d.discordId);

    // Alex's exact case: active in a prior qualifier, not in the top-X → MUST be invited.
    expect(recipients).toContain(activeNotQualified.discord_id);
    // Already-qualified players are correctly skipped (Model C).
    expect(recipients).not.toContain(qualifiedA.discord_id);
    expect(recipients).not.toContain(qualifiedB.discord_id);

    const t = await prisma.tournament.findUnique({
      where: { id: newQualifierId },
      select: { series_invite_sent: true },
    });
    expect(t?.series_invite_sent).toBe(true);
  });
});
