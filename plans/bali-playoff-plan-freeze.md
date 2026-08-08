# BaLi Playoff Plan Freeze & Reconcile

Design note (Alex + Claude, 2026-08-09). Contingency for field changes **after** partial playoff
generation in Balanced Liechtenstein. Not yet built — this locks the decisions before we code.

## Problem

BaLi playoffs generate **per division, top-first** — a division's bracket is built once its own band
(and any band it borrows down into) is complete. So the top division can be generated and playing
while lower divisions are still in their group phase.

If the field then changes (a drop; less commonly a late join), a live recompute of `formDivisionPools`
on the reduced field drifts against what is already committed. Concretely today:

- **Stranding bug:** if a still-ungenerated lower division shrinks below `MIN_POOL_SIZE` (4), the merge
  rule (`balanced-liechtenstein.ts:628`) folds it into the division **above**. If that division is
  already generated, the merged pool is `alreadyInPlayoff` → **skipped → those players get no bracket**.
- A seed inside an already-generated bracket withdraws → only a walkover (via `withdrawn_player_id` +
  the survivor's action) or the **manual** #5 backfill covers it; no automatic re-composition.
- `reapplyDynamicSizing` bails entirely once any playoff phase exists (`auto-swiss-service.ts:106`),
  so nothing re-reacts to the changed field.

## Principle: freeze the STRUCTURE, resolve members late

We do **not** freeze which players are in which pool (a borrowed player's identity — e.g. "the top 3
of Advanced" — is only known after that band's last round). We freeze only the **structural skeleton**,
computed when the **first** division's playoff is generated:

- number of divisions,
- each division's band anchor,
- each division's target size + format (Top2/Top4/Top8),
- the **borrow specification** per division: "own band X + borrow K from the band(s) below".

The skeleton is a function of **band membership counts**, and a player's `skill_band` is fixed from
start (from the questionnaire/data, never changed by results). So the skeleton is knowable at
first-generation and only **drops** change it — which is exactly what the neighbour-bench borrow (below)
absorbs. Persisted artifact is a tiny structural descriptor, not a player list.

**Member resolution stays live:** each division's concrete seats resolve from the real standings as its
bands complete (the top-K borrowed players by *their* final ranks), per the frozen skeleton — never a
global recompute that could change the number/sizes of divisions.

## Rules

### Seat eligibility vs. ordering (the 0-point rule)
- **Seat-eligible ⇔ `rawScore > 0`** (at least one organic win, or the single real bye — you can get
  at most one). A `rawScore == 0` player (only losses and/or CATCHUP_BYEs, which score 0) **counts
  toward pool sizing/structure but is never seated** into a real bracket slot, and is not a backfill
  candidate. Closes the "join right before playoffs and grab a low-band seat" exploit.
- **Ordering among the eligible = `adjustedSeedScore`** (`rawScore − 0.2·rounds·max(0, divisionBand −
  playerBand)`), **unclamped**. A player who *earned* points but is driven to ≤ 0 by the cross-band
  handicap stays eligible and can take a seat in a weak enough pool — the handicap only orders, it does
  not gate. (Own-band players never get a handicap: `bandsBelow = 0`.)

### Neighbour-bench borrow (shortfall)
When a division is short a seat (drops ate into it), borrow from adjacent pools' **benches** (their
seat-eligible, non-qualifying members), choosing the players closest to the skill boundary:
- **Precedence:** the **top** of the **lower** neighbour first (the "just-missed"), then the **bottom**
  of the **higher** neighbour once the lower bench is exhausted.
- Never borrow into an already-**generated** (committed) division; borrowing only fills a
  still-ungenerated division.

### Withdrawal of a seeded player while the playoff runs
Reuse the existing flow (`participants.ts` drop → `withdrawn_player_id` + notify survivor; resolve via
the survivor's action). Add one branch:
- survivor says **played** → walkover (opponent advances), as today;
- survivor says **not played** → **auto-reseed** the next eligible seat from the frozen structure /
  neighbour benches.
(The match-state "is it PENDING" is *not* a reliable "was it played" signal — a random-map SFT has no
pick step — so the survivor's declaration is the trigger.)

### Degenerate cases (accepted as non-practical)
Not all players in a division can be `rawScore == 0` (they are paired against each other → someone
wins), and no one can hold more than one bye. So no special fallback: if a division ever has < 2
seat-eligible players, the existing `seeds.length < 2 → no bracket / lone champion` path applies.

## Integration with what already shipped

- **#5 backfill** (`matches.ts` backfill-next-seed) sources the replacement from the **frozen
  structure + neighbour benches** instead of a live `formDivisionPools` recompute.
- **#3 reconciler** (once-a-minute tick) generates frozen-skeleton divisions as their bands complete
  and applies neighbour-bench borrow for shortfalls — instead of re-deriving pools each tick.
- `startBalancedPlayoffs`: after the first division exists, read the persisted skeleton rather than
  recomputing pools on the live field.

## Persistence (migration)

Store the skeleton once, at first generation. Options:
- a JSON column on `Tournament` (e.g. `playoff_plan`), or
- a small `PlayoffDivisionPlan` table (one row per division: band anchor, target size, format, borrow
  spec, ordinal).

Descriptor is small and write-once; a JSON column is likely enough. Idempotent: written only when the
first division generates and no plan exists yet.

## Open questions
- None blocking. (Seat rule, ordering, borrow precedence, withdrawal trigger, degenerate handling all
  decided above.) Remaining is the persistence shape (JSON column vs. table) — decide at build time.

## Build order (proposed)
1. Migration + write the skeleton at first generation (in `startBalancedPlayoffs`).
2. Resolve later divisions from the skeleton + seat-eligibility (`rawScore > 0`) filter.
3. Neighbour-bench borrow with precedence.
4. Point `startBalancedPlayoffs` / reconciler at the skeleton instead of the live recompute.
5. Repoint #5 backfill at the skeleton; add the survivor "not played → auto-reseed" branch.
6. Pure tests: stranding case, borrow precedence, 0-point exclusion, handicap-negative-but-eligible.
