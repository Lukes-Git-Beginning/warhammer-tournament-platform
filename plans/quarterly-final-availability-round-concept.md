# Concept — Availability round for the Quarterly Finals

Status: **CONCEPT (not built).** The Monthly Ladder Invitational availability/RSVP flow is built
(2026-09-30). This doc describes how to extend it to the Quarterly Finals and the decisions that
differ. Companion to [[design-competitive-finals-locked]].

## What already carries over for free

The invite/RSVP/seed engine was written kind-agnostic, so the QUARTERLY path is mostly wired already:

- `computeFullRanking(kind='QUARTERLY', …)` (`lib/competitive-finals.ts`) returns the full qualified
  ranking from the per-battle-type GS board (`board.filter(battleTypeGames >= gate)`), captain-resolved
  for 2v2. Seeding is by **per-battle-type GS** (the robust, non-gameable value), exactly as the locked
  design requires.
- `openAvailabilityRound`, `setInviteRsvp`, `seedFromConfirmed`, `computeFieldView` all branch on `kind`
  and already handle QUARTERLY (incl. 2v2 via `competitor_id`=team, `user_id`=captain).
- The routes (`/open-availability`, `/rsvp`, `/seed`, `/field`) and the `ChampionshipFieldPanel`
  frontend are kind-agnostic → a Quarterly Final tournament page would render the same live-preview →
  availability-round → seeded phases with the same admin + RSVP controls.
- `notifyAvailabilityInvites` differentiates "you'd currently make the cut" vs "seed pool" by
  `rank <= fieldSize`, which is correct for both kinds.

So the Quarterly path is ~80% there. The remaining work is the quarterly-specific policy below.

## Decision 1 — the hard Top-16 floor vs. the availability shrink (KEY)

The ladder has **no floor**: if only 5 of a planned Top 8 confirm, it shrinks to Top 4
(`confirmedFieldSize`). The Quarterly Final has a **hard Top-16 floor** (needs ≥64 active AND ≥32
qualified, else no final — Alex 2026-09-15). These two rules collide once RSVPs come in: what if the
final is validly offered (≥32 qualified) but fewer than 16 confirm availability?

Options:
- **(A) Cancel** — strictly honour the floor; if <16 confirm, no final. Punishes the confirmers.
- **(B) Shrink like the ladder** — Top 16 → Top 8 → … Contradicts the "hard floor / no Top-8 fallback".
- **(C, recommended) Floor gates EXISTENCE, shrink governs turnout.** The Top-16 floor decides whether
  the final is *offered/opened* at all (unchanged: ≥64 active & ≥32 qualified to create + open the
  round). Once opened, if turnout falls short, shrink to the next power of two down to a **hard minimum
  (e.g. Top 8)**; below that, cancel. Rationale: the floor's job is "don't run a thin major"; but once
  32 qualified and the round is live, a no-show cascade shouldn't nuke the event — the committed
  players deserve a final.

**DECIDED (Alex 2026-09-30): (A) strict cancel.** The Top-16 floor holds on the RSVP side too — no
Top-8 fallback. The floor gates whether the final is offered at all (≥64 active & ≥32 qualified, as
now); once opened, if fewer than 16 confirm availability, the final is **cancelled**, not shrunk below
16. A larger community field (Top 32/64) may still shrink DOWN TO the Top-16 floor if turnout is thin,
but never below.
Implementation: a `kind`-aware confirmed-field-size for QUARTERLY:
`s = min(plannedN, largestPow2AtMost(available)); return s >= 16 ? s : 0` (0 → seed 422s / the admin
cancels the final). The ladder keeps the current floor-less `confirmedFieldSize`.

## Decision 2 — up to 6 finals per cycle (battle_type × format)

A quarter can spawn up to 6 finals (Domination/Conquest/Siege × 1v1/2v2), but only where activity
clears the floor (Q4 likely Domination-1v1 only). Each is its **own tagged tournament** with its own
availability round — the admin opens/seeds each independently from its own leaderboard tile / detail
page. No change needed to the engine (each keys on its tournament id), only operational: the admin runs
the two-click flow per final. The leaderboard tile should surface an **"Open availability round"**
action per battle-type (today the tile only has "Seed from Qualifier"); simplest is to drive it from the
tournament detail `ChampionshipFieldPanel` (already built) rather than the tile.

## Decision 3 — 2v2 RSVP semantics

**DECIDED (Alex 2026-09-30): captain-only.** For a 2v2 final the invite's `user_id` is the **captain**
(set by `computeFullRanking`/`captainMap`), so `/rsvp` already accepts only the captain's confirm/decline
and the seed writes the team participant via `writeSeededField` (`participant_type=TEAM`). **No code
change needed** — the captain is the registrant/actor everywhere else, and this is how it already works.

## Decision 4 — Siege finals are points-based, not a bracket

Per the locked design, Siege finals are **Bo2, points-based (Swiss/BaLi), playoff NONE** — not
single-elim. The availability round is identical (invite → confirm → seed the field); only the seeded
tournament's format differs (Swiss/BaLi group instead of an elim bracket). `writeSeededField` writes
CHECKED_IN participants with seeds regardless, and the Swiss/BaLi engine seeds from participants, so
this works as-is. One nuance: `plannedFieldSize`/`confirmedFieldSize` return powers of two; a Swiss
group needn't be pow2, but keeping pow2 is harmless. No change required for v1; note it.

## Decision 5 — no raffle; prize framing

The Monthly Ladder Invitational has a raffle among invitees; the Quarterly Final does **not** (skill
decides). The `/raffle` route already guards `kind === 'MONTHLY_LADDER'`. The invite DM copy for
quarterly should not mention a raffle. `notifyAvailabilityInvites` is generic; if per-kind copy is
wanted (e.g. quarterly emphasises "Top 16 major"), add a `kind` branch to the DM text. Minor.

## Timing

Same as the ladder: the quarter closes (board frozen — the window is closed so the ranking is
deterministic), admin opens the availability round with the standard 24h soft-invite to **all
qualified**, then seeds from the confirmed. The `?deadlineHours=` override already exists if a longer
window is wanted for a major.

## Concrete change list (when built)

1. Confirmed-field-size → `kind`-aware: QUARTERLY uses the strict Top-16 floor (`min(N, pow2≤available)`,
   0 below 16 = cancel); the ladder keeps the floor-less `confirmedFieldSize`. Add unit tests.
   (Superseded/expanded by the "Remaining before quarterly can ship" list below — see it for the full,
   current set incl. the kind-aware invite pool: quarterly invites ALL qualified, NOT 2N-capped.)
2. `seedFromConfirmed` already computes `plannedSize` via `plannedFieldSize(kind, …)` — for QUARTERLY it
   uses `quarterlyFinalSize`, which needs `active` (not just the qualified pool size). Pass the true
   `active` count through (openAvailabilityRound/seedFromConfirmed currently derive plannedSize from the
   invite count = qualified pool; for quarterly the size formula also needs `active`). **This is the one
   real backend gap:** thread `active` into the quarterly planned size (store it at round-open, e.g. on
   the tournament or recompute), so the Top-16/32 tiering is correct.
3. Leaderboard tile: add the "Open availability round" affordance for quarterly (or rely on the detail
   panel).
4. Optional per-kind invite DM copy.
5. Tests: quarterly floor/shrink, 2v2 captain RSVP, a Siege points-final seed.

## Resolved (Alex 2026-09-30)

- Decision 1 → **strict cancel** at the Top-16 floor (no Top-8 fallback).
- Decision 3 → **captain-only** RSVP (already how it works, no code change).
- Invite pool → **kind-aware**: ladder = 2× the field (`invitePoolSize`, gateless so it needs a cap;
  shipped v2.9.1). **Quarterly = ALL qualified** (Alex 2026-09-30): the 90-game gate already bounds the
  pool (~27-40, never hundreds) and clearing it earns the seed-pool spot, so NO 2N cap for quarterly —
  if 40 clear the gate for a Top 16, all 40 are invited (not 32).
- Round trigger → **admin two-click** (no cron), same as the ladder.

## Remaining before quarterly can ship (all backend, small)

1. `kind`-aware confirmed-field-size with the strict Top-16 floor (Decision 1): quarterly =
   `min(N, pow2≤available)`, 0 below 16 (cancel); ladder keeps the floor-less version.
2. Thread the true `active` count into `quarterlyFinalSize` (the one real gap — currently the qualified
   count is passed as `active`, which mis-tiers Top-16/32 and would even return 0).
3. **Kind-aware invite pool** in `openAvailabilityRound`: ladder slices to `invitePoolSize(fieldSize)`;
   **quarterly invites the full (gated) ranking — no cap** (Alex 2026-09-30).
4. Unit tests: quarterly floor (cancel < 16), `active`-tiering, quarterly-invites-all; plus a Siege
   points-final seed.
5. (Optional) per-kind invite DM copy (quarterly = "Top-N major", no raffle mention).
