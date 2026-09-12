// ---------------------------------------------------------------------------
// Team GS (General Skill) — cold-start blend (Alex 2026-09-12).
//
// A 2v2 team is an opaque competitor in the rating fit, so it earns its own fitted GS. But a
// brand-new duo has no games yet, so we blend the members' AVERAGE individual GS (a prior) with
// the team's own fitted 2v2 GS (the data) via the same Fisher-weighted Bayes blend the player
// soft-floor uses. The team starts at its members' strength and converges to its real team rating
// as it plays. Shared by the team profile page and the Balanced-Liechtenstein team banding.
// ---------------------------------------------------------------------------

import { skillToBand, logistic } from './rating-model.js';
import { blendSkill } from './skill-classification.js';

/** The team's own 2v2 GS is worth this many balanced games against the members'-average prior.
 *  A dial candidate (AdminConfig) once teams have played enough to calibrate it. */
export const TEAM_GS_PRIOR_EQUIV_GAMES = 10;

/** Minimal shape of a fitted rating model this helper reads. */
interface RatingModelLike {
  generalSkills: { playerId: string; generalSkill: number; stdError: number; gamesCount: number }[];
}

export interface TeamGs {
  /** Effective (blended) general skill, log-odds. */
  generalSkill: number;
  stdError: number;
  band: number; // 1..5
  winChance: number; // logistic(generalSkill) — vs an average competitor
  gamesCount: number; // the team's OWN decisive 2v2 games
  /** Still leaning on the members' prior (few own games). */
  provisional: boolean;
  /** No own games yet — the estimate is purely the members' average. */
  fromMembers: boolean;
}

/**
 * Resolve a team's GS from a fitted rating model: the members' average individual GS (prior)
 * blended with the team's own fitted 2v2 GS (data). Returns null only when neither the team nor
 * any member has a rated game. `memberUserIds` are the team's members; `teamId` is the competitor
 * id used in the Match slots.
 */
export function resolveTeamGs(
  model: RatingModelLike,
  teamId: string,
  memberUserIds: readonly string[],
  priorEquivGames: number = TEAM_GS_PRIOR_EQUIV_GAMES,
): TeamGs | null {
  const teamEntry = model.generalSkills.find((e) => e.playerId === teamId);
  const memberSkills = memberUserIds
    .map((uid) => model.generalSkills.find((e) => e.playerId === uid)?.generalSkill)
    .filter((s): s is number => s != null);
  const priorMu = memberSkills.length
    ? memberSkills.reduce((a, b) => a + b, 0) / memberSkills.length
    : null;

  if (priorMu == null && !teamEntry) return null;

  const base =
    priorMu != null
      ? blendSkill(
          priorMu,
          { generalSkill: teamEntry?.generalSkill ?? null, stdError: teamEntry?.stdError ?? null },
          priorEquivGames,
        )
      : { skill: teamEntry!.generalSkill, se: teamEntry!.stdError };

  const teamGames = teamEntry?.gamesCount ?? 0;
  return {
    generalSkill: base.skill,
    stdError: base.se,
    band: skillToBand(base.skill),
    winChance: logistic(base.skill),
    gamesCount: teamGames,
    provisional: priorMu != null && teamGames < priorEquivGames,
    fromMembers: teamGames === 0,
  };
}
