# Tournament Robustness — Late Joiners & Mid-Tournament Drops (BaLi + Swiss)

**Status:** design agreed (2026-07-11), not yet implemented. Scope: **BALANCED_LIECHTENSTEIN +
SWISS / AUTO_SWISS**. Elimination is out — no late-join into a fixed bracket, and a drop resolves as
a walkover in the tree.

## Context — the two problems

BaLi pairs incrementally by round-**depth** (`planPairings` pairs only players with the same
completed-game count; `balanced-liechtenstein.ts:32`). Two ways the field changes mid-tournament
break this:

1. **Late joiners get a free-point bye flood.** A late joiner starts at depth 0, lands in the
   round-1 pool, finds no partner and no incoming (everyone is far ahead) → `pairPool` byes them,
   and the tick's cascade loop (`balanced-liechtenstein-service.ts:161`, `MAX_ITERATIONS=12`) byes
   them up round-by-round to the frontier in one tick. Each is a **scoring `BYE` (+1 pt**,
   `swiss.ts:242`). Join at round 5 → ~4 free points → can vault into the division playoffs. This is
   **emergent**, not deliberate — the explicit `createLateJoinerBye` (`tournament-utils.ts:173`) is
   Swiss/Auto-Swiss only and no-ops for BaLi.

2. **A drop strands the opponent.** The host-drop (`participants.ts:908`) only sets `WITHDREW` — it
   does **not** forfeit or void the open match. In `planPairings` the survivor's `PENDING` match vs
   the ghost marks them `activeRound` set → they are treated as "playing" → **never re-paired**.
   Stuck. (Seen live; repeats when opponents drop serially.)

Related latent bug: the `@@unique([tournament_id, round, match_number])` index (migration
`20260512152148_init:364`) has **no** `WHERE deleted_at IS NULL`, but the tick computes the next
`match_number` from **non-deleted** rows only (`balanced-liechtenstein-service.ts:202`). So
soft-**deleting** a match and re-pairing can reuse a taken `(round, match_number)` → unique
violation → tick throws. (Avoided by the void design below, which uses `CANCELLED`, not delete.)

## Decisions (locked)

| Topic | Decision |
|---|---|
| Late joiner playoff-eligible? | **Yes** — via 0-point catch-up (fair disadvantage; earns in via real wins). |
| Late joiner entry round | **Earliest active round, floored** at `frontier − 1`. |
| Late-join cutoff | **None** — a single real game beats not playing; allowed anytime in the group phase. |
| Missed rounds (below entry) | **Non-scoring catch-up placeholders** (count as a played round, 0 pts, 0 Buchholz). |
| Drop → open match | **Withdraw → Void** flow (survivor decides played vs void) — **both** BaLi and Swiss. |
| Void mechanic — **BaLi** | Set **`CANCELLED`** (row kept → no `match_number` collision; standings-neutral; `planPairings` re-pairs the survivor). |
| Void mechanic — **Swiss** | **Forfeit-win to the survivor** (+1 walkover); Swiss can't re-pair mid-round, next round batch-pairs everyone fresh. |
| Swiss late-join bye | **0-point `CATCHUP_BYE`** (was a +1 scoring bye) — no free point for late joiners in any format. |
| Voided match display | **Keep visible, clearly labelled** ("opponent withdrew → re-paired"). Survivor legitimately appears twice in the round; the voided node is dimmed + labelled. |
| Survivor-no-response fallback | **Host manual only** (no timeout auto-void). |
| "Played" branch | Normal report + replay; **finalises without loser confirmation** (matches current practice). |

## Part A — Late-Joiner entry

On late-join for a BaLi tournament (`addLateParticipant`, BaLi branch — currently only sets
`CHECKED_IN`):

1. **Assign a skill band** for the late joiner (today `assignSkillBandsForTournament` only runs at
   start). Reuse `getPlayerClassification` → `matchmakingBand`, `Math.max` with `requested_band`.
2. **Compute entry round** `A = max(earliestActiveRound, frontier − 1)` where
   `frontier = max round reached` and `earliestActiveRound = lowest round with a still-incomplete
   match among active contenders`. Clamp `1 ≤ A ≤ rounds_count`. (Floor = **1**: never more than one
   round behind the frontier.)
3. **Create `A−1` catch-up placeholders** for the late joiner (rounds `1..A−1`): a new bye-like
   row that **counts as a played round** but scores **0**.
4. **Trigger `runBalancedPairingTick`.** The late joiner is now at depth `A−1` → paired from round
   `A` onward like everyone (real games; a normal odd-out bye only if genuinely the odd one — same
   rule as any on-time player). No more dead-pool bye flood.

Result: `A−1` zero-point placeholders + real games `A..rounds_count` = `rounds_count` total →
**complete** for the playoff guard, but with a real disadvantage (0 pts for the skipped rounds).
Enough real-game points → playoff-eligible, same as anyone.

**Invariant (no free points, ever):** a late joiner never receives a *scoring* bye for a round they
weren't present to contest — every such round is a `CATCHUP_BYE` (0 pts). This also covers the
join-very-late edge: if no opponent is reachable at entry, they just complete at 0 points. Only
once they have played **≥1 real game** do ordinary odd-out byes score, exactly like an on-time
player's.

### New match state: catch-up placeholder
Add `MatchStatus.CATCHUP_BYE` (additive enum migration). Semantics:
- **`planPairings`** — add to the `ADVANCING` set (`balanced-liechtenstein.ts:46`): counts toward
  `completed` (depth + completeness), never sets `activeRound`.
- **`computeSwissStandings`** (`swiss.ts:236`) — new branch: counts as a played round for
  display, but **+0 score, no opponent pushed (0 Buchholz)**. Distinct from `BYE`/`NO_CONTEST`
  (which give +1).
- **Standings/bracket UI** — render dimmed, labelled "Catch-up (late join) · 0 pts".

## Part B — Withdraw → Void

### Trigger (on host-drop of B)
In the drop handler, after `WITHDREW`, for each of B's **open, unreported** group matches
(`PENDING`/`ONGOING`, phase `SWISS`/null, no `reportedWinnerId`) where the other player A is still
active:
- Set new field **`Match.withdrawn_player_id = B`** (additive, nullable). Drives the UI banner and
  is queryable by the host.
- Notify A: **GameTile banner** + **Discord DM** (`notifyOpponentOfWithdrawal(matchId, A)` — DM is a
  message + link to the match page; **no** interactive Discord buttons).
- If **both** players are withdrawn → set the match `CANCELLED` directly (no survivor to decide).

### Survivor decides (GameTile)
New block when `withdrawn_player_id != null`, viewer = survivor, no result yet:
"⚠ Your opponent withdrew. Was this match played?"
- **Yes → report result** — reuse the existing report + replay flow (`GameTile.tsx:370`; replay is
  the anti-abuse proof). Finalises normally (no loser-confirmation dependency).
- **No → void it** — `POST /api/matches/:id/void-dropped` (survivor **or** `canManage`):
  set **`status = CANCELLED`** → call `runBalancedPairingTick`. The survivor drops back into the
  round-R pool and is re-paired with a real opponent (or a normal bye if none). `CANCELLED` scores
  nothing (`swiss.ts:236`) and is ignored by `planPairings` (`balanced-liechtenstein.ts:251`); the
  row stays, so its `match_number` still counts → **no collision**.

### Display
The `CANCELLED` void node stays visible, **dimmed + labelled** ("Opponent withdrew → re-paired").
The survivor appears twice in round R by design (voided node + live node). `MatchNode.tsx:105`
already styles `CANCELLED` dimmed; add the label. Keep it distinct from double-drop `CANCELLED`.

### Fallback
**Host only.** If the survivor never decides, the match stays `PENDING` and blocks the playoff
guard; the host resolves it via the existing admin match controls (void → CANCELLED + re-pair, or
forfeit). No timeout auto-resolve.

## Part C — Swiss / Auto-Swiss (and Elimination)

Swiss pairs a whole round as a batch (`generateSwissRound`); withdrawn players are simply excluded
from the next round. There is **no** mid-round re-pairing, and a drop's open match blocks
`next-round` until it is terminal (`bracket.ts:659`). So the **survivor is never stranded forever**
(unlike BaLi) — only the round-advance is blocked until the match is resolved.

- **Drop → same notify + decide UX** as BaLi (banner + DM; A chooses played vs not):
  - **Played** → normal report + replay → `COMPLETED`.
  - **Not played** → **forfeit the match to A** (walkover; reuse `POST /api/matches/:id/forfeit`
    with `droppedPlayerId = B` → A wins, +1). The round can then advance; next round batch-pairs A
    fresh. (Chosen over the bye-pair idea — that is fragile: the round's bye goes to the lowest
    scorer, the player most likely already gone, which would just strand A again.)
- **Late-join** → keep the existing single **current-round** bye (`createLateJoinerBye`), but emit a
  **`CATCHUP_BYE` (0 pts)** instead of a scoring `BYE`. The late joiner then batch-pairs normally
  from the next round; they simply have fewer games (Swiss standings already tolerate that).
- **Fallback / both-drop:** host manual; both-drop → `CANCELLED`, as in BaLi.

**Elimination:** out of scope — no late-join into a fixed bracket; a drop is a walkover handled by
the bracket tree.

### Cross-cutting: `CATCHUP_BYE` must count as terminal *everywhere*
The new status has to be added to **every** "terminal / advancing / round-complete" set, or it will
read as an unfinished match and block progress:
- `planPairings` ADVANCING set (`balanced-liechtenstein.ts:46`),
- `computeSwissStandings` terminal filter (`swiss.ts:236`) — included, but scores **0**,
- Swiss `next-round` completeness check (`bracket.ts:656`),
- Round-Robin completeness check (`bracket.ts:855`) and the start-playoffs guards.

## Shared plumbing / files to touch

- **schema.prisma + migration** (additive, prod-safe): `MatchStatus.CATCHUP_BYE`;
  `Match.withdrawn_player_id String?`.
- **Backend:** `balanced-liechtenstein.ts` (ADVANCING set incl. `CATCHUP_BYE`), `swiss.ts`
  (`CATCHUP_BYE` = 0-pt terminal branch), `balanced-liechtenstein-service.ts` (late-join placeholder
  creation + band assign; BaLi void helper), `tournament-utils.ts` `createLateJoinerBye`
  (Swiss → emit `CATCHUP_BYE` instead of `BYE`), `participants.ts` drop handler (mark + notify, both
  formats), `matches.ts` (`POST /:id/void-dropped` — branches: BaLi `CANCELLED`+tick, Swiss
  `FORFEIT` to survivor), `bracket.ts` (add `CATCHUP_BYE` to `next-round`/RR completeness checks;
  expose `withdrawnPlayerId`), `discord-notify.ts` (`notifyOpponentOfWithdrawal`).
- **Frontend:** `GameTile.tsx` (opponent-withdrew banner + Report/Void actions), `MatchNode.tsx`
  (label CANCELLED-void + render CATCHUP_BYE), Swiss standings (CATCHUP_BYE row, 0 pts),
  `api.ts` (`voidDroppedMatch`, `withdrawnPlayerId` in the match/game DTO), bracket DTO
  (`bracket.ts`) to expose `withdrawnPlayerId`.

## Edge cases & guardrails

- **No round-based cutoff** (Alex): a single real game beats not playing; late-join is allowed
  anytime in the group phase. A join so late that no opponent is reachable → the un-contested
  round(s) are `CATCHUP_BYE` (0 pts), so the player completes at 0 points and never gets a free
  scoring bye. Late-join only applies before playoffs exist (no group left to join afterwards).
- **Serial drops:** each void re-pairs; labelled `CANCELLED` rows accumulate (visible, dimmed) — OK.
- **Result already reported before the drop** (`AWAITING_CONFIRMATION`/reported): leave it; it
  resolves normally.
- **Both drop:** `CANCELLED`, no re-pair.
- **Playoff phase:** the void/late-join flows apply to the **group** phase only.

## Verification

- **Unit:** `planPairings` with a late joiner + placeholders (correct depth, `complete` true);
  `computeSwissStandings` — `CATCHUP_BYE` scores 0, no Buchholz; void=`CANCELLED` → re-pair at the
  same round; no `match_number` collision.
- **Flow test (`balanced-liechtenstein-flow.test.ts` style):** late join mid-tournament →
  placeholders + real games, completes, **zero free points**; drop → survivor banner → void →
  re-pair, labelled cancelled node, no double scoring.
- **Manual:** feature worktree on 5175 — late join at various frontiers (floor behaviour), drop an
  opponent, walk both survivor branches (played vs void), confirm playoffs auto-start afterwards.
- **Swiss:** late join → `CATCHUP_BYE` (0 pts), then normal batch pairing; drop → survivor
  notify+decide → forfeit-win path → `next-round` advances; `CATCHUP_BYE` never blocks round-advance.
