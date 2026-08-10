# Design note — 50%-Matchup Finder (NI-6, layer 1)

Status: **design** (build first of NI-6; the booking flow is layer 2, later).
Decided with Alex (r1/r2): build the balanced-matchup finder **before** the booking flow.

## Goal

Given two players (or a pool), surface concrete **match setups** — a pair of factions,
one per player — whose predicted **Chance-to-Win (CtW)** for the favourite lands in a
**tight band around 50%** (target **47.5–52.5%**). Where several balanced setups exist
between the same two players, **rotate** them across a Bo3/Bo5 so the series stays fair
game-to-game rather than fair only on average.

This turns "who do I play" into "which *matchup* is a real coin-flip", using data the
platform already computes.

## CtW model — reuse what exists, don't invent

Two existing signals combine into CtW. **Both already live in the codebase** — this is a
composition task, not new ML.

1. **Faction Proficiency** — per player, per faction: how good *this player* is with
   *that faction*. Source: `getFactionProficiency` / the proficiency computation
   (`neutralWinChance = logistic(...)`, see the faction-proficiency work, 2026-06-16).
   Gives a player-vs-neutral skill-with-faction number.
2. **Matchup Favourability** — faction-vs-faction intrinsic balance (independent of
   player), i.e. the 3×3 / matchup matrix + the faction **Model Strength** from
   `rating-model.ts`. Gives "faction A vs faction B, all else equal" tilt.

**CtW(playerP w/ factionA  vs  playerQ w/ factionB)** =
combine( ProficiencyEdge(P,A vs Q,B), MatchupFavourability(A vs B) )
→ a single 0–1 win probability for P.

> **OPEN — confirm with Alex (round 4):** the exact combiner. Cleanest is a **logistic
> over summed log-odds**: `CtW = logistic( k_prof·(profP_A − profQ_B) + k_mu·muTilt(A,B) )`,
> where `muTilt` is the matchup matrix expressed as log-odds and `k_*` are weights.
> This keeps it in the same logistic family as the existing proficiency model and makes
> "47.5–52.5%" a clean symmetric band around `CtW = 0.5`. Need Alex to confirm the source
> of `muTilt` (matchup matrix vs. Model-Strength delta) and whether both players' *general*
> skill also factors in or only faction-specific proficiency.

## The finder algorithm

Inputs: players P, Q; their eligible faction sets (respect tournament/format faction
restrictions if inside a tournament; all factions in Open Play).

1. For every (A, B) in P.factions × Q.factions, compute `CtW(P,A vs Q,B)`.
2. Keep pairs with `|CtW − 0.5| ≤ 0.025` (the 47.5–52.5% band). Call these **balanced setups**.
3. Sort balanced setups by closeness to 0.5.
4. **Series rotation (Bo3/Bo5):** pick the top-N distinct balanced setups (N = series
   length), preferring **faction diversity** (don't reuse the same A-vs-B twice while
   another balanced setup exists). If fewer than N balanced setups exist, fall back:
   fill remaining games with the next-closest-to-50% setups and **flag** the series as
   "partially balanced".
5. If **zero** setups fall in the band, return the single closest-to-50% setup + a clear
   "no true coin-flip available — closest is X%" note (fail-soft, never empty).

## Where it lives (UX)

- Open Play: a new mode in the challenge UI — "Find a balanced matchup" — that, given a
  chosen opponent (or an auto-suggested close-skill opponent, layer-2 general-skill tier),
  returns the balanced setup(s) and pre-fills the match with the rotated factions.
- Read-only preview first (show the setups + CtW%), then "create match with these factions".

> **OPEN — confirm with Alex (round 4):** invite/eligibility scope — is the finder
> opponent-specified (you pick who, it finds the factions) or does it also *find the
> opponent* (pool-wide search for anyone with whom a 50% setup exists)? r1 leaned
> "50%-matchup finder first"; r2 confirmed order but not whether opponent is fixed.

## Build sketch

- Pure lib `apps/backend/src/lib/matchup-finder.ts`:
  - `computeCtW(profP_A, profQ_B, muTilt)` — pure, unit-tested against hand-picked cases
    (symmetry: CtW(P,A vs Q,B) = 1 − CtW(Q,B vs P,A)).
  - `findBalancedSetups(P, Q, opts)` → sorted setups + band flag.
  - `rotateSeries(setups, seriesLength)` → the game-by-game faction plan.
- Route: `POST /api/open-play/find-matchup { opponentId, seriesLength }` → setups.
- Tests: band edges (exactly 47.5/52.5), zero-in-band fallback, rotation diversity,
  fewer-than-N fallback, symmetry invariant.

## Explicitly out of scope (layer 2, later)

- The **booking flow** (creator marks calendar availability → invitee books a concrete
  slot). Separate feature, decided to come after the finder.
- General-skill-only opponent finder (the simple tier) — can be a thin wrapper once the
  CtW finder exists.

## Open questions carried to round 4

1. CtW combiner form + weights, and the `muTilt` source (matchup matrix vs Model-Strength delta).
2. Whether general skill factors in alongside faction proficiency.
3. Opponent-fixed vs pool-wide opponent search.
4. Default series length for the rotation (Bo3?).
