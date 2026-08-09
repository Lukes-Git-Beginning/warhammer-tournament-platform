/**
 * Replay→apply attribution (replay-apply.ts): match the replay's players to the two participants and
 * read each one's faction, flagging the cases that must escalate to a host instead of an opponent
 * confirmation. See plans/replay-dispute-player-resolution.md.
 */
import { describe, it, expect } from 'vitest';
import { attributeReplayFactions } from '../src/lib/replay-apply.js';
import type { ReplayPlayer } from '../src/lib/replay-parser.js';

const rp = (name: string, faction: string | null): ReplayPlayer => ({ name, faction });

describe('attributeReplayFactions', () => {
  it('attributes each participant their faction from the replay', () => {
    const r = attributeReplayFactions([rp('Alice', 'khorne'), rp('Bob', 'empire')], 'Alice', 'Bob', ['dwarfs', 'empire']);
    expect(r.player1FactionSlug).toBe('khorne');
    expect(r.player2FactionSlug).toBe('empire');
    expect(r.ambiguous).toBe(false);
  });

  it('matches through clan tags / punctuation (normalised names)', () => {
    const r = attributeReplayFactions([rp('-ODM- flower', 'skaven'), rp('Bob', 'empire')], '[-ODM-] flower', 'Bob', []);
    expect(r.player1FactionSlug).toBe('skaven');
    expect(r.player2FactionSlug).toBe('empire');
    expect(r.ambiguous).toBe(false);
  });

  it('is ambiguous when a participant is not found in the replay', () => {
    const r = attributeReplayFactions([rp('Alice', 'khorne'), rp('Someone Else', 'empire')], 'Alice', 'Bob', []);
    expect(r.ambiguous).toBe(true);
  });

  it('is ambiguous when the faction diff vs the report is Chaos-god only', () => {
    // Replay: khorne vs empire; report: tzeentch vs empire → the only difference is a Chaos-god swap.
    const r = attributeReplayFactions([rp('Alice', 'khorne'), rp('Bob', 'empire')], 'Alice', 'Bob', ['tzeentch', 'empire']);
    expect(r.ambiguous).toBe(true);
  });

  it('is NOT ambiguous for a clear non-Chaos faction mismatch', () => {
    const r = attributeReplayFactions([rp('Alice', 'skaven'), rp('Bob', 'empire')], 'Alice', 'Bob', ['dwarfs', 'empire']);
    expect(r.ambiguous).toBe(false);
    expect(r.player1FactionSlug).toBe('skaven');
  });
});
