// ---------------------------------------------------------------------------
// Broadcast DM — resolve a filtered audience and send a DM to each recipient
// via the bot, PACED to stay under Discord's rate limits. Two entry points wire
// to it: admin (a global, filterable audience) and host (a tournament's players).
//
// Design notes:
//  - Cheap SQL filters (activity via last_login, supporter tier via flag columns)
//    narrow the set first; the EXPENSIVE computed skill-band filter runs only over
//    those survivors (there is no stored/queryable band column — it is derived).
//  - `sendDm` has no throttle of its own, so we batch + sleep here (Discord 429s
//    otherwise). Callers fire this WITHOUT awaiting it in the request path.
// ---------------------------------------------------------------------------

import type { PrismaClient } from '@rizzotto/db';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { sendDm } from './discord-notify.js';
import { SUPPORTER_FLAG_SELECT, effectiveTiersOf } from './supporter-service.js';
import { loadCalibrationQuestions } from './skill-classification-service.js';
import { getRatingModel } from './rating-model-service.js';
import { classify, questionnaireFloor } from './skill-classification.js';

/** Admin audience filters. All empty/false = every user. Filters AND together. */
export const BroadcastAudienceSchema = z.object({
  activeOnly: z.boolean().optional().default(false),
  activeDays: z.number().int().min(1).max(365).optional().default(30),
  bands: z.array(z.number().int().min(1).max(5)).optional().default([]),
  tiers: z.array(z.enum(['supporter', 'lord', 'champion'])).optional().default([]),
});
export type BroadcastAudience = z.infer<typeof BroadcastAudienceSchema>;

export interface BroadcastRecipient {
  id: string;
  discord_id: string;
}

/**
 * Resolve an admin audience to recipients (users with a Discord ID). Cheap SQL
 * filters run first; the computed skill-band filter runs only over the survivors.
 * Uses the player's headline (gating) band — what a player sees as "their band".
 */
export async function resolveAdminAudience(
  prisma: PrismaClient,
  redis: Redis | undefined,
  audience: BroadcastAudience,
): Promise<BroadcastRecipient[]> {
  const rows = await prisma.user.findMany({
    where: {
      deleted_at: null,
      ...(audience.activeOnly
        ? { last_login: { gte: new Date(Date.now() - audience.activeDays * 86_400_000) } }
        : {}),
      ...(audience.tiers.length > 0
        ? {
            OR: [
              { supporter_discord: true },
              { lord_discord: true },
              { champion_discord: true },
              { supporter_manual: true },
              { lord_manual: true },
              { champion_manual: true },
            ],
          }
        : {}),
    },
    select: { id: true, discord_id: true, ...SUPPORTER_FLAG_SELECT },
  });

  // Every user has a Discord ID (non-nullable), so no null-filtering is needed.
  let candidates = rows;

  // Precise tier match (the SQL OR above only narrows to "holds any tier").
  if (audience.tiers.length > 0) {
    candidates = candidates.filter((r) => {
      const t = effectiveTiersOf(r);
      return audience.tiers.some((tier) => t[tier]);
    });
  }

  // Skill-band filter: the band is computed (no indexed column), so we mirror the
  // Statistics distribution endpoint's efficient batch pass — load the rating model
  // ONCE, fetch all survivors' calibration answers in ONE query, then classify in
  // memory. Uses the headline (gating) band, what a player sees as "their band".
  if (audience.bands.length > 0) {
    const season = await prisma.season.findFirst({ where: { is_active: true }, select: { id: true } });
    if (!season) return []; // no active season → no band signal → target nobody
    const [model, questions, answerRows] = await Promise.all([
      getRatingModel(prisma, redis, { seasonId: season.id, config: { hierarchical: true } }),
      loadCalibrationQuestions(prisma),
      prisma.user.findMany({
        where: { id: { in: candidates.map((c) => c.id) } },
        select: { id: true, calibration_answers: true },
      }),
    ]);
    const answersById = new Map(
      answerRows.map((r) => [r.id, (r.calibration_answers as Record<string, string> | null) ?? {}]),
    );
    candidates = candidates.filter((c) => {
      const gs = model.getGeneralSkill(c.id);
      const { gatingBand } = classify(questionnaireFloor(answersById.get(c.id) ?? {}, questions), {
        generalSkill: gs?.skill ?? null,
        stdError: gs?.se ?? null,
      });
      return audience.bands.includes(gatingBand);
    });
  }

  return candidates.map((c) => ({ id: c.id, discord_id: c.discord_id }));
}

/** A tournament's active participants (host broadcast), deduped, Discord-linked only. */
export async function resolveParticipants(
  prisma: PrismaClient,
  tournamentId: string,
): Promise<BroadcastRecipient[]> {
  const rows = await prisma.tournamentParticipant.findMany({
    where: {
      tournament_id: tournamentId,
      deleted_at: null,
      status: { in: ['REGISTERED', 'CHECKED_IN'] },
    },
    select: { user: { select: { id: true, discord_id: true } } },
  });
  const seen = new Set<string>();
  const out: BroadcastRecipient[] = [];
  for (const r of rows) {
    if (r.user?.discord_id && !seen.has(r.user.id)) {
      seen.add(r.user.id);
      out.push({ id: r.user.id, discord_id: r.user.discord_id });
    }
  }
  return out;
}

/**
 * Send a broadcast to recipients, batched + spaced to stay under Discord's DM
 * rate limits. Fire WITHOUT awaiting in the request path. Each DM is prefixed
 * with `header` so it does not read as a bare, context-free bot message.
 */
export async function sendBroadcast(
  recipients: BroadcastRecipient[],
  header: string,
  body: string,
): Promise<{ sent: number; failed: number }> {
  const content = `${header}\n\n${body}`;
  const BATCH = 20;
  const GAP_MS = 1200;
  let sent = 0;
  let failed = 0;
  for (let i = 0; i < recipients.length; i += BATCH) {
    const batch = recipients.slice(i, i + BATCH);
    const results = await Promise.allSettled(
      batch.map((r) => sendDm(r.discord_id, content, { broadcast: true })),
    );
    for (const res of results) {
      if (res.status === 'fulfilled') sent++;
      else failed++;
    }
    if (i + BATCH < recipients.length) await new Promise((res) => setTimeout(res, GAP_MS));
  }
  return { sent, failed };
}
