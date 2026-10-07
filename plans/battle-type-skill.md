# Battle-Type Skill — per-type bands, profile switcher, questionnaire rework

Status: **DRAFT for Alex's review** (2026-10-08). Nothing built yet.

## Trigger

Maze (219 Domination + 1 Conquest game) showed **85%** on his profile while the Rankings
board shows **93%**. Root cause: profile / classification / snapshots read the raw base GS
(`getGeneralSkill().skill`), which the hierarchical fit leaves near the *unweighted* centroid of
a player's per-battle-type skills — one Conquest game weighs as much as 219 Domination games.
`b648ee4` (2026-09-22) fixed this for the boards only (`getOverallSkill`). His drop happened on
2026-09-20 (178 → 179 games), not because of Q4.

## Decisions (Alex, 2026-10-07/08)

1. **Skill is judged per battle type.** Which band/division someone gets in a Conquest
   tournament depends on how good they are at *Conquest*, not overall.
2. **Profile gets a page-wide battle-type switcher** next to the version selector.
   Default = the player's **most-played battle type**; Overall stays selectable as the summary
   (= Rankings board).
3. **Thin samples:** a per-type line/value shows only from a minimum game count; below that it
   is drawn dashed/pale as "provisional".
4. **Faction Proficiency per type = its own fit per battle type** (the model has no
   faction × battle-type term, so GS+FO+BTO would only shift all factions uniformly).
   Overall proficiency moves to the hierarchical fit (consistent with GS).
5. **Record:** games + W/L filtered per type; anti-farming points only under Overall.
6. **Existing registrations are grandfathered** — the new per-type gating applies to new
   registrations only. BaLi divisions are assigned at start, so they pick it up naturally.
7. **Questionnaire asks about every battle type** — no gate question, no transfer assumptions
   (no "Domination floor implies a Conquest floor"). Each type's floor comes from that type's
   own answers + the general questions.
8. Bug fix + feature ship together; snapshot history is rebuilt once.

## Where the battle type comes from

| Context | Battle type source | Uses |
|---|---|---|
| Tournament gating (registration) | `Tournament.battle_type` | band in that type |
| BaLi divisions + seeding | `Tournament.battle_type` | band/skill in that type |
| Open Play matchmaking | the pairing's battle type (queue selection, A-order wins) | skill in that type |
| Profile | switcher | standing/chart/proficiency/record in that type |
| Rankings / Quarterly boards | already per type (`gs-board.ts`) | unchanged |

Per-type skill = `GS + BTO(type)` (`getBattleTypeSkill`). BTO is shrunk toward 0 with few
games, so a player new to a type starts at their general level and moves with each game in it.
Overall = game-weighted (`getOverallSkill`).

## Work packages

1. **Classification per type** — `getPlayerClassification(…, battleType)`: data skill =
   per-type skill (SE: per-type, see open point), questionnaire floor = per-type floor, soft-floor
   blend counts games **of that type**. Callers: registration gating, BaLi
   (`balanced-liechtenstein-service.ts`), matchmaking, broadcast/eligibility DMs, admin views.
   Overall classification (profile "Overall" view) uses `getOverallSkill`.
2. **Snapshots per type** — `PlayerSkillSnapshot.battle_type` (`OVERALL|DOMINATION|CONQUEST|SIEGE`),
   unique `(user_id, snapshot_date, battle_type)`, existing rows → `OVERALL` then rebuilt.
   Daily cron + `gs-history-backfill` write one row per type the player has played; OVERALL =
   game-weighted. One-time full rebuild (removes the artificial 2026-09-20 kink for Maze & co).
3. **Endpoints** — `/api/users/:id/skill-history?battleType`, `/api/players/:id/classification?battleType`,
   faction-proficiency `?battleType`, version-stats/all-time record `?battleType`,
   `/api/users/:id/tournaments?battleType`; profile returns `mostPlayedBattleType`.
4. **Profile UI** — switcher (types the player never played are hidden), version + battle type in
   the URL (`?version=…&battleType=…`, shareable, survives reload). Recent Games' own filter is
   replaced by the page switcher.
5. **Faction Proficiency** — rating fit filtered to one battle type (new `battleType` filter in
   `loadVersionObservations`, cache key includes it).
6. **Questionnaire rework** — see below.
7. **Tests** — Maze regression (many games in one type + one in another → Overall ≈ dominant
   type), per-type classification, per-type floor, grandfathering, snapshot rebuild.
8. **Docs** — `.knowledge/algorithms.md` (outdated: still says "no general player skill"),
   `.knowledge/database.md` (migration).

## Questionnaire rework (draft — copy to be reviewed by Alex)

Mechanism: each question gets an optional `battleTypes` scope (absent = general, applies to all
types). `questionnaireFloor(answers, questions, battleType)` only counts general questions +
questions scoped to that type. The admin-editable catalog (AdminConfig) gets the optional field;
existing answers stay valid. The wizard already asks only unanswered questions → existing
players get just the new ones on their next calibration.

**General (all types, cap band 3 as today):** years_competitive, prior_titles, steam_hours,
community, list_building, total_battles (wording: drop "Land Battle").

**Domination** (existing, re-scoped): best_result, ranked_level, domination_battles,
meta_familiarity, self_rating (prompt gets "in Domination").

**Conquest / Siege** (new, one set each):

- `<type>_battles` — "Total multiplayer battles played (<Type> only)?" → <10 / 10–50 / 50–200 / 200+
  (floors null / 1 / 2 / 3, mirrors domination_battles)
- `<type>_best_result` — "Your highest <Type> tournament achievement?" → generic, no names:
  never made semis / semis in a <Type> tournament / won a <Type> tournament / won a major <Type>
  event or top of a <Type> season (floors null / 2 / 3–4 / 5 — mirror best_result).
- `<type>_self_rating` — "Where would you place yourself in <Type>?" → New … Top (floors 1–5)
- `conquest_ranked` — **Conquest only.** CA's in-game Ranked Matchmaking covers Domination,
  Conquest and Land Battle (Alex, 2026-10-08) — Siege is not in Ranked, so Siege gets no ladder
  question. Same options/floors as `ranked_level`; `ranked_level` is re-worded to
  "…in Domination" and existing answers stay mapped to Domination.

## Open points

- [x] `<type>_best_result`: **generic options, no names** (never semis / semis in a <Type>
      tournament / won a <Type> tournament / won a major <Type> event or top of a <Type> season).
- [x] Ladder question: **Conquest only** = CA Ranked Matchmaking (Conquest queue); Siege has none.
- [x] Minimum game count for "provisional" per-type values: **5**.
- [ ] Per-type SE: the fit gives Fisher SE for GS; BTO SE needs to be exposed (or approximated
      from per-type game count) for the conservative gating band (`GS − 2·SE`).
- [x] Existing calibrated players: **banner on their own profile** until the new Conquest/Siege
      questions are answered (no DM).
