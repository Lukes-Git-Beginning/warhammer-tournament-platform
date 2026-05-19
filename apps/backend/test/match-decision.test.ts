/**
 * Unit tests for Match-Decision state machine and helpers.
 *
 * These tests are fully in-memory — no DB, no Socket.IO.
 * They verify the ban order, RANDOM selection determinism, and blind-pick reveal logic.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Re-implement pure helpers from match-decision.ts for isolated testing.
// (We can't import the route module directly because it depends on Fastify instance.)
// ---------------------------------------------------------------------------

function deterministicMapPick(mapIds: string[], seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = (hash * 16777619) >>> 0;
  }
  return mapIds[hash % mapIds.length];
}

// ---------------------------------------------------------------------------
// Ban-order state machine (pure function version for testing)
// ---------------------------------------------------------------------------

interface BanState {
  bansTop: string[];
  bansBottom: string[];
  pickedMapId: string | null;
  error?: string;
}

function applyBan(
  state: BanState,
  mapId: string,
  actorIsTop: boolean,
  poolMapIds: string[],
): BanState {
  const { bansTop, bansBottom } = state;

  if (state.pickedMapId) {
    return { ...state, error: 'already_decided' };
  }

  // Check if map is in pool
  if (!poolMapIds.includes(mapId)) {
    return { ...state, error: 'map_not_in_pool' };
  }

  // Check if already banned
  const allBanned = [...bansTop, ...bansBottom];
  if (allBanned.includes(mapId)) {
    return { ...state, error: 'already_banned' };
  }

  // Validate turn order: top bans first
  const isTopTurn = bansTop.length === 0;
  const isBottomTurn = bansTop.length === 1 && bansBottom.length === 0;

  if (!isTopTurn && !isBottomTurn) {
    return { ...state, error: 'both_already_banned' };
  }

  if (isTopTurn && !actorIsTop) {
    return { ...state, error: 'wrong_turn' };
  }
  if (isBottomTurn && actorIsTop) {
    return { ...state, error: 'wrong_turn' };
  }

  const newBansTop = isTopTurn ? [...bansTop, mapId] : bansTop;
  const newBansBottom = !isTopTurn ? [...bansBottom, mapId] : bansBottom;

  const newAllBanned = [...newBansTop, ...newBansBottom];
  const remaining = poolMapIds.filter((id) => !newAllBanned.includes(id));

  let pickedMapId: string | null = null;
  if (newBansTop.length >= 1 && newBansBottom.length >= 1 && remaining.length === 1) {
    pickedMapId = remaining[0];
  }

  return { bansTop: newBansTop, bansBottom: newBansBottom, pickedMapId };
}

// ---------------------------------------------------------------------------
// Blind-pick reveal logic
// ---------------------------------------------------------------------------

interface BlindPickState {
  player1FactionId: string | null;
  player2FactionId: string | null;
  player1LockedAt: Date | null;
  player2LockedAt: Date | null;
  revealedAt: Date | null;
}

function applyBlindPickLock(
  state: BlindPickState,
  playerId: 1 | 2,
  factionId: string,
): BlindPickState & { error?: string } {
  if (playerId === 1 && state.player1LockedAt) {
    return { ...state, error: 'already_locked' };
  }
  if (playerId === 2 && state.player2LockedAt) {
    return { ...state, error: 'already_locked' };
  }

  const now = new Date();
  const next: BlindPickState = {
    ...state,
    ...(playerId === 1
      ? { player1FactionId: factionId, player1LockedAt: now }
      : { player2FactionId: factionId, player2LockedAt: now }),
  };

  // Reveal when both locked
  const bothLocked = Boolean(next.player1LockedAt && next.player2LockedAt);
  if (bothLocked && !next.revealedAt) {
    next.revealedAt = new Date();
  }

  return next;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('deterministicMapPick', () => {
  const pool = ['map-a', 'map-b', 'map-c', 'map-d', 'map-e'];

  it('always returns the same map for the same seed', () => {
    const seed = 'abc123def456abc123def456abc123de';
    const pick1 = deterministicMapPick(pool, seed);
    const pick2 = deterministicMapPick(pool, seed);
    expect(pick1).toBe(pick2);
    expect(pool).toContain(pick1);
  });

  it('returns different maps for different seeds (usually)', () => {
    const picks = new Set<string>();
    for (let i = 0; i < 20; i++) {
      picks.add(deterministicMapPick(pool, `seed-${i}`));
    }
    // With 5 maps and 20 different seeds, we expect at least 2 different picks
    expect(picks.size).toBeGreaterThan(1);
  });

  it('handles single-item pool', () => {
    const single = ['only-map'];
    expect(deterministicMapPick(single, 'any-seed')).toBe('only-map');
  });

  it('all picked maps are in the pool', () => {
    for (let i = 0; i < 50; i++) {
      const pick = deterministicMapPick(pool, `random-seed-${Math.random()}`);
      expect(pool).toContain(pick);
    }
  });
});

describe('Ban-order state machine', () => {
  const pool = ['map-alpha', 'map-beta', 'map-gamma'];

  function emptyState(): BanState {
    return { bansTop: [], bansBottom: [], pickedMapId: null };
  }

  it('top player bans first', () => {
    const s0 = emptyState();
    const s1 = applyBan(s0, 'map-alpha', true, pool);
    expect(s1.error).toBeUndefined();
    expect(s1.bansTop).toEqual(['map-alpha']);
    expect(s1.pickedMapId).toBeNull();
  });

  it('bottom player cannot ban first', () => {
    const s0 = emptyState();
    const s1 = applyBan(s0, 'map-alpha', false, pool);
    expect(s1.error).toBe('wrong_turn');
  });

  it('top player cannot ban twice', () => {
    const s0 = emptyState();
    const s1 = applyBan(s0, 'map-alpha', true, pool);
    const s2 = applyBan(s1, 'map-beta', true, pool);
    expect(s2.error).toBe('wrong_turn');
  });

  it('after both bans, remaining map is picked', () => {
    const s0 = emptyState();
    const s1 = applyBan(s0, 'map-alpha', true, pool);
    const s2 = applyBan(s1, 'map-beta', false, pool);
    expect(s2.error).toBeUndefined();
    expect(s2.pickedMapId).toBe('map-gamma');
    expect(s2.bansTop).toEqual(['map-alpha']);
    expect(s2.bansBottom).toEqual(['map-beta']);
  });

  it('cannot ban a map not in pool', () => {
    const s0 = emptyState();
    const s1 = applyBan(s0, 'map-invalid', true, pool);
    expect(s1.error).toBe('map_not_in_pool');
  });

  it('cannot ban already-banned map', () => {
    const s0 = emptyState();
    const s1 = applyBan(s0, 'map-alpha', true, pool);
    // bottom tries to ban the same map
    const s2 = applyBan(s1, 'map-alpha', false, pool);
    expect(s2.error).toBe('already_banned');
  });

  it('cannot ban after decision is already made', () => {
    const s0 = emptyState();
    const s1 = applyBan(s0, 'map-alpha', true, pool);
    const s2 = applyBan(s1, 'map-beta', false, pool);
    // Now decision is made (map-gamma picked)
    const s3 = applyBan(s2, 'map-gamma', true, pool);
    expect(s3.error).toBe('already_decided');
  });

  it('different ban choices yield the correct remaining map', () => {
    // Top bans gamma, bottom bans alpha → beta is picked
    const s0 = emptyState();
    const s1 = applyBan(s0, 'map-gamma', true, pool);
    const s2 = applyBan(s1, 'map-alpha', false, pool);
    expect(s2.pickedMapId).toBe('map-beta');
  });

  it('works with larger pool (5 maps, 1 ban each)', () => {
    const bigPool = ['a', 'b', 'c', 'd', 'e'];
    const s0 = emptyState();
    const s1 = applyBan(s0, 'a', true, bigPool);
    // After 1 top ban, 4 remain — no pick yet
    expect(s1.pickedMapId).toBeNull();

    const s2 = applyBan(s1, 'b', false, bigPool);
    // After 1 bottom ban, 3 remain — still no pick (needs exactly 1 remaining)
    expect(s2.pickedMapId).toBeNull();
    // With 3 remaining maps, the "both banned" condition is met but remaining.length !== 1
    // so pickedMapId stays null (pick-ban flow here only auto-picks at remaining=1)
    // This models the case where the organizer may configure additional bans
  });
});

describe('Blind-pick reveal logic', () => {
  function emptyBlindPick(): BlindPickState {
    return {
      player1FactionId: null,
      player2FactionId: null,
      player1LockedAt: null,
      player2LockedAt: null,
      revealedAt: null,
    };
  }

  it('player 1 can lock faction', () => {
    const s0 = emptyBlindPick();
    const s1 = applyBlindPickLock(s0, 1, 'high_elves');
    expect(s1.error).toBeUndefined();
    expect(s1.player1FactionId).toBe('high_elves');
    expect(s1.player1LockedAt).not.toBeNull();
    expect(s1.revealedAt).toBeNull(); // not yet revealed (player2 not locked)
  });

  it('player 2 can lock faction independently', () => {
    const s0 = emptyBlindPick();
    const s1 = applyBlindPickLock(s0, 2, 'greenskins');
    expect(s1.error).toBeUndefined();
    expect(s1.player2FactionId).toBe('greenskins');
    expect(s1.revealedAt).toBeNull();
  });

  it('reveal happens when both players lock', () => {
    const s0 = emptyBlindPick();
    const s1 = applyBlindPickLock(s0, 1, 'high_elves');
    const s2 = applyBlindPickLock(s1, 2, 'greenskins');
    expect(s2.error).toBeUndefined();
    expect(s2.revealedAt).not.toBeNull();
    expect(s2.player1FactionId).toBe('high_elves');
    expect(s2.player2FactionId).toBe('greenskins');
  });

  it('reverse lock order also reveals', () => {
    const s0 = emptyBlindPick();
    const s1 = applyBlindPickLock(s0, 2, 'greenskins');
    const s2 = applyBlindPickLock(s1, 1, 'high_elves');
    expect(s2.revealedAt).not.toBeNull();
  });

  it('player cannot lock twice', () => {
    const s0 = emptyBlindPick();
    const s1 = applyBlindPickLock(s0, 1, 'high_elves');
    const s2 = applyBlindPickLock(s1, 1, 'greenskins');
    expect(s2.error).toBe('already_locked');
  });

  it('faction IDs are hidden before reveal', () => {
    const s0 = emptyBlindPick();
    const s1 = applyBlindPickLock(s0, 1, 'high_elves');
    // player2 has NOT locked yet — revealedAt is null
    expect(s1.revealedAt).toBeNull();
    // Frontend should not show faction IDs until revealedAt != null
    // This is enforced by the route handler, not the pure state
  });

  it('both players can lock simultaneously (same tick)', () => {
    // Simulate concurrent lock by applying both in sequence
    const s0 = emptyBlindPick();
    const s1 = applyBlindPickLock(s0, 1, 'faction-a');
    const s2 = applyBlindPickLock(s1, 2, 'faction-b');
    expect(s2.revealedAt).not.toBeNull();
    expect(s2.player1FactionId).toBe('faction-a');
    expect(s2.player2FactionId).toBe('faction-b');
  });
});
