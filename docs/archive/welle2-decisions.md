# Rizzotto — Spec decisions

Captured **2026-05-18** with Alex (co-stakeholder, live phone call).
These resolve the 19 open questions in `~/.claude/plans/hatte-r-cksprache-mit-alex-cosmic-snowglobe.md`
("BLOCKED ON ALEX" section). They unblock W5A (DOUBLE_ELIMINATION) and set the
scoring + reporting baseline for the pre-launch milestone.

When in doubt about a tournament-mechanics implementation choice, this file is
the source of truth — defer to it over older sketches in `WARHAMMER_PLATFORM_PROMPT_*`.

---

## A) Launch blockers (Q1–Q6)

### Q1 — Draft first-pick

**Decision: Coin-flip in the app (random).**

The app rolls 50/50 once at draft start. No seeding bias, no host bias. Implementation belongs in the draft `start` route; result must be persisted in the draft state so it survives reconnects.

### Q2 — Pick-order standard

**Decision: Per-preset, no platform default.**

The `DraftPreset.turns` array remains the single configuration point. No "house preset" is shipped as a default for tournament creation — organizers explicitly pick a preset (or build one). The existing `Standard 1v1` and `Captain's Mode Classic` seed presets stay; new TOW-specific presets are content, not architecture.

### Q3 — Army-list lock

**Decision: At check-in (tag-of-tournament).**

A new tournament-state transition closes the army-list editor once check-in opens. Until then lists are mutable. Needs a `lists_locked_at` timestamp on `Tournament` and a state hook from the check-in flow into list-mutation routes (403 after lock).

### Q4 — Match-reporting approval

**Decision: Both players submit independently. App matches results. Discrepancy → organizer.**

Each player files their own result via the match-report endpoint. If both agree → score is finalized. If they disagree (or one is missing past a deadline) → the match enters a `DISPUTED` state and only the organizer can resolve. Needs `MatchReport` table with `(match_id, reporter_user_id, score, submitted_at)` and a reconciliation routine.

### Q5 — Points size (1500 / 2000 / 2500…)

**Decision: Optional, informational in `rules` markdown.**

No structured field on `Tournament` — organizers write the points size into the rules markdown block. Keeps the schema simple; revisit only if multi-points-bracket scheduling becomes a feature.

### Q6 — Swiss rounds override

**Decision: No override — the app's algorithm decides hard.**

Organizers cannot override the recommended round count. This avoids ill-formed Swiss brackets and underpowered tiebreaker logic. Document the algorithm so organizers understand the recommendation.

---

## B) DOUBLE_ELIMINATION (Q7–Q11) — unblocks W5A

### Q7 — Grand-final bracket reset

**Decision: Per-tournament toggle.**

`Tournament.grand_final_reset: boolean` (already optional in the planned schema). Default UX value is **off** when the form is empty; the create/edit form exposes the toggle with a tooltip explaining "Losers-bracket winner must beat Winners-bracket winner twice."

### Q8 — Minimum participants for DoubleElim

**Decision: No minimum — organizer decides.**

The app does not refuse small DoubleElim brackets. If someone wants 4-player double-elim, that's their call. Document the practical floor (4 players) in the helper text.

### Q9 — Losers-bracket seed ordering

**Decision: Standard-TO convention (cross-bracket).**

Loser of Winners-match 1 plays loser of Winners-match N, loser of WB-2 plays loser of WB-(N-1), etc. Standard TOM/Smash convention. Implement in `generateDoubleElim()` as the canonical seeding; no organizer toggle.

### Q10 — Draft in losers bracket

**Decision: Organizer toggle per tournament.**

`Tournament.draft_in_losers_bracket: boolean` (defaults to value of `draft_enabled`, can be overridden separately). Some organizers want a faster losers bracket; some want full draft for fairness.

### Q11 — Player visibility of losers bracket

**Decision: Fully visible to everyone.**

No privacy toggle. The losers bracket is public — players can scout future opponents, spectators see the full pipeline. Matches the visibility model of the winners bracket.

---

## C) Tournament realities (Q12–Q14) — pre-launch scoring

### Q12 — Draw scoring + tabling bonus

**Decision: Classic W=3, D=1, L=0.**

Replace `Match.score` free-text with structured `MatchResult { winner_id, loser_id, draw, host_battle_points?, guest_battle_points? }` — but the standings sort is straight 3/1/0. No tabling bonus. Battle points are optional fields for tiebreakers only.

### Q13 — Painting + sportsmanship

**Decision: Both. Painting (judge, 0–5) + Sportsmanship (opponent vote, 0–5).**

Two new optional sub-systems:
- `PaintingScore { user_id, tournament_id, judge_user_id, score (0-5), notes? }` — judge submits during the event.
- `SportsmanshipVote { match_id, voter_user_id, voted_user_id, score (0-5) }` — auto-prompted after each match submission, can be skipped.

Both feed into a tournament-level "Best Painted" + "Best Sport" award computation. They do **not** affect ranking — purely awards.

### Q14 — Multi-day tournaments

**Decision: `end_date` + schedule block as required fields.**

`Tournament.end_date: DateTime` becomes required (defaults to `start_date` if 1-day). New `Tournament.schedule: Json | null` field holding `[{ day, round, start_time, duration_minutes }]` — required when `end_date > start_date`.

---

## D) Roadmap items (Q15–Q19) — M6+

### Q15 — Mission / terrain rotation

**Decision: Fixed order per tournament (organizer sets pool, app rotates).**

`Tournament.mission_pool: string[]` — list of mission names. The app rotates through them per round in declaration order. No random shuffle, no per-round override.

### Q16 — Special-character / allied / magic-items caps

**Decision: All three as separate required fields.**

`Tournament.special_character_cap: number`, `allied_rules: enum('NONE' | 'STANDARD' | 'EXTENDED')`, `magic_items_cap: number`. Required at tournament creation — these are the structural levers organizers tune most often.

### Q17 — Army-list public/private before start

**Decision: Organizer setting per tournament.**

`Tournament.list_visibility: enum('PUBLIC' | 'PRIVATE_UNTIL_ROUND_1' | 'PRIVATE_UNTIL_END')`. Defaults to `PUBLIC` for casual events, organizers flip to private for competitive ones.

### Q18 — 3v3 / Blind-Pick / SfT

**Decision: Required for Season 1. All three modes.**

These ship in M7 (pre-Season-1 release). Schema needs `Tournament.team_size: number` (default 1), `Tournament.draft_mode: enum('OPEN' | 'BLIND' | 'SFT')`. Existing 1v1 work is `team_size=1, draft_mode=OPEN`.

### Q19 — Season model

**Decision: 6 months / season, 3–4 majors per season.**

`Season.start_date` + `Season.end_date` already exist. Add `Season.tier: enum('MAJOR' | 'STANDARD' | 'CASUAL')` to tournaments so the season-summary can compute "majors played" + champion. Season auto-creation cron runs every 6 months.

---

## Open

- **Rizzotto etymology** — placeholder `[RIZZOTTO-ETYMOLOGY — Luke ergänzt]` in `docs/design/01-brand.md:7`. Luke supplies 2–3 sentences on the name's meaning and link to the aubergine identity. Not blocking pre-launch but should land before public press.
- **Aubergine accent (B2)** — confirmed OK after live-site review 2026-05-18. No change.
- **Spec-file ownership (B1)** — this file (`docs/spec/decisions.md`) is the canonical record, confirmed 2026-05-18. Future spec decisions get appended below this section with date + stakeholder, not in a separate file. The `docs/spec/` folder is reserved for spec-style decision records — not for general docs.
- **Faction crests for Norsca + Ogre Kingdoms** — prompts drafted in `docs/design/asset-prompts/norsca-ogre-kingdoms-crests.md` 2026-05-18. Generation + wire-up is a Luke task; until then both factions render the initials fallback in `FactionBadge`.
