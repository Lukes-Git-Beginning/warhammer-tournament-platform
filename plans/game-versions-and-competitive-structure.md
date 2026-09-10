# Design: Game Versions, New Modes & Competitive Structure

> **Status:** From strategy session 2026-09-08/09. Living document — core decisions locked; open forks marked ❓, tunable parameters 🎚️ (calibrate on real data). Design, not yet a line-by-line implementation plan. Scope = everything in one piece, targeting the 2026-09-24 DLC (§7).
>
> **Trigger:** The **Lords of the End Times** DLC on 2026-09-24 shifts the meta hard → pre/post-DLC game data must not be mixed. Concretely: current game **version 8.1** → the DLC is **version 9.0** (the first manual cut). Plus the finished Ko-Fi fundraiser commits us to 2v2, Siege & Conquest.

## 1. Core reframe: "Versions" instead of "Seasons"

Decouple two things Turin's model wrongly fuses:
- **Data integrity** — *"when is game data comparable?"* → bound to the **game** (a balance change starts a new version). Objective, not arbitrary.
- **Competitive narrative** — *"when do we crown champions?"* → bound to **time** (quarterly finals). Predictable, independent of patch cadence.

**Key finding:** the existing `Season` model is already a pure data-boundary (matches, faction-stats, heatmaps, leaderboard points hang off `season_id`; a season switch resets nothing and forces no event). It even has an unused `dlc_tag` field + `major_tournament_id`. So this is largely a **rename `Season → GameVersion` + a changed trigger rule + one real algorithm change**, not a rewrite.

**Decisions:**
- Rename concept to **Game Version**; `dlc_tag` becomes the meaningful identifier (e.g. `8.1` now → `9.0` "Lords of the End Times" at the DLC — the first manual cut).
- A new version is **called manually** by an admin (transparent, communicated — not arbitrary like Turin). ✅
- Consolidate the ~24 scattered `season.findFirst({ is_active })` lookups into one helper `getActiveGameVersion()`.

## 2. What binds to a Version vs. stays timeless

| Data product | Version-bound? | Rationale |
|---|---|---|
| Faction win-rates, pick/ban, matchup heatmap | ✅ yes — keyed `version × battle_type` | a patch makes numbers incomparable; and balance genuinely differs per battle type (§5) |
| Competition boards (quarterly quali GS, monthly ladder points) | ⏱️ **time-boxed** (quarter / month), reset per cycle | a *third* axis — competition windows ≠ version data-epochs; see §6 |
| **Player skill / matchmaking (GS)** | ❌ **timeless** | a strong player stays strong after a patch; GS already factors matchup-favourability out |
| Major titles / lifetime fame | ❌ no (lifetime) | a won major never loses value; already season-agnostic today |
| Questionnaire skill-floor | ❌ no (global) | Steam hours / experience don't change with a patch |

**One real algorithm change:** today the rating model is strictly season-scoped (a version cut would reset everyone to "unclassified"). The **player parameters (GS + Faction Proficiency) must be split from the matchup-fit** so they accumulate across versions (timeless), while only the **`MatchupEffect` cuts per version** (that's the sole meta-dependent part). No recency on the player side — see §3.

## 3. Player skill: timeless GS + history + activity

**One global GS per player** (timeless, across versions) **+ per-battle-type offsets** (§5). The views below rank on the **global** GS by default; a battle-type filter switches to the per-type value (global + offset). Still one hierarchical fit, not multiple ratings. GS is relative to the field, so it even moves while a player is inactive (others improve → your GS drifts down). ✅

**NO recency on player skill** (corrected — an earlier draft wrongly proposed GS recency). Player parameters — **GS** (faction-blind general skill) and **Faction Proficiency** (PFS: how well a player plays a faction) — are **timeless; skill doesn't fade**. Only **Matchup-Favourability** (the faction-vs-faction balance, the `MatchupEffect`) is version-dependent (recency in the *version* sense, not calendar time). So GS stays deliberately inert — that's *correct* for a base-skill measure; it must not swing on a bad streak. (Edge case: a big faction rework can briefly dent that faction's proficiency — you relearn it.)

### The fit — one hierarchical model, shared player params, per-version meta
The rating model is an L2-regularised logistic regression (`lib/rating-model.ts`). For a game A (faction X) vs B (faction Y):

    advantage(A) = SkillA − SkillB + MatchupEffect(X, Y);   p(A wins) = logistic(advantage)   (+1 ≈ 73%, +2 ≈ 88%)
    SkillA = GS_A + BattleTypeOffset(A, type) + FactionOffset(A, X)

One fit estimates everything jointly. The **battle-type offset is new** — same shape as the existing GS + faction-offset, so one fit yields the global GS *and* "GS in Siege" (= GS + Siege-offset).

- **L2 regularisation** (`λ·θ²`) does two jobs: it makes the fit identifiable (only *differences* matter otherwise) and it shrinks thin cells toward the mean (2 games ≠ champion). `λ` is small for GS (well-evidenced, floats freely), large for the offsets (move off 0 only with proof). This shrinkage IS the **"activity counts for free"** mechanism — few games → pulled to the mean → won't rank top; no artificial activity bonus needed.
- **The version split (the one real algorithm change):** today the fit is season-scoped (a version cut would reset everyone). Instead — **ONE fit over ALL games of all versions**, with **player params (GS, battle-type-offset, faction-offset) SHARED across versions** (timeless, accumulating) and only the **`MatchupEffect` getting its own parameter set per `version × battle_type`** (the sole meta-dependent part). A fresh 9.0 has near-neutral balance (regularised → 0) while player skills stay stable.
- **Inertia is correct:** SE = 1/√(games + reg) → many games = tiny SE = the GS barely moves on a few losses. Right for a base-skill measure; "forever #1" only holds for the *lifetime* board (earned). The competition stays live via three things that never distort the GS itself: GS is relative to the active field (others rising sinks yours); the activity window drops an inactive player from the *listing* (GS retained); the quarterly-GS quali is a separate fit that ignores lifetime fame.
- **Three boards = three data windows of one model:** timeless GS (fit on ALL games → cached, invalidated per new confirmed game, NOT window-capped — optimise later only if it ever gets slow) · quarterly GS (SEPARATE fit on this quarter only → current form) · ladder (monthly points, no fit → activity).

**GS board filters — battle-type YES, version NO.** version is a meta axis (§4), not a skill axis, so "GS in version X" is meaningless (no version dropdown). But battle-type IS a real *timeless* skill dimension (a player genuinely differs at Siege vs Domination), so the GS board gets a **battle-type dropdown** (global / per-type = global + offset). Two views on the one timeless GS:
- **Active skill leaderboard (fame):** the timeless GS = "who's strongest, period". Sorted purely by GS (games only a tiebreaker, 20-game floor; no volume bonus, newcomers rank immediately). Needs a **sliding activity window** ("≥ X games in the last Y days") so an inactive player drops from the *listing* — GS never fades, so this is the ONLY thing that removes a "Danican who never plays again" (his GS is retained + still snapshotted; he reappears when he plays). 🎚️ window size; Alex leans HIGH — 1 game/day ≈ 1 tournament/week is too low for elite status (a game ≠ a tournament) — tighten as the community grows. (Data 2026-09-08: of the top-10, only 3 sustain ≥1 game/day.)
- **Hall of Fame:** players with **≥250 games**, ranked by their **stable lifetime GS (no decay), listed forever** once earned. NOT a peak/high-water-mark (no snapshots needed). Transition while the community is young: rank everyone, but 250+ players sort above the rest (two-class sort) until the top is all 250+.

The **finals qualification does NOT use this timeless GS** — the tournament track uses a *separate*, quarter-windowed GS fit (current form), the ladder track uses a monthly points board. Both are in §6.

**Skill history (new feature):** GS is derive-on-read and NOT historically reconstructable → add a daily **`PlayerSkillSnapshot`** (user_id, date, GS, stdError, band, version, gamesCount). Reuse the existing daily `FactionStatsSnapshot` cron pattern.
- ⚠️ **Build the snapshot cron EARLY (with the version cut on 24.09), even if the history-graph UI ships later** — every un-snapshotted day is history lost forever. Cheap (1000 players × 365 days is trivial).

## 4. Meta analytics: version × battle-type

Faction stats / heatmaps are stored per `(version, battle_type)`. **Two independent filters:**
- **Version dropdown:** single version (hard-cut, clean, comparable epochs) OR **"All time"** (weighted amalgam).
- **Battle-type dropdown:** Domination / Conquest / Siege OR **"All types"**.

- **"All time" (version) decay:** weight applied to **raw wins/games per match-game** (not to finished percentages), by version rank. Older versions count less; the past stays relevant. 🎚️ curve: harmonic 1/k (mild) vs. exponential (present dominant) — parametric, calibrate on data.
- **"All types" (battle-type) aggregation:** a plain sum across types — a rough global overview that *mixes* different balances, so the per-type views stay the meaningful ones (cheap to add: the games are battle-type-tagged, so "All types" is just no filter).

## 5. New modes: the battle-type × team-size matrix

Two **orthogonal** axes, designed together so every combination falls out cleanly:
- **Battle type** (kind of game): **Domination** (today's standard), **Conquest**, **Siege**.
- **Team size** (who plays): **1v1**, **2v2**.

A tournament/match is one cell of this 3 × 2 matrix ("2v2 Siege", "1v1 Conquest", …). The two axes barely touch in the data model — they *stack* rather than collide (battle type is an attribute + a stats/rating dimension; team size is the participant structure).

### Battle type — a real data + rating dimension (NOT just a label)
Domination / Conquest / Siege have different maps and win conditions, so **faction balance genuinely differs per type** (Alex: definitely track separately). So battle type is first-class:
- `Tournament.battle_type` + **`Map.type`** (Siege maps ≠ Domination maps → the pool is filtered to the type). One battle type per tournament.
- **Meta keyed by `version × battle_type`** (§4) — separate heatmaps/faction-stats per type + an aggregated "All types" overview.
- **Player skill:** extend the hierarchical model with a **battle-type level** — one **global GS** + a **battle-type offset** per type. One fit yields the global GS *and* each per-type GS (global + offset) — same shape as the existing GS + faction-offset ("skills are similar but not identical across types" *is* the offset). A global GS stays displayable alongside the per-type ones.
- **Migration:** tag all existing `MatchGame` as `DOMINATION` (trivial) — needed so the Domination meta/skills keep their **full history** instead of starting empty.

### Team size — the Competitor abstraction (2v2 = team-as-actor)
- The engine operates on a generic **Competitor = Player OR Team**. Registration, brackets, matches, standings, advancement, results, history all take a Competitor, not a user. **Validate at the door:** the *only* places the type matters are registration (1v1 → players only, 2v2 → teams only), authorization, and presentation — after that, treat both identically. (Resolves the earlier "polymorphic vs. abstraction" fork → **Competitor abstraction**.) A 2v2 match is still "1 vs 1" between two *teams*, so scoring / bracket / pairing / Swiss / BaLi keep working unchanged.
- **The one real rebuild:** generalise the participant from *User* (`Match.player1_id → User`, and everywhere that joins it) to a Competitor. Localised by the "validate at the door" rule — no 1v1-vs-2v2 conditionals sprayed through the engine.
- **Permanent Team** entity: own profile + stats, like a player account. Captain does all site interactions on the team's behalf (register, check-in, report, …); captaincy transferable.
- **Roster immutable** — a Team *is* a specific pairing (Alice+Bob ≠ Alice+Charlie); swapping = a new team; a dissolved partnership archives (never swaps a member) so past matches/results/stats/ratings keep referring to the duo that earned them.
- **Roster stored as membership**, not a `teammate` column — the existing `TeamMember` table already does this. Enforce exactly-2 for 2v2 but don't hard-code the size (keeps larger formats open without building them — YAGNI).
- **Keep Player↔Team↔Match linked** so individual 2v2 stats (best 2v2 player, across-partners win-rate) are *derivable later* — not built now.
- **2v2 inherits the battle-type dimension** (team GS is global + per-type, like a player's). Team rating reuses the engine (team = actor, faction-duo = faction). Analytics: **team GS** + **duo synergy** Top-N + search — pair-vs-pair is ~332k near-empty cells → search-only, never a grid. 🎚️ per-player-faction tracking depth.
- **Naming guard:** Domination/Conquest/Siege = **`battle_type`**, NOT `mode` — `TournamentMode` is already the faction-pick mechanic (BPT/SFT/…); reusing "mode" would collide.

## 6. Competition: two decoupled tracks

Two competitive tracks, deliberately using **different** measures because they reward different things. Both run on a **time axis** (quarter / month), decoupled from game versions.

### Tournament track — quarterly finals
- **Qualification by a quarterly GS**: the rating model fit on **all of this quarter's games — tournament AND ladder** (ladder games are NOT excluded from the quarterly ranking; same code path as today's season-scoping, just a quarter-wide window; NOT the timeless GS, NOT a wins/points tally). Why GS and not tournament points: points would force us to weight tournaments against each other (major vs. small, strong vs. weak field) — a comparability mess Alex explicitly rejects. GS cleans out opponent strength and matchup already. Current form falls out naturally (an old hand who plays badly *this quarter* has a low quarterly GS despite a high timeless one).
- **Activity counts for free:** with few quarterly games, L2 shrinkage pulls the value toward the mean, so you need enough games *and* good results to rank near the top. An explicit min-games gate can sit on top. 🎚️ gate.
- Top-N by quarterly GS → the quarterly major final. Reset each quarter. Maps onto the existing `is_major` + the lifetime, version-agnostic Major-Wins board (a won major is forever).

### Ladder track — monthly finals
- The ladder's job is to **drive activity** in Open Play — so here the **points system is the right tool**, because it rewards activity × success *directly* (the very thing that would be wrong for a "who's best" board). This is where the existing points-leaderboard logic finally belongs: as a *competition* board, not a skill board.
- The "Ponti grinds a lot but plays badly" problem is defused by the **monthly reset** — nobody carries an insurmountable cumulative lead; everyone starts each month at zero and the aggressive grinder's edge is bounded to one month.
- Ranked by monthly points from **Open-Play games** (this board measures ladder *activity*); top-N → monthly final; reset each month. **Note:** those same ladder games ALSO feed the global timeless GS and the quarterly-quali GS — counted everywhere, not siloed to this board. 🎚️ points formula.

❓ Circuit/cup wrapper (qualification chain, standings page) vs. just scheduling the finals.

## 7. Roadmap toward 2026-09-24

Scope: **everything, in one piece** — the pace supports it (see [[feedback-project-duration-overestimate]]). The ordering below is a **build sequence**, not a deadline cut; the DLC is simply the point by which the version cut must be live so post-DLC data starts clean.

**Foundation (everything hangs off it):**
1. **Version model + rename** `Season → GameVersion` — `dlc_tag` identifier, manual "start new version" admin action, DB migration, one `getActiveGameVersion()` helper.
2. **Battle-type dimension** wired in where it belongs: `Tournament.battle_type`, `Map.type`, `MatchGame.battle_type`; migrate all existing games → `DOMINATION` (keeps full history).
3. **Rating rework, one pass:** player params (global GS + faction offset + **battle-type offset**) accumulate across versions; `MatchupEffect` fits per `version × battle_type`; add the `PlayerSkillSnapshot` daily cron (history from day one).
4. **Meta analytics** keyed by `version × battle_type` + the "All time" / "All types" aggregations (§4).

**Modes + competition (on the foundation):**
5. **Siege & Conquest** — activate as battle types (maps typed, pools filtered, labels/descriptions).
6. **2v2** — permanent Team, participant generalisation (User | Team), team GS + duo analytics; inherits the battle-type dimension.
7. **Competition tracks** — quarterly-quali GS + monthly ladder points + Hall of Fame (first needed at the first quarterly/monthly final).

**Watch genuine risk (not duration):** the participant generalisation (2v2) touches core match reads, and the rating rework touches the scoring-critical model — both want solid tests + the data migration done carefully. Sequence them so each lands with its tests green.

## 8. Future roadmap (architecture should not preclude — do NOT build now)

- **Country / international "World Cup"-style event:** a higher-level **Event/Competition** that links several tournaments — per-country qualifiers → an international finals; qualifier winners feed the final as competitors. Country is competitor **eligibility metadata**, not a new competitor type. Overlaps with the Circuit/Cup wrapper (§9). ❓ Naming — the TW scene already uses "World Championship/Cup".
- **Prize pools with funding sources:** model a `PrizePool` as one or more `fundingSources` (sponsor / organizer / crowdfunding / entry_fees), combinable (e.g. €100 sponsor + €150 crowdfunding + €100 buy-in = €350). ⚠️ **Buy-in / entry fees are NOT legally uniform across jurisdictions** — paid entry + cash prizes for international online play needs separate legal/payment investigation before any platform build. Crowdfunding stays external (e.g. Ko-fi) so RizzAuto ideally never custodies community money.

Neither changes the current build; the competitor abstraction (§5) + a version/event layer already leave room for both.

## 9. Open items to resolve next
- ❓ Circuit/cup wrapper (qualification chain + standings page) vs. just scheduling the finals — ties into the Country/Event concept (§8).
- 🎚️ Calibrate: activity-window size & bar, meta decay curve, ladder points formula, quarterly-quali min-games gate.

_Resolved:_ version model (manual trigger); three axes — version-bound (meta) / timeless (skill) / time-boxed (competition); **battle type is a real dimension** (`version × battle_type`; GS global + battle-type offset; Domination back-tag); GS timeless, no recency; Hall of Fame (≥250); quali = quarterly GS on **all** games (tournament + ladder, not points); ladder = monthly points (Open Play); **2v2 = team-as-actor via a Competitor abstraction** (validate-at-the-door); roster immutable + membership-stored; **`battle_type` naming, not `mode`**; scope = everything in one piece, targeting 24.09. **Rating mechanics** (§3): one hierarchical L2 fit (GS + battle-type-offset + faction-offset), player params shared across versions + `MatchupEffect` per `version × battle_type`; timeless GS = one cached all-time fit (not window-capped, optimise later if slow); quarterly-quali GS = separate quarter-windowed fit; GS board filters by battle-type, never version.
