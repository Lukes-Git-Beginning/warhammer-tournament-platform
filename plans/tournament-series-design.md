# Tournament Series + Tournament Duplication — Design & Build Plan

## Context

Hosts run recurring tournament series on rizzotto.gg where several "qualifier"
tournaments feed a single grand final (e.g. RTK's *Wednesday Wars* → cumulative-points
qualification; the *LotET Prize Fight* → per-qualifier top-2 qualification). Today this is
done entirely by hand: the standings are tallied manually (see the ad-hoc leaderboard we
computed for Wednesday Wars) and the final is seeded by hand.

This introduces a first-class **Series** object that groups qualifier tournaments, applies a
configurable scoring/qualification model, renders a **public live standings tracker**, and
**auto-seeds the grand final** from the qualified players. As a closely related win it also
adds **tournament duplication** (run "next week's qualifier" from a prefilled create form).

Intended outcome: a host creates a series once, attaches qualifiers (past or future), and the
standings + qualification + final seeding all happen automatically, publicly viewable.

## Locked decisions (from planning with Alex)

- **Reusable, host-managed feature from day 1** (not admin-only). Permissions reuse the
  existing `canManageTournament` pattern.
- **Configurable scoring per series.** Model A exposes free `points_per_game_played` and
  `points_per_win` (Wednesday Wars = 1 and 1).
- **One final per series** (v1). Multi-stage finals deferred.
- **Public `/series` tab** mirroring `/tournaments`; management controls live on the same
  pages, gated by `can_manage`.
- **Final is created inside the Create-Series dialog** (a collapsible embedded
  create-tournament block), starts in `REGISTRATION_CLOSED`, and is **auto-seeded** from the
  standings with a **one-click confirm** safety step before it goes live.
- **Past tournaments can be attached** and count as qualifiers.
- **Qualification models in v1: A and C.** B/D/E deferred.
- **Duplication** = open the prefilled create view (nothing is created until saved); keep the
  name; default the date to original + 1 week if still future, else the normal new-tournament
  default; copy co-hosts; reset everything match/result-related.

## Qualification models (v1)

Both are expressed by a `qualification` block in the series' `scoring_config` JSON.

### Model A — cumulative points → Top-N
- Per player, summed over **all** qualifier games:
  `points = games_played * points_per_game_played + wins * points_per_win`.
- Game eligibility = same as the site leaderboard: `MatchGame.status = COMPLETED` on a
  non-voided match (`match.counts_for_leaderboard = true`), so voided/no-contest games are
  excluded (this is why RizzOtto's voided WW1 games correctly did not count).
- Qualifiers = **Top-N** by points, N fixed on the series.
- **Tiebreakers (ordered, configurable):** for Wednesday Wars → 1) points, 2) wins,
  3) games played, 4) deterministic random seed. The random seed mirrors
  `sortSwissStandings`' final tiebreak (hash of `series.id + userId`), so it is stable and
  reproducible.
- The "currently qualified" set is **provisional** while qualifiers remain unplayed → mark it
  as such in the UI.

### Model C — per-qualifier Top-X (direct qualification)
- Each qualifier's **Top-X final finishers** (X configurable; LotET used X=2) qualify directly.
- Final size is **derived**: X × number of qualifiers (LotET: 2 × 4 = 8).
- **Already-qualified players are skipped when seeding a later qualifier's playoffs** (instead
  of being dropped by hand), so their playoff slot passes to the next non-qualified player.
  They are **marked as "already qualified"** in that qualifier's standings view.
- Past qualifiers are read-only (their playoffs already ran): Top-X taken from final standings.
  The skip-at-seeding logic only applies to **future** qualifiers in the series.
- A qualified slot is **fixed** once earned (not provisional).

## Data model (Prisma) + migration

New migration under `packages/db/prisma/migrations/<ts>_tournament_series/` (created via
`pnpm --filter @rizzotto/db db:migrate`; the repo uses explicit models + manual migrations,
never `db push`).

```prisma
model TournamentSeries {
  id                  String    @id @default(uuid()) @db.Uuid
  slug                String    @unique
  name                String
  description         String?
  poster_url          String?
  owner_id            String    @db.Uuid
  scoring_config      Json      // { model: 'A'|'C', points_per_game_played, points_per_win,
                                //   final_size, top_x, tiebreakers: string[] }
  final_tournament_id String?   @db.Uuid @unique
  final_seeded_at     DateTime? // set when the final is locked & seeded
  visibility          TournamentVisibility @default(PUBLIC)
  created_at          DateTime  @default(now())
  updated_at          DateTime  @updatedAt
  deleted_at          DateTime?

  owner            User         @relation(...)
  final_tournament Tournament?  @relation("SeriesFinal", fields: [final_tournament_id], ...)
  qualifiers       Tournament[] @relation("SeriesQualifier")
}
```

On `Tournament` (schema.prisma:349): add
- `series_id String? @db.Uuid` + relation `series TournamentSeries? @relation("SeriesQualifier")`
- `is_series_final Boolean @default(false)` (the final points back via `TournamentSeries.final_tournament_id`; this flag makes "is this a final?" cheap)
- `series_position Int?` (qualifier order within the series)

On `TournamentParticipant`: add `seed Int?` — used to drive deterministic seed order when the
final is auto-populated (avoids relying on `registered_at` order at `start`; see Risks).

## Backend

### Permissions
- `canManageSeries(prisma, seriesId, userId, role)` in `lib/series-utils.ts`, mirroring
  `canManageTournament` (`lib/tournament-utils.ts:138`): `MODERATOR|ADMIN` always; else
  `owner_id === userId`.
- **Attach a tournament to a series** requires `canManageSeries(series)` **and**
  `canManageTournament(tournament)`.
- Create series requires role `HOST|MODERATOR|ADMIN` (same guard as `POST /api/tournaments`,
  tournaments.ts:408).

### Series CRUD + list (routes/series.ts, new)
- `GET /api/series` — public list, modeled on `GET /api/tournaments` (tournaments.ts:299):
  same pagination/visibility/caching shape (`series:list:*`, 30s TTL). Returns per-series
  summary + `qualifierCount`, `final` summary, `status` (upcoming/ongoing/complete).
- `GET /api/series/:slug` — detail incl. `can_manage` (optional JWT, mirror
  tournaments.ts:719), the attached qualifiers, the final, the config, and the computed
  **standings** (see engine).
- `POST /api/series` — create; body includes the series fields **plus a nested
  create-tournament payload for the final** (reuse `CreateTournamentSchema`, tournaments.ts:166).
  Creates the final tournament first (status forced to `REGISTRATION_CLOSED`,
  `is_series_final = true`), then the series row.
- `PATCH /api/series/:slug` — edit series + reattach.
- `POST /api/series/:slug/attach` / `.../detach` — add/remove a qualifier (guarded as above).
- `POST /api/series/:slug/seed-final` — the confirm step: compute qualifiers, populate + start
  the final (see below). Guard `canManageSeries`.

### Scoring / standings engine (pure, unit-tested)
- `lib/series-standings.ts`, pure functions (pattern like `swiss.ts` / `leaderboard-service.ts`):
  - `computeSeriesStandingsA(games, config)` — aggregate per player
    (`games_played`, `wins`, `points`), sort by the configured tiebreaker chain, mark Top-N.
  - `computeSeriesQualifiersC(perQualifierStandings, config)` — walk qualifiers in order, take
    Top-X excluding already-qualified, return the qualified set + which qualifier each entered from.
- The route loads qualifier games via the same `gameWhere` filter used by
  `/api/meta/games` (meta.ts:253-277) and per-qualifier final standings via
  `computeSwissStandings` + `sortSwissStandings` (swiss.ts:233, 494) `.filter(!dropped).slice(0, X)`.

### Model C — seeding hook (the deepest integration)
When a **future** qualifier that belongs to a Model-C series starts its playoffs, exclude
already-qualified players so they don't take a playoff slot:
- Both playoff paths funnel player selection through `checkedInPlayerIds` /
  `topNCheckedIn()` (`lib/playoff-generator.ts:83`) and the `activeStandings` array
  (`bracket.ts:1078`, `auto-swiss-service.ts:474`).
- Add a pre-step: if `tournament.series_id` and the series is Model C, compute the series'
  already-qualified set and **remove those userIds from `checkedInPlayerIds`** before
  `generatePlayoffBracket()`. This reuses the existing skip mechanism (topNCheckedIn already
  skips anyone not in the set) with zero change to the bracket math.
- Expose the already-qualified set on the qualifier's bracket/standings response so the UI can
  tag those players "already qualified".

### Final — creation + auto-seed
- Created up front in `REGISTRATION_CLOSED` (self-registration is blocked there —
  `/register` requires `OPEN_REGISTRATION`, participants.ts:90).
- Seeding path `lib/seed-series-final.ts`:
  1. compute the ranked qualified list (Model A: Top-N; Model C: union of per-qualifier Top-X);
  2. `addLateParticipant()` (tournament-management.ts:42, allowed at `REGISTRATION_CLOSED`) for
     each, writing `TournamentParticipant.seed = rank`;
  3. start the final by calling the format's generator directly with the **rank-ordered**
     userId array (`generateSingleElim`/`generateDoubleElim`/`generateSwissRound`/
     `generateRoundRobin`, bracket.ts:465-562) so seed 1 = top qualifier, bypassing the
     `registered_at` load order.
- Triggered by `POST /api/series/:slug/seed-final` after the host confirms; the series page
  surfaces a "Ready to seed" state once all qualifiers are `COMPLETED`.

### Duplication (routes/tournaments.ts)
No new persistence path needed — duplication is a **frontend prefill** of the existing create
form (see below). Backend already supports everything via `POST /api/tournaments`
(tournaments.ts:406) + `POST /api/tournaments/:slug/co-hosts`. Optionally add a convenience
`GET /api/tournaments/:slug/clone-defaults` that returns the copyable field set (all scalar
config fields except `id/slug/status/timestamps/deleted_at/random_map_pool_played/`
`pending_resize_notice/playoff_plan`, plus `map_pool`, `faction_allowlist`,
`restricted_factions`, co-hosts) — but the create form can also derive this from
`GET /api/tournaments/:slug` directly.

## Frontend

### Routes + nav
- `router.tsx`: add public `/series` (`SeriesListingPage`) and `/series/$slug`
  (`SeriesDetailPage`), registered before `$slug`; use `useAuthQuery()` (non-blocking), not
  `useRequireAuth()`.
- `components/layout/Header.tsx`: add a **Series** nav link after Tournaments (line ~34);
  reuse `canCreate` (HOST/MOD/ADMIN) for a "Create Series" affordance.

### Series list + detail
- `routes/SeriesListingPage.tsx` — mirror `routes/TournamentsListing.tsx` (grid + cards,
  active/archive split); data via new `listSeries()` in `lib/api.ts` (pattern: api.ts:497).
- `routes/SeriesDetailPage.tsx` — header (like TournamentDetail), **standings table** with a
  clear **"Qualified" marker** (and "provisional" note for Model A while qualifiers remain),
  the list of qualifiers (links), and the final. Management controls wrapped in
  `{series.can_manage && ...}` (pattern: TournamentDetail.tsx:337) — attach/detach, edit,
  "Lock standings & seed final" (opens the confirm dialog showing the computed seeding).

### Create/Edit series
- `components/series/SeriesCreateForm.tsx` — series fields + scoring model selector
  (A/C with the model-specific inputs) + tiebreaker ordering + a **collapsible embedded
  `TournamentCreateForm`** block for the final. Submits via `createSeries()` (api.ts pattern
  at 538).

### Series dropdown in the tournament form
- `components/tournament/TournamentCreateForm.tsx`: add optional `series_id` to
  `TournamentCreateSchema` (line 18) + a "Part of series" dropdown (options from
  `listSeries()` filtered to series the user can manage); pass through in `mutation.mutate`
  (line ~425). Same for `TournamentEditPage`/`patchTournament`.

### Duplicate button
- On `TournamentDetail.tsx` inside the `canManage` block: a "Duplicate" button that navigates
  to the create route with the current tournament's copyable fields as router state; the
  create form reads that state on mount and prefills (analogous to the existing
  `nextRoundHour()` defaulting, TournamentCreateForm.tsx:174). Date default = original + 1 week
  if future, else normal default. If the source is in a series, offer to preselect that series.

## Hard parts / risks

1. **Model C seeding hook** — the only change that reaches into live bracket generation.
   Mitigated by piggybacking on the existing `checkedInPlayerIds` skip in `topNCheckedIn()`
   rather than altering seed math. Needs tests for: skip correctness, past-vs-future
   qualifiers, and enough remaining players to fill X slots.
2. **Deterministic final seed order** — `POST /start` loads participants by `registered_at`;
   to guarantee seed 1 = top qualifier we bypass that in `seed-series-final.ts` and pass the
   ranked array straight to the generator (and persist `TournamentParticipant.seed`).
3. **Provisional vs fixed standings** — Model A "qualified" shifts until all qualifiers finish;
   must be labeled provisional to avoid misleading players.
4. **Scoring eligibility consistency** — series uses the same `counts_for_leaderboard` filter
   as the site leaderboard so voided games are excluded uniformly (already validated).

## Phasing

- **Phase 0** — Prisma model + migration (`TournamentSeries`, `Tournament.series_id/`
  `is_series_final/series_position`, `TournamentParticipant.seed`).
- **Phase 1** — Tournament duplication (independent, immediate win).
- **Phase 2** — Series CRUD + attach + public list/detail + **Model A** standings tracker
  (delivers the Wednesday Wars tracker end-to-end).
- **Phase 3** — Final creation-in-series + auto-seed with confirm (Model A).
- **Phase 4** — **Model C** (per-qualifier Top-X, skip-already-qualified seeding hook,
  standings markers).

## Verification

- **Unit:** `series-standings.ts` (Model A points/tiebreakers incl. the ponti case;
  Model C top-X with already-qualified exclusion). Run `pnpm -F @rizzotto/backend test`.
- **Model A end-to-end:** create a series over the real `wednesday-wars-1` +
  `wednesday-wars-by-rtk`, confirm the standings match the numbers we computed manually
  (sir_vellington 21, jimmy 20, …; Top-16 cutoff at the 8-point tie resolved by
  wins→games→random).
- **Model C end-to-end:** a 2-qualifier test series, X=2; verify the 2nd qualifier's playoffs
  skip the players who qualified in the 1st, and the final is seeded with all four.
- **Final seeding:** confirm dialog lists the seeds in order; after confirm the final is
  `ONGOING` with seed 1 = top qualifier.
- **Duplication:** duplicate a tournament, verify all config + co-hosts copied, no
  participants/matches, date = +1 week, name kept.
- **Permissions:** a non-owner host cannot edit a series or attach a tournament they don't
  manage; a normal user sees the public tracker but no management controls.
