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
