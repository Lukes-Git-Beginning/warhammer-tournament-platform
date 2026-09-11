# 2v2 / Competitor implementation map

> From an Explore pass 2026-09-11. Implements design doc §5 (Competitor = Player OR
> Team, team-as-actor, validate-at-the-door). This is the Match-model rebuild — the
> 2nd-biggest risk after the rating rework. Build carefully, per step, tests green.

## Key finding — the seam is shallow
`Match.player1_id`/`player2_id`/`winner_id` are treated as **opaque UUID strings** by
Swiss (`swiss.ts`), bracket generation (`bracket.ts`, `playoff-generator.ts`), BaLi,
scoring (`scoring-service.ts`), and the **rating model** (`rating-model-service.ts`
maps `player1_id → playerAId` as a plain id, no User JOIN). So a Team UUID flows
through the entire statistical + pairing pipeline unchanged → **team-as-actor works
out of the box** there. The 1v1 assumption lives only at the *edges*: auth identity,
DTO serialisation, registration, and draft.

Existing stubs (all currently unused): `Team{ id, tournament_id, name, captain_id, members[] }`,
`TeamMember{ team_id, user_id, role? }`, `TournamentParticipant.team_id` (nullable),
`Tournament.competitor_format` (enum ONE_V_ONE/TWO_V_TWO, default ONE_V_ONE).

## Recommended minimal seam: opaque competitor slots + a type discriminator
1. **Schema (one migration):** drop the three FK relations `Match.player1_id/player2_id/winner_id → User` (keep the columns as plain `String?`, drop the FK constraints + the `User.matches_as_player1/player2/won` back-relations). The slots become "competitor id" — a User id for 1v1, a Team id for 2v2. Add `enum CompetitorType { USER TEAM }` + `TournamentParticipant.participant_type CompetitorType @default(USER)`. `team_id` already exists.
2. **Registration gate** (`routes/participants.ts` /register): if `tournament.competitor_format === 'TWO_V_TWO'` → team path (create/reuse a Team with the immutable duo as TeamMembers, set `team_id` + `participant_type = TEAM`); else the current user path. One helper `resolveCompetitorId(participant) = team_id ?? user_id`.
3. **Bracket seed supply** (`routes/bracket.ts` ~line 731): `participants.map(p => p.team_id ?? p.user_id)` instead of `p.user_id`. Everything downstream is id-agnostic. ONE line.
4. **Auth seam (HIGHEST RISK)** (`routes/matches.ts` ~120-139, `match-decision.ts`, `match-games.ts`): replace `user.sub === match.player1_id` with a helper `isCompetitorActor(userSub, competitorId, format)` → for TWO_V_TWO, "is the caller the captain of that team?". ~5 sites.
5. **DTO serialisation** (`GET /api/matches/:id`, `GET /:slug/bracket`): branch on competitor_format — resolve slot to a Team `{ id, name, captain, members }` vs a User `{ id, username, avatar_url }`. One branch per response, not per call site.
6. **Rating / leaderboard:** NO math change. Team UUIDs are opaque ids in the fit → a team gets a GS + faction-skill (faction = the team's chosen faction per game). Leaderboard needs a `resolveCompetitorName(id, type)` (User.username | Team.name) for display only.

## Highest-risk touch points (verify with tests)
1. **Auth identity** (`matches.ts` 120-139) — a wrong check lets a non-captain report a team's results.
2. **Draft** (`draft-service.ts`, `matches.ts` ~307-316): draft needs the **captain's User id** (Socket.IO room + pick attribution), NOT the team id → add a captain-lookup at draft start. Only subsystem where "team id in slot" breaks.
3. **rating null-guards** (`rating-model-service.ts` `confirmedGameWhere` `player1_id: { not: null }`) — keep consistent with what's in the slots for 2v2.
4. **bracket seed** (`bracket.ts` ~731) — the one seeding site; silent wrong seeds if missed.
5. **PlayerSkillSnapshot.user_id FK → User** — teams can't be snapshotted without loosening the FK or a TeamSkillSnapshot. NOT blocking v1 (teams simply not snapshotted yet).

## Build order
Schema+migration → Team create/registration (+ immutable roster, captain) → bracket seed + `resolveCompetitorId` → auth helper across the ~5 sites → DTO branch → draft captain-lookup → leaderboard/display name resolver → tests for each. Frontend (team creation UI, 2v2 registration, DTO consumption) comes in the frontend block.

---

## CONFIRMED 2026-09-11 (Alex) — supersedes any stale assumptions above

The seam analysis above (opaque competitor ids, read-site inventory, auth/draft/rating
touch points) is still accurate and drives the build. **But three product decisions
override the pragmatic shortcuts the original Explore pass assumed from the old stubs:**

### D1 — Team is PERMANENT, not tournament-scoped (fixes stale stub)
Design §5 is authoritative: a Team is a permanent entity (own profile + stats, like a
player account) — the SAME duo across all tournaments so team GS/stats accumulate.
The `Team.tournament_id` column on the old stub is pre-planning cruft → **drop it**
(the `Tournament.teams` relation too). Team identity = its immutable member set, made
find-or-createable via a canonical `roster_key` (sorted member user-ids) `@unique`.
Lifecycle: `enum TeamStatus { FORMING ACTIVE ARCHIVED }`. Captaincy transferable
(`captain_id` mutable); roster immutable (a new pairing = a new team; dissolve = archive,
never member-swap). `TournamentParticipant.team_id` → the permanent team; ONE participant
row per team (the captain's), `participant_type = TEAM`.

### D2 — BOTH members' factions per game (per-member factions), not one team faction
Each of the two players plays their own faction. Store two factions per side per game
(captain slot + teammate slot); pickers/draft resolve captain-vs-captain first, then
teammate-vs-teammate (matrix in 2v2 is unlikely per Alex but the same shape works).
This is an **additive faction subsystem** (nullable "_b"/member-2 fields on
`MatchGame` + `MatchBlindPick`, draft-for-two, report+DTO), layered on top of the
identity backbone — it does not disturb the 1v1 single-faction path. Faction-duo /
per-player-faction analytics stay derive-later (design §5 "search-only, not built now").

### D3 — Partner joins via invite + Discord-DM consent (not silent captain-names)
Captain creates the team, searches for the teammate, teammate gets a Discord DM asking
to confirm. So there is a real consent state: partner `TeamMember.accepted_at` null until
accept; team `FORMING` → `ACTIVE` on accept. Only an `ACTIVE` team the captain owns may
register for a 2v2 tournament. Needs create/invite/accept/decline endpoints + a user-search
endpoint for the picker + the Discord DM.

### Scoring FK-safety (scoring-critical — the real hidden risk)
`LeaderboardEntry.user_id`, `TournamentResult.user_id`, `PlayerSkillSnapshot.user_id`
all FK → User. A team id in a competitor slot would violate them. v1 rule (matches
"teams not snapshotted yet"): **team competitors are NOT written to user-keyed tables.**
Guard sites: `complete-match.ts` (~270) + `match-result-service.ts` (~268) per-match
leaderboard upserts, `finalize-tournament.ts` (~420) result+leaderboard upserts →
skip when `competitor_format === 'TWO_V_TWO'`; `player-skill-snapshot.ts` daily cron →
filter GS rows to ids that exist in `User` (else the cron crashes once any 2v2 game
exists). Team GS remains derive-on-read from the fit (opaque ids); persisted team boards
arrive with the competition tracks (§6/§7).

### Seed origins (broader than "ONE line")
Per the 2026-09-11 seed-flow map there are ~7 seed origins, not one: `routes/bracket.ts`
(/start, /next-round, /start-playoffs), `auto-swiss-service.ts` (startAutoSwiss,
generateNextSwissRound, startPlayoffs), and `balanced-liechtenstein-service.ts`
(pairing tick roster). Each needs `team_id` added to its participant `select` and its
`participantIds`/faction/band maps keyed by `team_id ?? user_id`. Late-join paths
(`createLateJoinerBye`, `admitBalancedLateJoiner`, `addLateParticipant`) take a bare
userId param → callers must pass the competitor id for 2v2. Generators
(`swiss.ts`/`bracket.ts`/`playoff-generator.ts`/`round-robin`/`liechtenstein`) are
id-agnostic — no change once callers pass competitor ids. Open Play is always 1v1.

### Session plan
- **Phase A — identity backbone:** permanent Team schema + lifecycle (create/invite/
  accept + Discord DM) → drop Match→User relations + CompetitorType/participant_type →
  competitor resolver → refactor read-sites (green typecheck) → 2v2 registration →
  seed origins → auth captain-check → scoring FK-guards → DTO team branch → draft
  captain-lookup → tests.
- **Notifications (Alex 2026-09-11):** every match/round DM must reach ALL players, not
  just captains — a 2v2 "next match" pairing DMs all four. A competitor slot is opaque
  (User id 1v1 / Team id 2v2), so the DM layer expands it to recipients. DONE:
  `resolveCompetitorRecipients` (discord-notify.ts) resolves a slot → the user (1v1) or
  all team members captain-first (2v2), each with a discord_id; `notifyRoundPairings` now
  takes competitor slot ids, shows `<@a> & <@b> vs <@c> & <@d>` in the channel embed, and
  DMs each member with the opposing side's mentions + a "(with your teammate …)" note. Bye
  DMs (round-1/playoff via `notifyMatchesCreated`, final-round via `auto-swiss-service`)
  likewise fan out to both members. Still per-user: the ~1h scheduled-match ready-check and
  Open Play (always 1v1) are untouched.
- **Phase B — per-member factions (D2):** game-level two-faction storage + blind-pick/
  draft/report/DTO for two members. Layered after A, each commit green. **Also converts
  the in-match auth + flow to captain/per-member** — `match-decision.ts` (coin flip,
  map pick/ban) and `match-games.ts` (blind/matrix faction lock, per-game report, replay
  disputes) still use `userId === player1_id`, which for 2v2 is FAIL-CLOSED (a team id
  never equals a user id → 403, safe, no wrong-actor hole) but non-functional. Until
  Phase B, a 2v2 tournament is completed via the captain/host **report-result** path
  (`matches.ts` POST `/:id/result`, already captain-aware) — not the per-game GameTile flow.
  - **DONE 2026-09-11 — GameTile per-game flow backend is now 2v2-capable.** `match-games.ts`:
    result-report auth is captain-as-actor (`resolveActorFlags`); lobby-code / lobby-password /
    GET games use `isCompetitorMember` (either teammate). `finalizeGameResult` resolves both
    members' factions per game (BPT_2V2 from that game's revealed blind pick, SFT_2V2 from
    registration) and stamps `player{1,2}_faction_id(_2)`, so per-game rows + recomputed stats
    carry all four. `completeMatch` writes a **null** AuditLog actor when the actor is a team
    slot (FK → User). Replay verification is **skipped (fail-open) for 2v2** — two-player
    attribution is meaningless for four players — so the replay-mismatch/dispute endpoints
    (`assert-replay-correct`, `opponent-confirm/reject`) are never reached for 2v2 and stay
    fail-closed; a winner-disagreement dispute still goes to the host (`resolve-dispute`,
    canManage). REMAINING: frontend GameTile display of both factions per side + a captain-only
    per-game report affordance; multi-player replay verification (deferred).
