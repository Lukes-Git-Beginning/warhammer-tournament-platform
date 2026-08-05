# 1v3 Mode — "Set Faction vs. One of Three Counterpicks"

Status: **DEPLOYED & LIVE 2026-07-12** — merged to prod `main ef57346` (bundle
`index-Cia0jE_x.js`, rizzotto.gg 200), together with the BaLi batch ("beide zusammen").
Built on `feat/1v3-mode` (a7436a2 + BO2 c1b64f4 + leaderboard-revert 9b2823d).
**Leaderboard note:** the BO2 commit briefly touched the match-based all-time
`LeaderboardEntry` draw scoring — Alex vetoed touching the leaderboard, so it was
REVERTED (`9b2823d`). BO2 1-1 = 0.5 Swiss points each (standings only); the season
leaderboard is game-based and matches don't touch it. Author session: 2026-07-11/12.

## ✅ BUILD STATUS (2026-07-12)

Full vertical is built and **all 7 workspaces typecheck green**. CI runs on the
pushed branch (fresh DB) as the real validator — local Postgres was down (Docker
off) so nothing could be run/clicked locally this session.

**Done:** schema + additive migration (`20260712100000`), backend (coin-flip role
init, offer/select endpoints, finalize resolution, create/patch validation, elim
BO3 default), frontend (create+edit set-faction selector, `OneVThreePhase`
decision UI, mode labels, standings faction column), integration test
`apps/backend/test/one-v-three.test.ts`.

**To run/click locally** (when back at a machine with Docker up): `pnpm docker:up`,
then the migration applies via `pnpm db:migrate:deploy` on a fresh DB — OR, against
the existing grown local DB (which must NOT be reset), apply the additive DDL by
hand (it is prod-safe, identical to the migration):
```sql
ALTER TYPE "TournamentMode" ADD VALUE IF NOT EXISTS 'ONE_V_THREE';
ALTER TABLE "Tournament" ADD COLUMN IF NOT EXISTS "set_faction_id" TEXT;
```
Then `pnpm db:generate`, run the worktree dev servers, create a 1v3 tournament,
set the set faction, and click through a match's decision flow.

**BO2 two-leg home/away — BUILT** (commit `c1b64f4`, 2026-07-12): new `BO2`
MatchFormat (additive migration `20260712110000`); `finalizeGameResult` caps an
even series and resolves **1–1 → Draw** (`winner_id` null → Swiss standings score
it 0.5 each via the existing draw path; `completeMatch` leaderboard now scores a
null-winner match as a draw, 1 pt each — also fixes a pre-existing open-play draw
miscount). 1v3 **Swiss defaults to BO2**, elimination to BO3 (a bracket needs a
decisive winner). Replay upload is already required per game. Frontend: BO2 option
in the Swiss/group format selectors; picking 1v3 auto-sets BO2/BO3. Test
`bo2-series.test.ts`.

**Still deferred (confirm with Alex):** host re-flip / manual coin-flip affordance;
see §12.

---

## ★ IMPLEMENTATION — LOCKED ARCHITECTURE (supersedes §7–§10 below)

**Key reuse discovery:** the existing **FREE_PICK "mixed matchup"** flow is
already the 1v3 mechanic. `POST /free-pick/offer` (pick-later offers 3) +
`POST /free-pick/select` (fixed player chooses 1), stored in **`MatchFactionMatrix`**
(fixed side = `[their faction]`, other side = the 3), resolved via `picked_cell`
in `finalizeGameResult`. Socket event `match.matrix.update` already carries it.
→ **1v3 reuses `MatchFactionMatrix` + `match.matrix.update` — NO new table, NO new
socket event.** Differences to encode:

1. **Set faction from host setup** (`Tournament.set_faction_id`), not registration.
2. **Runner/Picker per coin flip per game**, stored as
   `MatchFactionMatrix.top_player_id` (**Runner** = plays set faction) /
   `bottom_player_id` (**Picker** = offers 3). Role rule §5: game N odd → fresh
   crypto flip; N even → swap of game N-1's runner.
3. **No mirror:** the Picker's 3 must exclude the set faction (+ distinct + allow-list).
4. Series: reuse existing `MatchFormat` (BO1/BO3/BO5). See "Series decision" below.

**Coin-flip init (idempotent):** helper `ensureOneVThreeDecision(prisma, matchId)`
— for the active game (latest with a `map_decision`), if no `faction_matrix` row
exists, create one with `top_player_id`=Runner (coin flip w/ odd-even swap vs prior
game), `bottom_player_id`=Picker, Runner's factions side = `[set_faction_id]`,
Picker's side = `[]`, `first_locked_at`=null (not revealed yet). Call it from
GET `/decision` (like TWO_D_THREE materializes games on read) AND defensively at
the top of the offer endpoint. Both players then see roles before the offer.

**Endpoints (copy free-pick/offer + free-pick/select, adapt):**
- `POST /api/matches/:id/one-v-three/offer` — actor must be `bottom_player_id`
  (Picker). Body `{ factions: string[3] }`. Validate: 3 distinct, allow-list,
  **none == set_faction_id**. Write Picker's side + `revealed_at`. Emit.
- `POST /api/matches/:id/one-v-three/select` — actor must be `top_player_id`
  (Runner). Body `{ factionId }`. Must be one of the 3 offered. Set `picked_cell`
  + `decided_at`, write resolved factions onto MatchGame (Runner=set faction,
  Picker=chosen). Emit.
  *(Guard both: `tournament.mode === 'ONE_V_THREE'` else 422.)*

**finalizeGameResult** (`lib/match-games.ts` ~line 189): add
`else if (mode === 'ONE_V_THREE')` — resolve via `picked_cell` exactly like the
FREE_PICK branch, but the fixed side = `set_faction_id` (not a registration
faction), keyed by which side is `top_player_id`.

**GET /decision** (`match-decision.ts` ~370): expose an `oneVThree` block
`{ setFactionId, runnerPlayerId }` (from `top_player_id` + tournament setting) so
the client renders roles. Extend the game select to include `id` + `game_number`.

**Series decision (BUILT):** the faction mechanic works on ANY format.
- **Swiss/BaLi default → BO2** (two-leg home/away): exactly 2 games, coin-flip
  roles swap between legs (odd=flip/even=swap), **1–1 = Draw**. `finalizeGameResult`
  caps the even series and completes with `winner_id` null on a tie; standings +
  leaderboard score it as a draw. Host may override.
- **Elimination default → BO3** (flip/swap/flip; a bracket needs a decisive winner,
  so no draw there).

**Faction masking / standings:** add `ONE_V_THREE` to participants faction-mask
(`participants.ts` ~813) and to `SwissStandings.tsx` `FACTION_MODES` (line 62).

**Frontend decision UI:** new `OneVThreePhase` (copy `FreePickMiniPhase`), reading
`decision.oneVThree.runnerPlayerId` + `setFactionId` instead of registration
`freePick`. Add `'one_v_three'` to `DecisionPhase` + `resolvePhase` (mode
ONE_V_THREE → `one_v_three` once map picked & not decided). Socket handler reuses
the existing `match.matrix.update` merge.

**Mode label/enum sites to extend:** api.ts unions (Tournament.mode l.64,
TournamentCreate l.177, Patch l.224), TournamentCreateForm (zod l.21, option l.449,
hint l.457, +set-faction selector), TournamentEditPage (l.82, l.769),
TournamentCard l.39, TournamentsListing l.29, ActiveMustersSection l.28,
TournamentDetail l.675; backend tournaments.ts Create l.130 + Patch l.193; admin.ts
l.48 (optional).

---


A new per-match faction-selection **mode** (sibling of SFT / BPT / MATRIX / 2D3 /
FREE_PICK / RANDOM_NO_REPEAT). It does **not** change the tournament *format*
(Swiss / BaLi / Elimination) — it only changes how each game's two factions are
decided.

---

## 1. Naming (locked)

- **Dropdown option label:** `1v3 — Set Faction vs. One of Three Counterpicks`
- **Explanation line (grey, under the dropdown):**
  > A coin flip sets roles each match: one player runs the host's set faction,
  > the other brings three, and the set-faction player picks which of the three
  > their opponent plays.
- **Internal enum value:** `ONE_V_THREE`
- Reserve the word **"Gauntlet"** for a *future tournament format* (one top player
  vs. a gauntlet of lesser players) — do NOT bake "Gauntlet" into this mode's
  enum, labels, or table names.

---

## 2. Player-facing rules (one game)

1. A **coin flip** assigns the two roles:
   - **Runner** — plays the tournament's fixed **set faction** (host-chosen).
   - **Picker** — brings **three** factions.
2. The **Picker** offers **3 distinct factions** (subject to the allow-list, and
   never the set faction — see §6).
3. The **Runner** chooses **1 of those 3** — that is the faction the **Picker**
   must play.
4. Normal map decision, play, report.

Net: the Runner is locked into the set faction but gets to steer *which* of the
opponent's three counters actually shows up. The Picker controls the menu, the
Runner controls the pick.

---

## 3. Setup (tournament creation)

- When `mode = ONE_V_THREE`, the host must choose exactly **one set faction**
  (`gauntlet_faction_id` on Tournament — "gauntlet" only as an internal field
  name is acceptable, but prefer `set_faction_id`; final name decided in build).
- The existing **faction allow-list** still applies to the Picker's three.
- **Validation at setup:** `(allow-list ∪ full roster) \ {set faction}` must
  contain **≥ 3** factions, else the mode cannot run — block creation with a
  clear message.

---

## 4. Per-game decision state machine

Reuse the same shape as MATRIX/BPT decisions (per **game**, not per match):

```
PENDING_COIN_FLIP        → server crypto-RNG assigns runner/picker (auto on game activation)
  → PENDING_PICKER_OFFER  → Picker submits 3 distinct allowed factions (≠ set faction)
  → PENDING_RUNNER_CHOICE → Runner picks 1 of the 3 → that becomes the Picker's faction
  → (existing map decision) → play → report
```

- Coin flip is **server-side crypto RNG**, auto-run when the game becomes active;
  result is shown to both players (no manual trigger needed). *(Deferred: host
  re-flip affordance — see §12.)*
- The Runner's faction is always the fixed set faction; only the Picker's faction
  is resolved by the offer+choice.

---

## 5. Fairness — legs / best-of / role rule

The set-faction side has a structural (dis)advantage, so roles must alternate.

**Single role rule for every game in a series:**
- **Odd game number** (1, 3, …) → **fresh coin flip**.
- **Even game number** (2, 4, …) → **swap** the immediately-preceding game's roles.

Applied per format:

| Format               | Default series | Roles                                  | Tie result |
|----------------------|----------------|----------------------------------------|------------|
| Swiss / AutoSwiss / BaLi | **2 legs (home & away)** | g1 = coin flip, g2 = swap        | 1–1 → **Draw** in standings |
| Single/Double Elim   | **BO3**        | g1 = flip, g2 = swap, g3 = fresh flip   | series wins as usual |

- Host may **override** the series length (e.g. force BO1 or BO5). Defaults above.
- Elimination BO3's decider (g3) uses a **fresh** coin flip → decider is not
  role-locked to either player.

---

## 6. Constraints & validation (Picker's three)

- Exactly **3**, **distinct**.
- Each within the **allow-list** (if the tournament sets one), else full roster.
- **None equal to the set faction** → forbids the mirror (Runner is already on
  the set faction; offering it would let the Runner mirror-pick).
- Server re-validates on submit (never trust client). Reject with the standard
  error shape.

---

## 7. Data model (schema changes)

- `FactionMode`/`mode` enum: **add `ONE_V_THREE`**.
- `Tournament`: **add `set_faction_id String? @db.Uuid`** (nullable; required by
  route validation only when `mode = ONE_V_THREE`). FK → Faction.
- Per-game decision state — **new table** (mirror MatchFactionMatrix's shape),
  proposed `MatchGauntletPick` *(name TBD; "1v3" not enum-legal as identifier
  prefix — use `OneVThree` in code, table `MatchOneVThreeDecision`)*:
  - `match_game_id` (FK, unique per game)
  - `runner_player_id` (coin-flip result)
  - `offered_faction_ids Uuid[]` (the 3)
  - `chosen_faction_id` (the Runner's pick → Picker's faction)
  - `step` enum mirroring §4, timestamps
- Resolved factions still land on **MatchGame** (`player1_faction_id` /
  `player2_faction_id`) like every other mode, so standings/stats are unchanged.

Migration is **additive** (new enum value + nullable column + new table) →
prod-safe, no backfill.

---

## 8. Backend surface (to fill after architecture map)

- Extend every `mode` switch/branch (grep the enum values) to handle
  `ONE_V_THREE`.
- New decision endpoints under `apps/backend/src/routes/` mirroring the MATRIX
  endpoints: coin-flip (auto), `POST offer` (3), `POST choose` (1).
- Series/leg creation: Swiss path creates 2 legs; Elim path creates BO3 — hook
  into wherever best-of / multi-game matches are created.
- Setup validation (route schema): require `set_faction_id`, enforce §3 & §6.
- Socket events for realtime decision updates (mirror MATRIX events).

## 9. Frontend surface (to fill after architecture map)

- Create form: new dropdown option + conditional **set-faction selector** +
  ≥3-available validation.
- New `MatchOneVThree` decision component (mirror MatchFactionMatrix):
  coin-flip reveal → Picker's 3-select → Runner's 1-pick → map decision.
- Bracket / standings: no change (resolved factions display as today).

## 10. Shared types (packages/types)

- Add `ONE_V_THREE` to the mode enum + labels.
- Zod schemas for the offer (3 ids) and choice (1 id); socket event payloads.

---

## 11. Build checklist (ordered)

1. [x] schema.prisma: `ONE_V_THREE` enum + `set_faction_id` (NO new table — reused `MatchFactionMatrix`)
2. [x] migration (additive) — `20260712100000_add_one_v_three_mode`
3. [x] types/labels — reused `match.matrix.update` (no new socket event); mode unions + label maps updated
4. [x] backend: create/patch validation + coin-flip init + offer/select endpoints + finalize resolution
5. [x] frontend: create+edit set-faction selector; `OneVThreePhase` decision component; standings column
6. [x] test: `one-v-three.test.ts` (offer/select: mirror, distinct, role guards, resolution)
7. [x] typecheck (7/7 green) — [~] lint + local smoke pending (local DB down; CI validates on push)

## 12. Deferred decisions (do NOT block build; confirm with Alex later)

- Host **re-flip** / manual coin-flip override affordance? (default: auto only)
- Swiss **1–1 leg draw** → confirm it maps to the existing Draw handling (0.5/0.5
  or your Swiss draw semantics).
- Should the **coin flip persist across legs** or re-flip each leg? (current rule:
  odd=flip/even=swap → leg 2 is a swap of leg 1, so effectively one flip per
  2-leg series; BO3 g3 re-flips.)
- Field naming `set_faction_id` vs `gauntlet_faction_id` (chose `set_faction_id`).
- Whether an **allow-list is mandatory** for this mode or the full roster is fine
  as the pool (default: full roster allowed, allow-list optional).
