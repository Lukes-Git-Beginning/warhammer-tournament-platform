// Dev-only: seed a Balanced Liechtenstein tournament so its bracket/standings
// page can be viewed in the browser. Uses the pure planPairings() to build the
// rounds, then persists them (rounds 1–2 completed, round 3 left in progress).
//
//   pnpm -F @rizzotto/backend exec tsx scripts/seed-balanced-dryrun.ts

import { randomUUID } from 'node:crypto';
import { prisma } from '@rizzotto/db';
import { planPairings, type BalancedMatchRow } from '../src/lib/balanced-liechtenstein.js';

const SLUG = 'dev-balanced-demo';
const ROUNDS = 3;
const BANDS = [1, 1, 2, 2, 4, 4];

async function main() {
  const prior = await prisma.tournament.findUnique({ where: { slug: SLUG }, select: { id: true } });
  if (prior) {
    await prisma.match.deleteMany({ where: { tournament_id: prior.id } });
    await prisma.tournamentParticipant.deleteMany({ where: { tournament_id: prior.id } });
    await prisma.tournament.delete({ where: { id: prior.id } });
  }

  const host = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  const hostId =
    host?.id ??
    (await prisma.user.create({ data: { discord_id: 'demo-bl-host', username: 'Demo Host' } })).id;

  const users = [];
  for (let i = 0; i < BANDS.length; i++) {
    users.push(
      await prisma.user.upsert({
        where: { discord_id: `demo-bl-${i}` },
        update: { username: `Demo Player ${i + 1}` },
        create: { discord_id: `demo-bl-${i}`, username: `Demo Player ${i + 1}` },
      }),
    );
  }

  const tournament = await prisma.tournament.create({
    data: {
      slug: SLUG,
      name: 'Balanced Liechtenstein Demo',
      host_id: hostId,
      format: 'BALANCED_LIECHTENSTEIN',
      status: 'ONGOING',
      rounds_count: ROUNDS,
      start_date: new Date('2026-06-01'),
      timezone: 'Europe/Berlin',
    },
  });

  await prisma.tournamentParticipant.createMany({
    data: users.map((u, i) => ({
      tournament_id: tournament.id,
      user_id: u.id,
      status: 'CHECKED_IN' as const,
      skill_band: BANDS[i]!,
    })),
  });

  const participants = users.map((u, i) => ({ userId: u.id, band: BANDS[i]! }));
  let matchNo = 0;

  async function readMatches(): Promise<BalancedMatchRow[]> {
    const ms = await prisma.match.findMany({
      where: { tournament_id: tournament.id },
      select: { round: true, player1_id: true, player2_id: true, status: true },
    });
    return ms.map((m) => ({ round: m.round, player1_id: m.player1_id, player2_id: m.player2_id, status: m.status }));
  }

  async function createFromPlan(finish: boolean) {
    const plan = planPairings(participants, await readMatches(), ROUNDS);
    for (const p of plan.pairings) {
      await prisma.match.create({
        data: {
          id: randomUUID(),
          tournament_id: tournament.id,
          round: p.round,
          match_number: ++matchNo,
          player1_id: p.player1_id,
          player2_id: p.player2_id,
          status: finish ? 'COMPLETED' : 'PENDING',
          winner_id: finish ? p.player1_id : null,
        },
      });
    }
    for (const b of plan.byes) {
      await prisma.match.create({
        data: {
          id: randomUUID(),
          tournament_id: tournament.id,
          round: b.round,
          match_number: ++matchNo,
          player1_id: b.player_id,
          player2_id: null,
          status: 'BYE',
          winner_id: b.player_id,
        },
      });
    }
  }

  await createFromPlan(true); // round 1 → completed
  await createFromPlan(true); // round 2 → completed
  await createFromPlan(false); // round 3 → in progress

  const total = await prisma.match.count({ where: { tournament_id: tournament.id } });
  console.log(`Seeded '${SLUG}' (${total} matches across up to ${ROUNDS} rounds).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
