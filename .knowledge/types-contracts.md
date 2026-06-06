> Read-when: Shared Types/Zod-Schemas brauchen, Socket-Event-Payload-Shape, Frontend-Backend-Contract-Check.

**TL;DR:**

- `@rizzotto/types` ist Single Source of Truth für Zod-Schemas + Socket-Events + Bracket/Draft-Types.
- Alles per `packages/types/src/index.ts` re-exportiert — ein `import { ... } from '@rizzotto/types'` reicht.
- Backend, Frontend und E2E importieren daraus; wenige lokale Types in `apps/frontend/src/lib/api.ts` sind noch nicht migriert (Inkonsistenz, siehe unten).

---

## Package

| Feld   | Wert                                                      |
| ------ | --------------------------------------------------------- |
| Name   | `@rizzotto/types`                                         |
| Source | `packages/types/src/`                                     |
| Entry  | `packages/types/src/index.ts` (re-exportiert alle Module) |

```typescript
import { JwtPayloadSchema, BracketNode, ServerToClientEvents } from '@rizzotto/types';
```

---

## Module-Übersicht

| Datei              | Inhalt                                                                                                                                                                                                                                                                                                                               |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `api-schemas.ts`   | Zod-Schemas + abgeleitete Typen für REST-API (Auth, User, Leaderboard, Factions, Meta). **+2026-06 Dynamic Leaderboard:** `DynamicLeaderboardEntryDto`/`DynamicLeaderboardResponse`, `MatchScoringBreakdownDto`, `PlayerOpponentBreakdownDto`, `FactionMatchupMatrixEntryDto`/`…Response`, `PlayerFactionProficiencyDto`/`…Response`. **+2026-06-06:** `DynamicLeaderboardEntryDto.totalMatches` umbenannt in `totalGames` (Leaderboard rechnet jetzt auf Game-Ebene). **+M6:** `H2HResponseSchema`, `CalendarQuerySchema`, `CalendarTournamentSchema`, `ImportLogEntrySchema`, `ImportLogListResponseSchema`, `TournamentStatusSchema`, `TournamentFormatSchema` (echte Zod-Enums). |
| `bracket.ts`       | Bracket-Layout-Typen: `BracketNode`, `BracketResponse`, Swiss-Standings                                                                                                                                                                                                                                                              |
| `draft.ts`         | Draft-State-Machine-Typen, Preset-CRUD-DTOs, Event-DTOs                                                                                                                                                                                                                                                                              |
| `socket-events.ts` | `ServerToClientEvents`, `ClientToServerEvents`, `InterServerEvents`, `SocketData`                                                                                                                                                                                                                                                    |
| `match.ts`         | Match-Status/Result-Enums (`MatchStatusSchema`, `MatchResultTypeSchema`), Report-DTOs (`SubmitMatchReportSchema` …). **+2026-06 (P1a):** `MatchDetailDto` (+ `MatchPlayerRefSchema`/`MatchFactionRefSchema`/`MatchPhaseSchema`) — angereicherte Shape für `GET /api/matches/:id`. **+2026-06-06:** `GameHistoryEntry`, `GameHistoryPlayer`, `GameHistoryTournament` — Single Source of Truth für alle Game-History-Listen (Meta + Turnier). Vorher lokal in `api.ts`, jetzt in `@rizzotto/types`. |

---

## Wichtigste Zod-Schemas (`api-schemas.ts`)

**Auth & User:**

```typescript
JwtPayloadSchema; // { sub, discord_id, username, role }
RoleSchema; // z.enum(['USER', 'ORGANIZER', 'MODERATOR', 'ADMIN'])
UserPublicSchema; // { id, username, avatar_url, role }
UserMeSchema; // UserPublic + { discord_id, email, timezone, preferred_factions, last_login, created_at }
UpdateMeSchema; // { timezone?, preferred_factions? }
UpdateUserRoleRequestSchema; // { role }
```

**Leaderboard:**

```typescript
LeaderboardEntryDtoSchema; // { rank, user, total_points, elo_rating, matches_played, wins, losses }
LeaderboardResponseSchema; // { season?, entries, total, page, pageSize }
AllTimeLeaderboardEntryDtoSchema; // LeaderboardEntryDto + { seasons_participated }
SeasonSummarySchema; // { id, name, start_date, end_date, is_active, dlc_tag? }
```

**Factions & Meta:**

```typescript
FactionDtoSchema; // { id, name, race, category, color_hex, display_order, icon_url, initials }
FactionStatsDtoSchema; // { matches_played, wins, losses, draws, win_rate, pick_count, ban_count }
FactionWithStatsDtoSchema; // { faction, stats }
FactionListResponseSchema; // { data, season }
FactionDetailResponseSchema; // { faction, stats, trend }
MetaOverviewResponseSchema; // { season, top_factions_by_winrate, top_factions_by_pickrate, total_matches, faction_diversity }
MatchupCellSchema; // { faction_a_id, faction_b_id, faction_a_wins, faction_b_wins, draws, total, winrate_a }
MatchupHeatmapResponseSchema; // { season_id, cells, factions }
```

**Weitere:** `HealthResponseSchema`, `ErrorResponseSchema`, `DiscordCallbackQuerySchema`, `UserProfileResponseSchema`, `SnapshotTrendEntrySchema`.

**M6 — neue Schemas:**

```typescript
TournamentStatusSchema;  // z.enum(['DRAFT','OPEN_REGISTRATION','REGISTRATION_CLOSED','ONGOING','COMPLETED'])
TournamentFormatSchema;  // z.enum(['SWISS','SINGLE_ELIMINATION','DOUBLE_ELIMINATION','ROUND_ROBIN','DOUBLE_ROUND_ROBIN'])
H2HResponseSchema;       // { userA, userB, wins_a, wins_b, draws, matches[] }
CalendarQuerySchema;     // { year, month, status?, is_major? }
CalendarTournamentSchema;
ImportLogEntrySchema;
ImportLogListResponseSchema;
```

> **Gotcha `TournamentFormatSchema`:** Muss exakt dem Prisma-Enum entsprechen — `SWISS, SINGLE_ELIMINATION, DOUBLE_ELIMINATION, ROUND_ROBIN, DOUBLE_ROUND_ROBIN`. `CUSTOM` existiert nicht, `DOUBLE_ROUND_ROBIN` darf nicht fehlen. `typecheck` fängt das nicht (Zod-Enum ist nur ein String-Set), Fehler zeigt sich erst zur Laufzeit.
>
> **Gotcha Boolean-Query-Params:** `z.coerce.boolean()` NICHT für Query-Strings nutzen — `Boolean("false") === true`. Stattdessen: `z.enum(['true','false']).transform(v => v === 'true')`. Betrifft `is_major` in `CalendarQuerySchema`.

---

## Socket-Events (`socket-events.ts`)

### Client → Server (`ClientToServerEvents`)

| Event              | Payload                                  |
| ------------------ | ---------------------------------------- |
| `join_tournament`  | `tournamentId: string`                   |
| `leave_tournament` | `tournamentId: string`                   |
| `join_draft`       | `draftId: string`                        |
| `leave_draft`      | `draftId: string`                        |
| `watch_draft`      | `draftId: string`                        |
| `draft_action`     | `{ draftId: string; factionId: string }` |

### Server → Client (`ServerToClientEvents`)

| Event                      | Payload                                                                                                                |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `bracket_update`           | `{ tournamentId }`                                                                                                     |
| `match_result`             | `{ tournamentId, matchId, winnerId, score, nextMatchId }`                                                              |
| `tournament_status_change` | `{ tournamentId, status: TournamentStatusLiteral }`                                                                    |
| `participant_change`       | `{ tournamentId, userId, action: 'registered'\|'withdrew'\|'checked_in'\|'disqualified' }`                             |
| `draft_started`            | `{ draftId, matchId, presetId, turnSeconds, hostUserId, guestUserId }`                                                 |
| `turn_started`             | `{ draftId, turnIndex, actor, action, isHidden, isParallel, asOpponent, category, availableFactions, timerExpiresAt }` |
| `action_committed`         | `{ draftId, turnIndex, actor, action, factionId, isAutoSelected, isHiddenFromYou }`                                    |
| `draft_state_sync`         | `{ draftId, state: PublicDraftState, currentTurn, timerExpiresAt, status }`                                            |
| `draft_complete`           | `{ draftId, matchId, finalFactions: { host: string[]; guest: string[] } }`                                             |

`TournamentStatusLiteral` = `'DRAFT' | 'OPEN_REGISTRATION' | 'REGISTRATION_CLOSED' | 'ONGOING' | 'COMPLETED'`

---

## Bracket-Types (`bracket.ts`)

```typescript
interface BracketNode {
  matchId;
  round;
  matchNumber;
  player1Id;
  player2Id;
  winnerId;
  score;
  status: 'PENDING' | 'ONGOING' | 'COMPLETED' | 'BYE' | 'FORFEIT';
  nextMatchId;
  player1FactionId;
  player2FactionId;
  draft_id?;
  draft_status?;
}
interface BracketResponse {
  tournamentId;
  rounds;
  matches: BracketNode[];
  swiss?: SwissMeta;
}
interface SwissMeta {
  recommendedRounds;
  currentRound;
  standings: SwissStandingEntry[];
}
interface SwissStandingEntry {
  userId;
  username;
  avatarUrl;
  score;
  wins;
  losses;
  draws;
  byes;
  buchholz;
}
```

---

## Draft-Types (`draft.ts`)

**Enums:** `ActorSchema` (`host|guest|admin`), `DraftActionSchema` (`pick|ban|snipe|steal|reveal_picks|reveal_bans|reveal_all`), `DraftActionExtendedSchema` (+ `auto_select|start|complete|cancel`), `DraftVariantSchema` (`global|exclusive|nonexclusive|null`), `DraftStatusSchema` (`PENDING|ONGOING|COMPLETED|CANCELLED`).

**DraftState** (Top-Level-Keys):

```typescript
interface DraftState {
  picks;
  bans;
  exclusive_bans; // host/guest arrays + shared ban list
  hidden_picks;
  hidden_bans; // verdeckte Aktionen bis reveal
  hidden_pick_variants;
  hidden_ban_variants; // variant-tracking für reveal
  parallel_pending; // { host, guest } nullable strings
}
```

**DraftPreset:**

```typescript
interface DraftPreset {
  id;
  name;
  description;
  created_by;
  is_public;
  turns: DraftTurn[]; // { order, actor, action, variant, is_hidden, is_parallel, as_opponent, category }
  category_limits: CategoryLimit[]; // { category_name, factions[], max_picks, max_bans }
  turn_seconds;
  created_at;
  updated_at;
}
```

**Weitere DTOs:** `DraftView`, `DraftEventDto`, `DraftEventsResponse`, `StartMatchResponse`, `CreateDraftPresetSchema`, `UpdateDraftPresetSchema`, `DraftPresetListResponse`, `ApplyContext`.

---

## Frontend-lokale Types vs. shared Types

`apps/frontend/src/lib/api.ts` definiert **lokal**: `Tournament`, `TournamentCreate`, `SeasonSummary` (dupliziert!), `AuditLogEntry`, `AdminStats`, `AdminUser`, `AllTimeEntry`, `AllTimeLeaderboardResponse`.

Diese sollten idealerweise in `@rizzotto/types` migrieren — aktuell existiert eine Inkonsistenz zwischen lokalen Frontend-Types und den shared Zod-Schemas (z.B. `SeasonSummary` ist doppelt definiert).

---

## Konvention bei neuen Events/Schemas

1. **Neues Schema:** Zuerst in `packages/types/src/api-schemas.ts` oder `draft.ts` definieren (Zod-Schema + abgeleiteter `type`).
2. **Backend + Frontend** importieren ausschließlich aus `@rizzotto/types` — nie lokal duplizieren.
3. **Neues Socket-Event:** Interface in `socket-events.ts` erweitern (beide Richtungen prüfen), dann Emit-Helper in `apps/backend/src/lib/emit.ts` ergänzen.
4. Nach Änderungen: `pnpm --filter @rizzotto/types build` damit `dist/` aktuell bleibt.
