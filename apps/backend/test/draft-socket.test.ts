/**
 * Unit tests for draft-emit helpers (M4.5).
 *
 * These tests cover the pure I/O helper functions without a live Socket.IO
 * server — the io instance is replaced with a minimal mock.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  maskStateForViewer,
  draftRoom,
  draftPlayerRoom,
  draftSpectatorRoom,
  emitDraftStateSync,
} from '../src/lib/draft-emit.js';
import type { DraftState } from '@tww3/types';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const DRAFT_ID = 'aabbccdd-0000-0000-0000-000000000001';
const HOST_ID = 'bbbbbbbb-0000-0000-0000-000000000001';

function makeState(overrides?: Partial<DraftState>): DraftState {
  return {
    picks: { host: [], guest: [] },
    bans: [],
    exclusive_bans: { host: [], guest: [] },
    hidden_picks: { host: ['faction_a'], guest: ['faction_b'] },
    hidden_bans: { host: [], guest: [] },
    hidden_pick_variants: { host: ['global'], guest: ['global'] },
    hidden_ban_variants: { host: [], guest: [] },
    parallel_pending: { host: null, guest: null },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// maskStateForViewer
// ---------------------------------------------------------------------------

describe('maskStateForViewer', () => {
  it('host viewer sees own hidden_picks, opponent replaced with "?"', () => {
    const state = makeState();
    const result = maskStateForViewer(state, 'host');

    expect(result.hidden_picks.host).toEqual(['faction_a']);
    expect(result.hidden_picks.guest).toEqual(['?']);
  });

  it('guest viewer sees own hidden_picks, opponent replaced with "?"', () => {
    const state = makeState();
    const result = maskStateForViewer(state, 'guest');

    expect(result.hidden_picks.guest).toEqual(['faction_b']);
    expect(result.hidden_picks.host).toEqual(['?']);
  });

  it('spectator sees neither side hidden_picks (both empty arrays)', () => {
    const state = makeState();
    const result = maskStateForViewer(state, 'spectator');

    expect(result.hidden_picks.host).toEqual([]);
    expect(result.hidden_picks.guest).toEqual([]);
    expect(result.hidden_bans.host).toEqual([]);
    expect(result.hidden_bans.guest).toEqual([]);
  });

  it('spectator also sees neither side hidden_bans', () => {
    const state = makeState({
      hidden_bans: { host: ['faction_c', 'faction_d'], guest: ['faction_e'] },
      hidden_ban_variants: { host: ['exclusive', 'exclusive'], guest: ['global'] },
    });
    const result = maskStateForViewer(state, 'spectator');

    expect(result.hidden_bans.host).toEqual([]);
    expect(result.hidden_bans.guest).toEqual([]);
  });

  it('revealed picks and bans are always visible regardless of viewer', () => {
    const state = makeState({
      picks: { host: ['faction_x'], guest: ['faction_y'] },
      bans: ['faction_z'],
    });

    for (const viewer of ['host', 'guest', 'spectator'] as const) {
      const result = maskStateForViewer(state, viewer);
      expect(result.picks.host).toEqual(['faction_x']);
      expect(result.picks.guest).toEqual(['faction_y']);
      expect(result.bans).toEqual(['faction_z']);
    }
  });

  it('placeholder count matches opponent hidden array length', () => {
    const state = makeState({
      hidden_picks: { host: ['a', 'b', 'c'], guest: ['x'] },
      hidden_pick_variants: { host: ['g', 'g', 'g'], guest: ['g'] },
    });

    const hostView = maskStateForViewer(state, 'host');
    // Guest has 1 hidden pick → host sees ['?']
    expect(hostView.hidden_picks.guest).toHaveLength(1);

    const guestView = maskStateForViewer(state, 'guest');
    // Host has 3 hidden picks → guest sees ['?', '?', '?']
    expect(guestView.hidden_picks.host).toHaveLength(3);
    expect(guestView.hidden_picks.host).toEqual(['?', '?', '?']);
  });
});

// ---------------------------------------------------------------------------
// Room naming helpers
// ---------------------------------------------------------------------------

describe('Room naming helpers', () => {
  it('draftRoom formats correctly', () => {
    expect(draftRoom(DRAFT_ID)).toBe(`draft_${DRAFT_ID}`);
  });

  it('draftPlayerRoom formats correctly', () => {
    expect(draftPlayerRoom(DRAFT_ID, HOST_ID)).toBe(`draft_${DRAFT_ID}:player_${HOST_ID}`);
  });

  it('draftSpectatorRoom formats correctly', () => {
    expect(draftSpectatorRoom(DRAFT_ID)).toBe(`draft_${DRAFT_ID}:spec`);
  });
});

// ---------------------------------------------------------------------------
// emitDraftStateSync (with mock io)
// ---------------------------------------------------------------------------

describe('emitDraftStateSync', () => {
  it('calls io.to(target).emit with the correct event and payload', () => {
    const emitMock = vi.fn();
    const toMock = vi.fn(() => ({ emit: emitMock }));
    const mockIo = { to: toMock } as unknown as Parameters<typeof emitDraftStateSync>[0];

    const state = makeState();
    const payload = {
      draftId: DRAFT_ID,
      state: maskStateForViewer(state, 'spectator'),
      currentTurn: 2,
      timerExpiresAt: '2026-05-13T15:00:00.000Z',
      status: 'ONGOING' as const,
    };

    emitDraftStateSync(mockIo, `draft_${DRAFT_ID}:spec`, payload);

    expect(toMock).toHaveBeenCalledWith(`draft_${DRAFT_ID}:spec`);
    expect(emitMock).toHaveBeenCalledWith('draft_state_sync', payload);
  });

  it('is a no-op when io is undefined', () => {
    const state = makeState();
    // Should not throw
    expect(() =>
      emitDraftStateSync(undefined, `draft_${DRAFT_ID}`, {
        draftId: DRAFT_ID,
        state: maskStateForViewer(state, 'host'),
        currentTurn: 0,
        timerExpiresAt: null,
        status: 'PENDING',
      }),
    ).not.toThrow();
  });
});
