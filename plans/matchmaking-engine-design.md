# Design note — Fair-Matchmaking Engine (NI-6, expanded)

Status: **design** (Alex chose "design doc first", 2026-08-11). Supersedes the narrow
`matchup-finder-design.md` — that note covered only the faction layer; this one covers the
whole cluster Alex described once the idea was clarified.

## What Alex actually wants (clarified 2026-08-11)

The original "50% matchup finder" turned out to be one corner of a bigger idea: **fair
matchmaking, at two levels of precision, used in three places.** Alex's words: "it should be
both — general-skill-based matchmaking AND specific matchmaking."

### The four building blocks
1. **General-skill matchmaking (coarse)** — pair two similarly-strong players, using the
   1–5 skill bands (the same bands NI-5's gate uses). Fast, faction-agnostic.
2. **Specific faction matchup (fine)** — for two given players, find the *faction pairing*
   whose predicted Chance-to-Win is ~50%, combining each player's **faction proficiency**
   (how good this player is with that faction) and the **faction-vs-faction balance**. This
   is the refinement of #1 — not just "equally strong" but "a concrete coin-flip".
3. **Challenge booking flow (process)** — a challenger marks their availability → the site
   finds skill-matched opponents → shares the challenger's time windows → the first opponent
   to **pick a concrete slot** gets the challenge, and they play. This is the UX wrapper
   around #1/#2.
4. **Faction War round optimisation (application)** — pair a whole round for maximum fairness
   **on the faction level only, regardless of who the players are** — a global optimum over
   all pairings. First round always; subsequent Swiss rounds too; elimination rounds are
   fixed so only the first matters.

## Can one engine do all of it? Mostly, yes.

The **core** is a single scoring function:

> `fairness(playerA + factionX  vs  playerB + factionY) → Chance-to-Win for A (0–1)`

Every application is that score, used differently:
- **Single challenge** — search factions (fine) or just bands (coarse) for a ~50% score.
- **Faction War round** — feed the score as edge weights into the **same Blossom max-weight
  matching we already run for Balanced Liechtenstein pairing** (`balanced-liechtenstein.ts`),
  optimising the whole round instead of one match.
- **Booking flow** — the score picks the candidate pool; availability + slot-picking is the
  process on top.

So: **one core scoring lib**, then three thin applications. The engine is shared; the
wrappers are separate features that can ship independently.

## The core score — Chance-to-Win (CtW)

Reuse what exists (this is composition, not new ML):
- **Faction proficiency** — per player, per faction: `neutralWinChance` from the proficiency
  model (`getFactionProficiency`, `logistic(...)`, the 2026-06-16 work). A player-with-faction
  vs-neutral number. **This already encodes general skill** — a strong player scores high with
  everything — which is why "general skill as a separate term" is usually double-counting.
- **Faction matchup balance** — faction X vs faction Y, player-independent.

```
CtW(A w/ X  vs  B w/ Y) = logistic( k_prof·(profA_X − profB_Y) + k_mu·muTilt(X, Y) )
```
Balanced = `|CtW − 0.5| ≤ 0.025` (the 47.5–52.5% band).

**Two precision modes fall out of the same formula:**
- **Coarse (general skill):** ignore the faction terms (or hold factions neutral) → CtW is
  driven by the players' overall proficiency → "find a similarly-strong opponent".
- **Fine (faction matchup):** vary X and Y to push CtW toward 0.5 → "find the coin-flip setup".

## Open questions to resolve before building (re-asked in plain terms)

These are the round-4 questions, reframed now that the picture is clear. I'll fill in my
recommended default; Alex confirms or changes:

1. **`muTilt` source** — **DECIDED (Alex, 2026-08-12): the model's skill-adjusted matchup
   effect (`getMatchupEffect`) — the "favourability" rating shown on the site — NOT the raw
   win-rate, and NOT Model-Strength.**
   - Model-Strength measures a faction's *absolute* strength and is worthless for balance
     (Alex's example: **Slaanesh is the strongest faction overall yet has no chance vs
     Bretonnia**). Ruled out.
   - The **raw win-rate** is also wrong: it's contaminated by *who the opponents were*. A 50%
     raw rate earned against weak opponents is really a sub-50% matchup. Alex caught this — the
     favourability of Wood Elves vs Bretonnia is ~46/54% while the raw win-rate is 50%.
   - The **favourability rating** (`logistic(getMatchupEffect)`) is the L2-fitted faction-vs-
     faction advantage with opponent strength removed — the right, "honest" balance signal. It's
     exactly what the FactionDetail page shows. `logistic(muTilt)` therefore equals that number.
   Never-played pairings (0 games, no matchup effect) are handled PER CONTEXT:
   - **Single-challenge finder: a never-played matchup is simply NOT offered** (`requireData`) —
     a challenge wants a *known* coin-flip, not a guess.
   - **Faction War: a never-played pair is treated as maximally uncertain** (max fairness cost,
     still bounded below one score step) so the optimiser prefers *known* matchups rather than a
     false 50% coin-flip. (This supersedes the earlier "Model-Strength delta at 0 games" plan,
     which belonged to the raw-win-rate design; with a skill-adjusted effect there's no separate
     strength scale to fall back to, and in practice ~all pairs have data — 273/276 in prod.)
2. **Weights `k_prof`, `k_mu`** — how much the player-skill gap vs. the faction-matchup tilt
   each move the needle. **Rec: start with proficiency dominant, calibrate against real games
   later** (same iterate-against-the-sim approach as BaLi). Not a product decision — I pick
   sane defaults and we tune.
3. **General skill as its own term?** — **Rec: no**, proficiency already carries it (see
   above). *(Alex leaned "both should exist" — reconciled: the coarse MODE is the
   general-skill matchmaking; it doesn't need a separate additive term in the fine formula.)*
4. **Default series length** — Bo3 with faction rotation was in the old note. **Only relevant
   to the single-challenge application; irrelevant to Faction War.** Alex didn't recognise it
   because it belongs to a specific slice. Park it until we build that slice.

## Build order (proposal — not started, awaiting Alex)

Smallest, highest-leverage first; each is a shippable slice:

1. **Core scoring lib** — pure `lib/matchmaking.ts`: `ctw(profA, profB, muTilt)`,
   `findBalancedFactions(A, B, opts)`, unit-tested (symmetry: CtW(A,X vs B,Y) = 1 − CtW(B,Y vs A,X)).
   No UX yet. Foundation for everything.
2. **Faction War round optimisation** (#4) — wire the score into the existing Blossom pairing
   for Faction War round 1 (+ Swiss rounds). Self-contained, reuses infrastructure, immediate
   value, no new UX surface.
3. **Single balanced-matchup challenge** (#1/#2) — the on-site "find a fair match" mode, coarse
   or fine, that pre-fills a challenge.
4. **Booking flow** (#3) — availability + slot-picking wrapper. Biggest UX piece, last.

Rationale for #2 before #3: Faction War optimisation is pure back-end reuse (no new screens),
so it ships fast and proves the engine; the booking flow is the heaviest UX and benefits from
a proven engine underneath.

## Explicitly out of scope for the first pass
- Real-time re-optimisation of a running round after a drop (round 1 is fixed once paired).
- Cross-format generalisation beyond Faction War for the global optimiser.
