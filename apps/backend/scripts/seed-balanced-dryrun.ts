// Dev-only: seed a Balanced Liechtenstein tournament so its bracket/standings
// page can be viewed in the browser. Uses the pure planPairings() to build the
// rounds, then persists them (rounds 1–2 completed, round 3 left in progress).
//
//   pnpm -F @rizzotto/backend exec tsx scripts/seed-balanced-dryrun.ts

import { randomUUID } from 'node:crypto';
import { prisma } from '@rizzotto/db';
import {
  planPairings,
  formDivisionPools,
  DEFAULT_BAND,
  type BalancedMatchRow,
} from '../src/lib/balanced-liechtenstein.js';
import {
  computeSwissStandings,
  sortSwissStandings,
  type CompletedMatchRecord,
} from '../src/lib/swiss.js';

const SLUG = 'dev-balanced-demo';
const ROUNDS = 3;
const BANDS = [4, 4, 4, 4, 2, 2, 2, 2]; // two even divisions

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

  async function createFromPlan(): Promise<number> {
    const plan = planPairings(participants, await readMatches(), ROUNDS);
    for (const p of plan.pairings) {
      // Winner alternates a bit so the standings are not a straight column.
      const winner = matchNo % 3 === 0 ? p.player2_id : p.player1_id;
      await prisma.match.create({
        data: {
          id: randomUUID(),
          tournament_id: tournament.id,
          round: p.round,
          match_number: ++matchNo,
          player1_id: p.player1_id,
          player2_id: p.player2_id,
          status: 'COMPLETED',
          winner_id: winner,
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
    return plan.pairings.length + plan.byes.length;
  }

  // Play the whole group phase to completion.
  while ((await createFromPlan()) > 0) {
    /* keep pairing + finishing rounds until everyone has played all rounds */
  }

  // Division playoffs: rank by Swiss standings, form pools, create the finals.
  const full = await prisma.match.findMany({
    where: { tournament_id: tournament.id },
    select: { round: true, player1_id: true, player2_id: true, winner_id: true, status: true },
  });
  const records: CompletedMatchRecord[] = full
    .filter((m) => m.status === 'COMPLETED' || m.status === 'BYE')
    .map((m) => ({ round: m.round, player1_id: m.player1_id, player2_id: m.player2_id, winner_id: m.winner_id, status: m.status }));
  const sorted = sortSwissStandings(
    computeSwissStandings(users.map((u) => u.id), records),
    records,
  );
  const bandByUser = new Map(users.map((u, i) => [u.id, BANDS[i] ?? DEFAULT_BAND]));
  const ranked = sorted.map((s, i) => ({ userId: s.userId, band: bandByUser.get(s.userId) ?? DEFAULT_BAND, rank: i + 1 }));
  const pools = formDivisionPools(ranked);
  const playoffRound = ROUNDS + 1;
  for (const pool of pools) {
    if (!pool.finalists) continue;
    await prisma.match.create({
      data: {
        id: randomUUID(),
        tournament_id: tournament.id,
        round: playoffRound,
        match_number: ++matchNo,
        player1_id: pool.finalists[0],
        player2_id: pool.finalists[1],
        status: 'PENDING',
        phase: 'PLAYOFF_FINAL',
      },
    });
  }

  const total = await prisma.match.count({ where: { tournament_id: tournament.id } });
  console.log(`Seeded '${SLUG}' (${total} matches, ${pools.length} divisions, ${pools.filter((p) => p.finalists).length} finals).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
