# Faction War — Fair Bracket Seeding (all formats)

Status: **BUILT (branch feat/matchup-finder-and-preview), not yet deployed.** Extends
the Faction War fairness (previously only in the Swiss round pairing,
`generateSwissRound` + `resolveFactionWarFairness`) to the **bracket formats** — Single
AND Double Elimination — via one shared seeding optimiser (`lib/faction-war-seeding.ts`,
resolver `resolveFactionWarSeedOrder`, wired into both `bracket.ts` start cases; pure
tests in `test/faction-war-seeding.test.ts`). Raised 2026-08-16 when Alex spotted that a 24-player Single
Elimination Faction War produced a faction-blind round 1 (only the Swiss path is
balanced today; `bracket.ts` `SINGLE_ELIMINATION` case calls `generateSingleElim`
with no fairness).

## The problem

A bracket's structure is fixed the moment it's generated. The **only lever** is the
**seeding** — which player lands in which leaf slot. Everything downstream (round-1
pairings and the whole tree of *potential* future matches) follows from that one
assignment. So "fair Faction War bracket" = **assign the N players to the S = nextPow2(N)
leaf slots to minimise the faction-matchup unfairness of the games that will actually be
played** (B = S − N of the slots are byes).

Faction War guarantees **every player has a distinct faction** (registration enforces
global faction exclusivity), so there are no mirror collisions — each leaf carries one
known faction.

### Why it's not just "pair the field fairly" (Alex's insight)

Swiss pairs the whole field each round, so a min-weight matching is enough. A bracket is
different on two counts:

1. **Byes.** With 24 in a 32-bracket, 8 players sit out round 1 and only 16 play (8
   real matches). We must decide **who gets the byes**, not just who plays whom.
2. **Round-2 look-ahead.** A bye player X is *guaranteed* to be in round 2, facing the
   winner of a round-1 match (a vs b). We can't know if a or b advances — so we want X's
   faction to be **balanced against both**, not crushing/crushed by either. The same idea
   applies at every internal node: a match's participants are a *distribution* over the
   factions that could reach it.

This is the crux: the objective must score not just round 1, but the **expected**
fairness of the deeper rounds, weighted by how likely each matchup is to happen.

## Objective function

Model the bracket as a binary tree of match nodes over the leaf assignment. For each
node, propagate a **distribution over which faction reaches it**:

- **Leaf / bye auto-advance:** the player's faction with probability 1. A "player vs bye"
  round-1 slot is *not a game* → contributes 0 cost and passes its faction up unchanged.
- **Real match node** with child faction-distributions `DA`, `DB`:
  - Matchup probability `P(fa vs fb) = DA[fa]·DB[fb]`.
  - **Node cost** `= Σ_{fa,fb} DA[fa]·DB[fb] · penalty(fa, fb)`.
  - **Winner distribution** `D[f] = Σ_g ( DA[f]·DB[g] + DB[f]·DA[g] ) · Pwin(f, g)`,
    where `Pwin(f,g) = logistic(tilt(f,g))` = the model's favourability of f over g.
    (The favoured faction advances more often — a principled, self-consistent propagation.)

`penalty(fa,fb)` — **convex**, to bound the "zu krasse Favourability" worst case Alex
called out: `penalty = factionUnfairness(fa,fb)²` (unfairness = `|logistic(tilt)−0.5|` ∈
[0, 0.5]). Squaring punishes one lopsided matchup far more than several mild ones — the
optimiser avoids crass duels even at the cost of a little extra mild imbalance. (This
mirrors the existing Swiss `pairCost`, which already squares the score gap.)

**Total cost** = Σ over all match nodes of (node cost). Round 1 is certain (weight 1 via
its matchup probabilities); deeper nodes contribute by how likely their matchups are —
so a bye player's round-2 expected duel against `Pwin(a)·penalty(X,a) + Pwin(b)·penalty(X,b)`
falls straight out of the same formula. No separate special-casing needed.

*Open decision D1:* an optional explicit **depth weight** `w_r` (e.g. down-weight rounds
≥3) if we want to prioritise the guaranteed early rounds over speculative late ones.
Default: no extra weight (probability already discounts uncertain rounds).

## Algorithm

The assignment space is large, but tournaments are small (N ≈ 8–64), so a **seeded local
search** is both flexible and fast:

1. **Initial seeding:** a reasonable start — e.g. the round-1 min-weight matching (reuse
   the existing blossom pairing) lifted into the bracket, or a seeded shuffle.
2. **Improve by swaps:** repeatedly swap two players' slots (or a player with a bye slot),
   recompute `cost`, accept improving moves (hill-climb) with occasional uphill moves
   (light simulated annealing) to escape local minima. Bounded iteration budget.
3. **Deterministic:** seed the RNG from the tournament id (reproducible brackets — same
   input → same bracket), consistent with the existing `seededShuffle`.

**Wiring — a pre-pass, minimal blast radius.** `generateSingleElim` /
`generateDoubleElim` already seed by the *order* of `participantIds`. So the optimiser is
a **pre-pass that reorders `participantIds`** for FACTION_WAR before those generators run
— exactly analogous to how `resolveFactionWarFairness` feeds the Swiss path. The
generators are untouched; for every other mode it's a no-op. Reuses
`loadMatchmakingData` + `factionUnfairness` (same favourability data as Swiss).

*Detail:* the optimiser must score against the **actual** slot→match mapping the
`SingleElimination` library produces for a given order (standard 1-vs-S, 2-vs-(S−1)…
seeding with byes to top slots). We either replicate that mapping in the scorer or
generate-and-read per candidate (fine at these sizes).

## Scope & format coverage

- **Single Elimination** — first target (Alex's case).
- **Double Elimination** — same initial-seeding pre-pass (the losers bracket is fed by the
  same round-1 assignment; the winners-bracket seeding is the lever). Composes with the
  existing cross-seed rematch-avoidance (v1.35.2) — that reshapes *loser drops*, this
  reshapes the *initial seeding*; they're orthogonal but we verify they don't fight.
- **Round Robin / Double RR** — everyone plays everyone, so there's no seeding fairness to
  optimise (out of scope; order only affects round *scheduling*, a possible later polish).
- **Liechtenstein / Balanced Liechtenstein** — already have their own scheduler
  (`generateLiechtensteinSchedule` receives `factionById`); whether it balances is a
  separate audit (*open decision D3*).

## Decisions (locked with Alex 2026-08-16)

- **D1 — penalty form: SQUARED.** `penalty(a,b) = factionUnfairness(a,b)²`. Convex, so a
  crass duel hurts far more than several mild ones. (Same house style as Swiss `pairCost`.)
- **D2 — look-ahead: ROUND 2 ONLY.** Alex's intent, verbatim: *"Es geht darum, dass
  wenigstens das erste Match jedes Spielers einigermaßen ausgewogen ist."* So the objective
  is **each player's FIRST game**, nothing deeper:
  - **Round-1 players** (the 16 who play): their first game is the round-1 match →
    `penalty(a, b)`.
  - **Bye players** (the 8 who wait): their first game is round 2, vs the winner of their
    feeder match (a vs b) → expected `Pwin(a,b)·penalty(X,a) + Pwin(b,a)·penalty(X,b)`.
  - **Total cost** = Σ round-1 real matches `penalty` + Σ bye players' expected round-2
    `penalty`. Deeper rounds are ignored by design. (No full-tree distribution
    propagation needed — only one level of look-ahead for the bye players.)
- **D3 — Liechtenstein.** Still open: audit whether its scheduler already balances; fold in
  or leave for later. (Not part of the SE/DE build.)

## Objective (final)

Minimise, over the seed assignment:
```
cost = Σ_{round-1 real match (a,b)}  penalty(a,b)
     + Σ_{bye player X, feeder match (a,b)}  Pwin(a,b)·penalty(X,a) + Pwin(b,a)·penalty(X,b)
```
where `penalty(x,y) = factionUnfairness(x,y)²`, `Pwin(x,y) = logistic(tilt(x,y))`, and a
never-played faction pair is treated as maximally uncertain (avoided), never a false 50%.
The lever is which 16 play round 1 (and how paired) + which 8 are byes (and which feeder
match each bye sits above). Seeded local search over the assignment; deterministic.

## Testing

- **Property tests** (pure, no DB — like `double-elim-rematch.test.ts`): across sizes
  8/16/24/32/48/64, assert (a) no round-1 real match exceeds a crass-favourability
  threshold when a fairer assignment exists; (b) bye players' expected round-2 unfairness
  is bounded; (c) determinism (same seed → same bracket); (d) graceful degradation when
  factions have no game history (never-played → treated as uncertain, not a false 50%).
- Reproduce Alex's 24-player case from real prod data and show the before/after round-1 +
  round-2 unfairness.
