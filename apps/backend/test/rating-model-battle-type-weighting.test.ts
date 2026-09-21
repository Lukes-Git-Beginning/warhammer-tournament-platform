/**
 * Regression tests for the battle-type-weighting fixes (2026-09).
 *
 * Bug: a player's Overall (base) General Skill was dragged toward the UNWEIGHTED centroid of their
 * per-battle-type skills, because each (player, battleType) offset (BTO) was L2-penalised the same
 * regardless of sample size. So a handful of games in a brand-new mode (e.g. 4 Conquest games) could
 * move a 400+-game player's Overall winChance by several points — mathematically wrong.
 *
 * Fix 1 (minBattleTypeGamesForOffset): a battle type earns its own offset only once it has enough
 * games; below that, its games flow into the base GS with NO offset, so a thin new-mode sample can't
 * drag the Overall. Fix 2 (minMatchupGamesForSplit): thin per-type matchup buckets pool into the
 * version-agnostic one. This file focuses on Fix 1 (the proven, dominant effect).
 */
import { describe, expect, it } from 'vitest';
import { fitRatingModel, type MatchObservation } from '../src/lib/rating-model.js';

// One faction for everyone → matchup term is always a mirror (0), isolating the GS/BTO behaviour.
const F = 'f';
function game(winnerId: string, loserId: string, battleType: string): MatchObservation {
  return { playerAId: winnerId, factionXId: F, playerBId: loserId, factionYId: F, aWon: true, battleType };
}
/** `wins` wins + `losses` losses for P in `battleType`, each vs a fresh opponent (anchors P near the mean). */
function record(p: string, wins: number, losses: number, battleType: string): MatchObservation[] {
  const obs: MatchObservation[] = [];
  for (let i = 0; i < wins; i++) obs.push(game(p, `${battleType}-w-${i}`, battleType));
  for (let i = 0; i < losses; i++) obs.push(game(`${battleType}-l-${i}`, p, battleType));
  return obs;
}

describe('battle-type weighting — Overall must not be dragged by a thin new-mode sample', () => {
  it('a handful of Conquest games barely moves a 100-game Domination player (game-weighted Overall)', () => {
    // P: 63% over 100 Domination games; then a 2–2 (50%) run of just 4 Conquest games.
    const obs = [...record('P', 63, 37, 'DOMINATION'), ...record('P', 2, 2, 'CONQUEST')];
    const m = fitRatingModel(obs, { hierarchical: true });

    const overall = m.getOverallSkill('P')!; // the fix: game-weighted Overall
    const baseGs = m.getGeneralSkill('P')!.skill; // the raw base GS (near the unweighted centroid)
    const domView = m.getBattleTypeSkill('P', 'DOMINATION')!;
    const conqView = m.getBattleTypeSkill('P', 'CONQUEST')!;

    // The Overall tracks the dominant mode (100 of 104 games) — the thin Conquest sample can't pull it.
    expect(Math.abs(overall - domView)).toBeLessThan(0.05);
    // ...and is NOT dragged down toward the tiny Conquest sample.
    expect(overall).toBeGreaterThan(conqView + 0.1);
    // The raw base GS IS pulled below the Overall — that is exactly the bug the weighting corrects.
    expect(overall).toBeGreaterThan(baseGs);
    // Sanity: P is a winning Domination player.
    expect(domView).toBeGreaterThan(0.2);
  });

  it('preserves genuine per-battle-type differences once both types have a real sample', () => {
    // P is clearly better at Domination (70% / 40 games) than Conquest (35% / 40 games).
    const obs = [...record('P', 28, 12, 'DOMINATION'), ...record('P', 14, 26, 'CONQUEST')];
    const m = fitRatingModel(obs, { hierarchical: true });

    const dom = m.getBattleTypeSkill('P', 'DOMINATION')!;
    const conq = m.getBattleTypeSkill('P', 'CONQUEST')!;
    const overall = m.getOverallSkill('P')!;

    // The fix must NOT flatten real differences: Domination view clearly above Conquest view.
    expect(dom).toBeGreaterThan(conq + 0.2);
    // Overall (game-weighted, ~50/50 games here) sits between the two per-type skills.
    expect(overall).toBeLessThan(dom);
    expect(overall).toBeGreaterThan(conq);
  });
});
