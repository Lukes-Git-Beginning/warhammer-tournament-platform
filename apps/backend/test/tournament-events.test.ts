import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the prisma singleton so recordTournamentEvent can be unit-tested without a DB.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }));
vi.mock('@rizzotto/db', () => ({
  prisma: { tournamentEvent: { create: createMock } },
  Prisma: {},
}));

import { recordTournamentEvent } from '../src/lib/tournament-events.js';

describe('recordTournamentEvent', () => {
  beforeEach(() => createMock.mockReset());

  it('inserts with defaults (actor=system, null ids) and omits payload when not given', async () => {
    createMock.mockResolvedValue({});
    await recordTournamentEvent({ tournamentId: 't1', type: 'match_completed' });
    expect(createMock).toHaveBeenCalledOnce();
    const data = createMock.mock.calls[0]![0]!.data;
    expect(data).toMatchObject({
      tournament_id: 't1',
      type: 'match_completed',
      actor: 'system',
      actor_id: null,
      subject_id: null,
    });
    // payload key is spread in only when provided → absent here.
    expect('payload' in data).toBe(false);
  });

  it('passes actor, ids and payload through when given', async () => {
    createMock.mockResolvedValue({});
    await recordTournamentEvent({
      tournamentId: 't2',
      type: 'participant_dropped',
      actor: 'host',
      actorId: 'h1',
      subjectId: 's1',
      payload: { matchId: 'm1' },
    });
    const data = createMock.mock.calls[0]![0]!.data;
    expect(data).toMatchObject({
      tournament_id: 't2',
      type: 'participant_dropped',
      actor: 'host',
      actor_id: 'h1',
      subject_id: 's1',
      payload: { matchId: 'm1' },
    });
  });
});
