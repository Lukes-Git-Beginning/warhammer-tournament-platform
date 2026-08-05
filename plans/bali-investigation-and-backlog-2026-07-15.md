# BaLi investigation (enticitys-tuesday-...-free-pick-2) + change backlog — 2026-07-15

Tournament `10b71610-030a-42d3-ae1e-2c131f7418fe`, BALANCED_LIECHTENSTEIN / FREE_PICK,
4 group rounds. Data pulled live from prod `/bracket`. Bands = skillBand 1–5.

## Investigation findings (grounded in data + code)

**Q1 — Byrd/Beagle scored byes vs mirakelvking 0-pt catch-up. ALL THREE WERE LATE JOINERS.**
`registered_at` vs start (17:00 UTC): Byrd +3min, Beagle +26min, mirakelvking +60min. Plus 6
WITHDREWs (Briefumschlag, TL, PJsforshort, Sleepylion, CHMO, Beagle).
Root (bal-liecht-**service**.ts): `admitBalancedLateJoiner` sets entry round
`A = clamp(max(earliestActiveRound, frontier-1), 1, rounds)` and creates CATCHUP_BYE placeholders
for rounds 1..A-1. The 0-pt protection (`runBalancedPairingTick`:237) only fires for a player who
HAS a CATCHUP_BYE placeholder (`isLateJoiner = own.some(status==='CATCHUP_BYE')`).
- Byrd/Beagle joined while R1 still had open matches → `earliestActiveRound=1` → **A=1 → no
  placeholder → they enter R1 → their odd-one-out bye is a NORMAL SCORED bye** (free point).
- mirakelvking joined after R1+R2 closed → A=3 → CATCHUP_BYE for R1,R2 (0 pts) → enters R3.
→ **The real flaw:** a late joiner slotted into a *still-technically-open* early round gets a FREE
SCORED bye = exactly the "reward for being late". And the R1 double-bye: Beagle entered R1 ALONE
(everyone else had advanced to R2; a lingering R1 straggler kept `earliestActiveRound=1`), so no
opponent → bye. Alex's hypothesis refined: double-bye happens when a late joiner is dropped into an
earlier round whose members already advanced (no opponent left) — not merely "the other already had
a next-round match". Fix ties to item #5 (enter at the FRONTIER, not round 1) + not scoring the
entry bye.

**Q2 — extreme play-ups (Briefumschlag b2 vs RAD b5 Δ3 R2; Beagle b1 vs Enticity b5 Δ4 R3).**
Root: `pairPool` leftover-pairing (balanced-liechtenstein.ts:194-214). When a round pool has
leftovers and NOBODY else incoming, it pairs the leftovers among themselves cheapest-first
rather than bye them (the #3 double-bye fix). If the only two leftovers are far-apart bands, you
get Δ3/Δ4. Side effect of async pairing + "don't double-bye".

**Q3 — RizzOtto vs Welshlion rematch (R2 + R4).**
Async/incremental pairing: `planPairings` re-plans after every completion, pairing whoever's free
against the cheapest available/incoming partner. Traced band-3 meetings: by R4, garon/PJs/
Welshlion/RizzOtto had all played each other → each could only play MorS or CHMO fresh (2 fresh
slots for 4 players → rematches forced). `EVENTUAL_REMATCH_COST=1.5` makes a repeat cheaper than a
2-band play-up, so Blossom picked rematches. R4 band-3 reproduced R2's pairings.
→ Crux: **BaLi pairs asynchronously with partial info**, so it makes locally-cheap choices a
synchronous round-Swiss would avoid. Real, not a display glitch.

**Q4 — playoff generation.** `formDivisionPools` (bal-liecht.ts:376): order players by band desc
then rank; each band keeps its own players; a band with <4 (`MIN_POOL_SIZE`) borrows the best of
the bands BELOW to reach 4; a trailing bottom pool still <4 MERGES into the pool above. Seat 1 is
reserved for the best OWN-band player (a real top-band player always tops the bracket); seats 2..N
by Swiss rank, any band. Bracket size by pool size (`divisionPlayoffFormat`: 4-7→TOP2 [final+3rd],
8-15→TOP4, 16+→TOP8). Observed: TOP DIVISION = bands 5+4 merged (Enticity/Byrd/Kaine/RAD);
INTERMEDIATE = band 3 + the too-small b1/b2 bottom merged up → that's how **jaysix (b1) qualified
into the Intermediate playoff**.

## Design-review: Late Join & Byes + Band-Gap pairing (converging 2026-07-15)

**Late-joiner detection — the signal is NOT `registered_at`.** A player registered on time but
force-checked-in by the host AFTER bracket generation is 1:1 a late joiner. Correct signal =
**a persistent "late-joined" marker set at admission** (late-join OR post-bracket force-checkin;
both already route through `admitBalancedLateJoiner`). The 0-pt-bye rule keys off (marker AND
no real game yet) — closes the A=1 hole (Byrd/Beagle) + the force-checkin case in one.

**Pending-bye reclaim (Alex prefers reclaim over gifting points).** A bye stays PENDING until its
holder is paired into the next round; while pending it is fillable → real match instead of a 2nd
bye. Cause-agnostic — one mechanism covers every way a same-depth player appears:
  1. Late joiner enters. 2. Drop→void frees the survivor. 3. (rare) host resets/restores a
  completed match → players fall back to the depth. No per-case special logic.

**Band-gap rule (Alex, self-calibrating) — applies to reclaim AND normal leftover-pairing:**
> A match (reclaim or leftover) is only created if its band gap is **≤ the widest band gap already
> in that round**; otherwise → BYE (0 pts for late joiner, else a normal scored bye). Empty round
> (no real matches yet) → floor at Δ0 (same band only).
Wrinkle: "widest gap in the round" is a moving target under async pairing — decide whether it's
computed over matches generated-so-far or the round's intended full set.

**Open design questions:** (a) over-cap → prefer BYE even if that means a double-bye? (lean yes:
two byes beat a Δ4 stomp). (b) two on-time leftover players byed by the cap → both get a SCORED
bye (they showed up) — ok? (c) build the pending-bye mechanic (touches the async tick — blast
radius) or keep host-judgment?

**Root of the extreme play-ups — it's the PAIRING, not the byes (verified).** R2 Δ3 = RAD(b5) vs
Briefumschlag(b2). WHY: RAD's only b5-mate available was TL, but RAD **already played TL in R1**
(#2) → immediate rematch FORBIDDEN. His b4 options (Kaine) were **consumed by an earlier
incremental pairing** (Kaine-OneCreator #14, created before RAD's #16). So RAD had no close-band
partner left → leftover-paired with the only remaining player (Briefumschlag, Δ3).
→ A GLOBAL batch pairing was strictly better: RAD-Kaine(Δ1) + OneCreator-Briefumschlag(Δ1) = Δ2
total, vs the incremental Δ4. **The greedy pair-on-arrival consumes close-band partners before the
awkward player needs them.** Fixes: (a) band-gap cap = GUARD (bye instead of stomp), (b) the real
quality fix = less-greedy pairing (hold a freed player / periodically re-run global Blossom over the
whole currently-waiting pool instead of pairing purely on arrival).

**Empty-round edge is moot (Alex).** A bye only crystallizes once no more players are incoming to
that round → by then the round is already populated, so there's always a "widest gap" to compare
against. If a round were truly empty, players are still finishing the previous round (incoming) →
pairPool HOLDS the lone player, doesn't bye. No special Δ0 floor needed.

**NEW topic for the divisional-playoff discussion (Alex):** when a borrowed/merged lower-division
player is seeded against a higher-division player by Swiss points, **how much should be SUBTRACTED
from the lower player's Swiss points** to make the cross-band comparison fair (a 5-0 in b2 ≠ a 5-0
in b4)? Currently seeds 2..N are raw Swiss rank across bands (seat 1 is own-band-reserved). Open.

## Pairing engine — the real design direction (Alex 2026-07-15)

**What the system IS (resolves the greedy-vs-Blossom confusion):** `pairPool` runs **Blossom
(global min-cost)** — but only over the **players waiting in the pool at that tick's snapshot**.
So: Blossom WITHIN a tick, **greedy ACROSS time** (snapshots are partial; a pairing commits
immediately and can't be undone; a partner paired in an earlier tick is gone). The #18 Greedy→
Blossom switch fixed stranding *within one pass*; it did NOT add a time dimension. The RAD case:
Kaine was committed (#14) before RAD's snapshot (#16) → Kaine no longer available.

**Bottom-up gap (honest):** the current cost is symmetric linear `|band_a − band_b|` — it does NOT
explicitly guarantee the weakest gets a next-band partner. Global-min-cost helps the weak on
average but the RAD case proves an upper-band player can be stranded and a low player can be
stomped. The "von unten nach oben" decision is not fully coded.

**Constraint (Alex): NO extreme play-ups (Δ3/4) AND byes are NOT the fix.** So the band-gap cap
(which byes) is rejected as the primary solution. Fix must be on pairing QUALITY. Four levers:
1. **Progressive/asymmetric band cost — the asymmetry must live ONLY in gaps ≥ 2, NOT the single
   step.** Alex's catch #2: a per-step ladder where b1↔b2 is the priciest Δ1 backfires two ways —
   (a) a b2 then prefers b3 (cheaper) over b1 → b2 flees upward, **stranding b1**; (b) b1 becomes
   "expensive to pair" → more bye-prone. Both are the OPPOSITE of protecting the weak. Fix: **every
   Δ1 is uniform + cheap (< rematch 1.5)**; the low-end penalty applies only to the accumulation
   beyond the first step. Cleanest as a 2D table `cost[lowerBand][gap]`:
   |lowerBand\gap| Δ1 | Δ2 | Δ3 | Δ4 |
   |---|---|---|---|---|
   | b1 | 1.0 | 2.5 | 5.0 | 9.0 |
   | b2 | 1.0 | 2.0 | 4.0 | — |
   | b3 | 1.0 | 1.3 | — | — |
   | b4 | 1.0 | — | — | — |
   All Δ1 = 1.0 (uniform, no upward flight); Δ2 asymmetric (b1-b3 = 2.5 > rematch 1.5 > b3-b5 = 1.3);
   Δ3+ prohibitive, steeper at the low end. Numbers illustrative — **validate any table by
   simulation on real tournament data before shipping** (Alex keeps finding calibration traps by
   reasoning; the web of relative values is delicate). The one-band-up guarantee (#2) is the hard
   backstop under all of this.
2. **One-band-up guarantee for the weakest** — a lone low player plays up **at most one band**
   (any fresh next-band player), never multi-band. (≥2-band-up for a low player ≈ forbidden cost.)
3. **Hold, don't commit (the time factor).** Don't pair the instant someone frees up; keep pairings
   provisional and **re-optimize the whole waiting pool on every event** (completion/drop/join).
   Hold a player if committing now would strand a weaker one or force a big gap. Time-cost grows
   with wait so nobody waits forever. **Byes only as the true degenerate end-case.**
4. **Short batching window** — collect players who free up within a small window, then Blossom the
   batch, so the snapshot is bigger. Middle ground between pure-incremental and full-synchronous.

**Honest complexity:** the north star ("perfect real-time global, no premature commitment") is hard
— you can't un-start a running match, and you can't predict who frees up when. The four levers are
the pragmatic ~90%: progressive cost + one-band cap kill the extreme play-ups; hold+re-optimize +
batching recover the quality the greedy-in-time loses; byes avoided except degenerate end.

## Pairing engine — the target algorithm (Alex's model, 2026-07-15)

**"Provisional optimum, commit-when-free."** Alex's vision spelled out:
1. Model the round's **FULL field** = WAITING (free) + INCOMING (still playing the previous round)
   − already-COMMITTED. Recompute on every event (completion / drop / late-join).
2. Compute the **global min-cost matching** over the full field.
3. Keep pairings **provisional (constraints, not commitments)**: each waiting player carries the SET
   of partners with whom they appear in SOME min-cost matching ("5 equivalent optima → any of them").
4. **Commit** a concrete match the instant two mutually-optimal partners are BOTH free → fast, but
   only ever an optimal-consistent pair (never a lazy/suboptimal pair just to be quick).
5. A waiting player with **no free optimal partner** (all their optima are still INCOMING) → **HOLD**.
6. Byes only in the true degenerate end.

**Why it's tractable (the key enabler): BaLi pairs by BAND, not SCORE.** Bands are static and
rematch-history is known, so — unlike a score-based Swiss — the ENTIRE round's players + attributes
are known up front. The only unknown is arrival *timing*. So the optimum is well-defined at any
moment; the engineering is the provisional + commit-when-free + hold restructuring, not a hard
prediction problem. (Committing any edge that lies in some min-cost matching provably preserves
global optimality → the greedy "commit free optimal pairs" is safe.)

**Honest hard/risky parts:**
- Touches the **most critical live code** (async pairing tick) → high blast radius; needs a
  simulation test harness over many drop/join/completion orderings before it goes near prod.
- **One residual knob:** a player whose only optimal partner is a SLOW incoming match. Alex: "no
  lazy compromise" → default = HOLD (wait) + host override if truly stuck; optional wait-cap.
- Drops/late-joins reshuffle the optimum mid-flight → recompute handles it, but must always respect
  already-committed/started matches (never re-pair someone already playing).
- This is a **rewrite** of the pairing engine, not a tweak (replaces eager pairPool + weak defer +
  leftover-pairing with the provisional-optimum model).

## Converged decisions — cont. (2026-07-15)

**DROP the hard one-band-up guarantee (Alex).** Redundant + harmful. The RAD Δ3 was the OLD greedy
engine, not the cost function — the new global provisional-optimum engine + progressive cost already
prevent extreme play-ups in every non-degenerate field. A HARD cap would only FORCE byes in the
pathological edge (isolated low player, no near-band partner anywhere) — which contradicts "byes are
not an option". So: rely on the SOFT progressive cost. The rare degenerate edge (play-up vs bye) is
governed by **how we cost a bye** (a knob) + host override, not a hard rule. Simpler.

**Playoff seeding — Options 1 & 3 rejected (Alex).** 1 (band dominates) both robs a strong lower-
band player from their own (winnable) division AND then buries them = double penalty. 3 (skill-model
seed) over-weights skill — the DIVISION already encodes skill; the playoff should reward tournament
PERFORMANCE, not re-apply skill. → **Option 2 (finite per-band handicap).** Alternatives to "−1 pt
per band":
- (a) **Fixed additive −H/band** — simple; con: can go negative, flat (doesn't scale with record).
- (b) **Multiplicative ×f/band** (e.g. ×0.75) — proportional discount, no negatives, a dominant
  lower run keeps weight, a weak one fades.
- (c) **H derived from real band strength:** `H ≈ cross-band win-edge × rounds`. If band N beats
  N+1 ~65 % (edge 0.15) over R=5 rounds → **H ≈ 0.75 pt/band**. Principled + concrete, ties to the
  actual band gap WITHOUT re-seeding by skill. Lean: set the number via (c), apply additively (a).
- **Handicap — must SCALE with rounds (Alex): flat −1 fades as rounds grow.** So H per band =
  **≈ 0.2 × rounds** (= −1 at 5 rounds, 2.0 at 10, 0.6 at 3), then normal tie-breakers. Implies a
  ~70 % cross-band win edge (Alex's calibration: B5 4-1 ≥ B4 5-0). Checks: 5 rounds, H=1 → B4 5-0 →
  4 beats B5 3-2 → 3; B4 5-0 → 4 ties B5 4-1 → 4 → tie-breakers. The 0.2 (% of a perfect score per
  band) is the tunable knob.
- **Seat 1 — DROP the own-band reservation (Alex's edge kills it):** if the top band has ONE player
  who went 0-5, reserving Seat 1 would head the bracket with a 0-5 over 5-0 borrowed players = absurd.
  So let the **handicapped seeding decide**; a top-band player who earned it still tops it (no
  handicap = edge), a 0-5 one doesn't (and doesn't auto-qualify). Consistent with Alex's
  anti-auto-exclude stance.
- **Playoff size = TARGET model, same UX as Auto Swiss (Alex).** Host picks TOP8 / TOP4 / TOP2;
  system auto-downgrades if too small. Thresholds (corrected — my error): **16+ → TOP8, 8+ → TOP4,
  < 8 → TOP2.** KEY INSIGHT (Alex): the size choice **implicitly decides division formation** —
  TOP8 needs 16/division → borrow aggressively → **few big mixed divisions** (undermines pure-band
  BaLi); TOP2 → minimal borrow → **many pure divisional playoffs**. So the size knob IS the
  "prestige/big-top vs many-pure-divisions" trade-off. **DECIDED (Alex): Target model** — the chosen
  size drives the borrowing to fill divisions.
- **Handicap = 0.2 × rounds per band, LOCKED (Alex).** At 3/4/5/6 rounds → H = 0.6/0.8/1.0/1.2.
  The 6-round harshness (borrowed 6-0 < top 5-1) is self-limiting and rarely bites: to actually cost
  the borrowed player a spot they'd need TOPn (=2/4/8) top-band players out-ranking them — and the
  leapfroggers are top players with the SAME or one FEWER win (~1 per band typically), so having
  2 is uncommon, 4/8 basically impossible; and a bigger playoff = more spots = easier to make it.
  So it only ever excludes a borrowed near-perfect run from a TOP2 where 2 top players went 5-1+ —
  rare + defensible. Tunable later if real data says otherwise.

## Quick-wins A — decisions (Alex 2026-07-15, dialog mode)
- **#2 timer:** on the **game tile** AND a **site-wide, always-visible prominent indicator** while a
  pick is running (persistent badge/banner, no matter where on the site you are).
- **#12 queue source:** log a **source per Open-Play match** (Queue vs Availability-DM), shown in the
  Queue-Activity tab + as a total count.
- **#19 underrated view:** **sorted list, NO threshold** — all players by (data-rating − questionnaire)
  difference, admin judges.
- **#9 Free Pick standings:** keep the **registration-time value ("Free Pick") in the STANDINGS** —
  do NOT overwrite it with the first pick. Match NODES already show the chosen faction (correct, no
  change).
- **#18 name:** unclassified → **"Unrated"** (my pick).
- Trivial (build with defaults): #7 currently-playing count, #8 DM→game-tile link, #11 map-pack-mod
  note on Open Play, #16 auto-size hides rounds/playoff, #17 Steam/never-played admin report,
  #10 opponent-drop notice in the picker.

## Change list (Alex 2026-07-15) — itemize + status
1. Node-EDIT modal is positioned INSIDE the bracket → for a big bracket (50p, embed extends
   downward) it can pop up OFF-SCREEN. Fix: viewport-centered modal (fixed, screen-center) OR
   auto-scroll to it when a node is clicked. — 🔧 UX
2. Players didn't know a Faction-Pick timer exists → show timer globally. — 🔧 UX
3. **BUG (reframed): withdraw→void survivor-decision not enforced.** When Beagle withdrew (R4 vs
   jaysix), the survivor got the NORMAL win/loss/tie report — **no "played vs void" choice, and
   could report a WIN with NO replay** for an unplayed match. Expected: the withdrawn_player_id
   GameTile decision (Yes→report+replay / No→void). Investigate why the survivor-decision UI didn't
   fire + why the replay requirement was bypassed. — 🐞 integrity, high prio. ("Better way to drop"
   itself is obsolete — dropping is fine now.)
   **ROOT CAUSE CONFIRMED:** two player report paths for a TOURNAMENT match. (1) tournament page →
   MyMatchSection → GameTile = replay + withdraw-decision (proper). (2) `/matches/<id>`
   (MatchDetailPage:685 `!isOpenPlay && canReport` → `MatchScoreModal`) = dual-submit win/loss/tie
   (`reportMatchResult`), NO replay, NO withdraw-decision. The match-announcement DM links to
   `/matches/<id>` → path (2). So any player reporting via the DM link (across all 34 tournaments)
   bypassed the replay requirement — SYSTEMIC, not a one-off. FIX: players always report via the
   GameTile on both surfaces; MatchScoreModal → host-only management (verify host uses
   overrideMatchResult, not the player dual-submit). Retires the player-facing dual-submit.
4. Late joiners produced many bye rounds; mechanically good but no sense giving "5 bye points". —
   ✅ INFO: catch-up byes already = 0 pts (verified). Overlaps #5.
5. Late joiners should start in the earliest round that still has UNRESOLVED matches. — 🆕 mechanic
6. Leaderboard for major tourney wins. — 🆕 feature — **BUILD NOW (Alex)**
7. Open Play should also show how many are CURRENTLY PLAYING (besides queue + available). — 🔧 small
8. Link in the tournament match-announcement DM straight to the game tile. — 🔧 small
9. Free Pick: after first pick, "Free Pick" in Standings is overwritten by their faction pick —
   shouldn't. — 🔧 bug
10. If a player is already in the picker when the opponent drops, they don't notice. — 🔧 (Alex:
    NO notice needed — just CLOSE the picker on opponent-drop so the player lands on the GameTile
    where the withdraw banner already shows.)
11. Map-pack-mod requirement mentioned nowhere on Open Play. — 🔧 copy
12. Queue Activity: distinguish match created by 2 players queueing vs 1 grabbing via availability
    DM (usage metric). — 🆕 small (has `MATCH` event; add source)
13. Faction matchup-favourability scores + faction "general strength" via skill model (like Meta
    heatmap); faction pages list WR-vs-faction AND favourability. — 🆕 analytics (feasible — Meta
    heatmap already models matchup favourability)
14. "General Skill" leaderboard from game data only (not questionnaire). — 🆕 analytics
15. Faction-war format: SFT where a picked faction becomes UNAVAILABLE to others. — 🆕 new format
16. Selecting Auto Size doesn't hide the swiss-rounds + playoff-format options. — 🔗 planned
    (branch `fix/balanced-hide-manual-config`, not built)
17. Report: users who have NOT done Steam verification + users fully registered & verified but who
    have NEVER played. — 🆕 admin report (2 lists)
18. "New" default band clutters the whole SITE (esp. admin stats show far too many "New"). NOT about
    tournament sign-up (that already requires the questionnaire). Fix: unclassified players show as
    a clear **"Unrated"-type label (name TBD — my pick)**, NOT a band; keep them out of the band
    stats. — 🔧 display
19. Admin view of players whose DATA-based rating is higher than their QUESTIONNAIRE-based rating
    (potentially stronger than they claimed / underrated). — 🆕 admin view
