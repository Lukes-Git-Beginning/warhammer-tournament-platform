# BaLi (Balanced Liechtenstein) — open bug queue

Status: **DIAGNOSED, NOT YET BUILT.** Surfaced live by
`bottom-of-the-barrel-3x3-vol-2` (2026-07-11). All decisions below are Alex-final.
Build order recommendation: **these BaLi bugs BEFORE the new 1v3 mode.**

Prior robustness work (CATCHUP_BYE + withdraw→void) is already deployed
(`main a62d7c5`, see memory `session-2026-07-11-bali-swiss-robustness`). The bugs
here are the *next* layer that live play exposed.

---

## #1 — Phantom player in playoffs ("Big Bees")

**Symptom:** Big Bees appeared in the finals/playoff bracket despite never being a
real contender.

**Root cause:** `startBalancedPlayoffs` (`balanced-liechtenstein-service.ts`)
builds `ranked` = `sorted.filter(!withdrawnIds)` — this still **includes
REGISTERED players who never checked in**. The division pool must be built from
**CHECKED_IN contenders only**.

**Fix:**
1. Pool/ranked filter = only participants with `status = CHECKED_IN` (and not
   withdrawn). One condition in `formDivisionPools` / the `ranked` build.
2. **Gap to close:** a **late check-in AFTER the bracket generated** (host clicks
   force-checkin post-bracket) must be routed through **`admitBalancedLateJoiner`**
   (catch-up-bye admission), NOT just flipped to CHECKED_IN — otherwise the player
   is either ignored or dropped into playoffs with no games. Treat late check-in
   1:1 like a late join.

---

## #2 — Catch-up byes still award Swiss points

**Symptom:** Dniper joined in round 3 and sat on **3 bye points**. Late joiners
get free points from the tick's cascade byes.

**Root cause:** `runBalancedPairingTick`'s cascade byes are **scoring BYEs**, not
`CATCHUP_BYE`. The earlier fix only covered the *entry* bye, not byes the tick
hands out while cascading a not-yet-played player forward.

**Fix — "0 points until first real game" at the tick level:**
- Any bye handed to a player who has **not yet played a real game** in this
  tournament is a **0-point `CATCHUP_BYE`** (0 Swiss points, 0 Buchholz).
- **Earned byes are protected:** a bye an on-time player earns through normal
  pairing is a scoring bye and is **never reclaimed / converted** for a late
  joiner's benefit.
- **Measure ("das richtige Maß"):** 0 Swiss points **and** 0 Buchholz — i.e. "no
  bigger difference than a round naturally generates." A missed round is a real
  disadvantage, not a free point; a single real game still beats not playing.

---

## #3 — Double-bye for two same-band players

**Symptom:** In round 4, separate bye matches were created for **Impepinable and
RizzOtto**, who are in the **same band** — they should have been paired with each
other instead of both getting a bye.

**Root cause:** the pairing cascade (`pairPool` / tick) can leave two compatible
stuck players unpaired and bye both.

**Fix (narrow, exploit-aware):** when **two symmetric 0-point late-joiner byes**
exist at the **current frontier**, pair them instead of double-bye — but only
under all four conditions:
1. Both are the **latest / current-round** bye (never backfill an old round).
2. Both at the **same current depth** (same number of completed games).
3. **Band-gap ≤ the round's max real-pairing gap** (don't create a matchup wider
   than the round already produced between real players).
4. **Both are 0-Swiss-point** (neither has banked a scoring result yet).

**Exploit to prevent (Alex):** a Band-5 top player must not be able to *join late
on purpose* to farm an easy win against a low-band player sitting on a bye round.
Conditions 1+3 block this: pairing only happens at the frontier and only within
the round's natural band spread — no cherry-picked easy games, no backfilling two
round-4 joiners into a round-1 pairing just because both hold 0-point byes there.

---

## #4 — Playoffs are all-or-nothing

**Symptom:** "Why is the top division playoff not generated yet? It's 100%
decided who's in it." The whole tournament must be complete before *any* division
playoff generates.

**Fix — per-division generation:** a division's playoff generates as soon as
**its own band(s) are complete AND every band it borrows from (downward
borrowing, `formDivisionPools`) is complete** — independent of lower divisions
still finishing. Top division can start while the barrel is still fighting.

Guard the `force` path already planned (see
`plans/…patch-day-vivid-plum.md`) so a host can still force if needed, but the
default should no longer block a decided division.

---

## #5 — Regen robustness + ★ FINALIST badge

- Playoff (re)generation must be **idempotent / safe** — regenerating must not
  duplicate nodes or strand players.
- Fix the **★ FINALIST badge** display bug (surfaced alongside the corrupted
  playoff bracket).

---

## Cross-cutting invariant (narrowed, Alex-final)

- Two independent axes, do not conflate:
  - **Swiss points / Buchholz** — CATCHUP_BYE = 0/0.
  - **Pairing cost** — a catch-up placeholder contributes **0 pairing cost** so it
    never distorts the blossom matching, but that is *not* a Swiss point.
- Never reclaim an **earned** bye. Only two symmetric **0-point late-joiner** byes
  at the frontier may be paired to each other (#3).

## Build checklist (ordered)

Branch `fix/bali-playoff-byes` (off main 535ae26), **CI green**, NOT merged/deployed.

1. [x] #1 pool = CHECKED_IN contenders (`641d464`) + late check-in → `admitBalancedLateJoiner`
2. [x] #2 tick byes for un-played late joiners → CATCHUP_BYE (0/0); earned byes protected (`641d464`)
   - [x] BONUS: CATCHUP_BYE counts as `receivedBye` → no Swiss double-bye (`1e83682`)
3. [x] #4 per-division playoff generation — startBalancedPlayoffs idempotent + span-band
       completeness gate; auto-launch every tick, guards removed (`30c0e08`)
4. [x] #3 double-bye → replay (`6adab37`): when the pool has stragglers and no
       reinforcements are due, pair the leftovers among themselves (cheapest first,
       immediate rematch only as last resort) and bye just the final odd one — instead
       of sitting several on byes across ticks. Alex confirmed: the two rematch-locked
       players should REPLAY, not both bench. Updated the pure test that encoded the
       old behavior; 27 unit tests green locally.
5. [x] #5 placement/podium badge (`67d41f6`) — tournament 1st/2nd/3rd now come from
       the TOP division's playoff nodes (GF winner/loser + small-final winner), keyed
       by userId, not the group rank. Fixes: a borrowed small-final winner (von
       Carstein) shown under a lower division now gets 3RD; the group-rank-3 player who
       LOST the small final (Xeblon) gets nothing. Frontend-only,
       `getBalancedTopDivisionPodium` + unit test (ran GREEN locally + on CI).
       (The ★ FINALIST badge itself was already correct.)
6. [x] tests: Big Bees exclusion, per-division early generation, idempotency, podium
       (all green on CI; podium unit test also runs locally — pure frontend fn)

**ALL FIXES DEPLOYED & LIVE 2026-07-12** — #1, #1b, #2, bonus, #4, #5, #3 merged to
prod main `ef57346` (bundle `index-Cia0jE_x.js`, rizzotto.gg 200), together with the
1v3+BO2 feature ("beide zusammen"). Queue complete.
