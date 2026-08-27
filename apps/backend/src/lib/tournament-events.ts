/**
 * Append-only tournament lifecycle event log. Records durable "what happened when" events
 * (playoff generation/freeze, participant joins/drops/withdrawals, reseeds) so forensics is a
 * query, not detective work. Fire-and-forget safe: it never throws into the caller — a logging
 * failure must not break the tournament flow. Rows are never updated or deleted.
 */
import { prisma, Prisma } from '@rizzotto/db';

export type TournamentEventActor = 'system' | 'host' | 'admin' | 'player';

export interface TournamentEventInput {
  tournamentId: string;
  /** Snake-case event type, e.g. 'playoff_division_generated', 'participant_withdrew'. */
  type: string;
  actor?: TournamentEventActor;
  /** The user who triggered it (host/admin/player action), if any. */
  actorId?: string | null;
  /** The affected user (e.g. who dropped or was seeded), if any. */
  subjectId?: string | null;
  /** Structured details (seeds, band, format, the frozen plan, reason, …). */
  payload?: unknown;
}

/** Append one immutable event row. Never throws — logging must not break the caller's flow. */
export async function recordTournamentEvent(e: TournamentEventInput): Promise<void> {
  try {
    await prisma.tournamentEvent.create({
      data: {
        tournament_id: e.tournamentId,
        type: e.type,
        actor: e.actor ?? 'system',
        actor_id: e.actorId ?? null,
        subject_id: e.subjectId ?? null,
        ...(e.payload != null ? { payload: e.payload as Prisma.InputJsonValue } : {}),
      },
    });
  } catch (err) {
    console.warn('[tournament-events] recordTournamentEvent failed (non-fatal):', err);
  }
}
