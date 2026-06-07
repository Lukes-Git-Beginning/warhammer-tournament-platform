> Read-when: Schema-Frage, neues Model, Migration nötig, Prisma-Setup, Seeding.

**TL;DR:**
- Prisma 7 (`^7.8.0`) mit driver-adapter `PrismaPg` aus `@prisma/adapter-pg` — kein nativer Prisma-Connection-String-Modus.
- 27 Models in `packages/db/prisma/schema.prisma` (nach Phase-2-Drop). Welle-2-Models: Map, TournamentMapPool, MatchMapDecision, MatchBlindPick, TournamentArmyList, SteamLink, AdminConfig. (`FactionMastery`/`FactionMatchupStat`/`AntiFarmCap` per `drop_welle2_mmr_deprecated` entfernt.)
- **2026-06-07 Migration `remove_elo`**: `LeaderboardEntry.elo_rating` (Int) und `TournamentResult.elo_change` (Int) gedroppt. `LeaderboardEntry` hat jetzt nur noch: `total_points`, `games_played`, `wins`, `losses`.
- **Gotcha Advisory Lock**: Bei abgebrochenem `prisma migrate` hält die DB einen Lock. Fix: `docker exec tww3-postgres psql -U tww3 -d tww3 -c "SELECT pg_advisory_unlock_all();"` + danach pg_terminate_backend auf alle aktiven Connections.
- **Gotcha:** `datasource.url` steht NICHT in `schema.prisma`, sondern in `prisma.config.ts` — `schema.prisma` enthält nur `provider = "postgresql"`.

---

## Setup

Import im gesamten Monorepo:

```ts
import { prisma } from '@rizzotto/db';
```

Der Singleton ist in `packages/db/src/index.ts` definiert. Er nutzt `globalThis` um Hot-Reload-Verbindungslecks in Dev zu vermeiden:

```ts
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({ adapter, log: ... });

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
```

Der Adapter wird explizit instanziiert:

```ts
import { PrismaPg } from '@prisma/adapter-pg';
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
```

Prisma-Version: `^7.8.0` (Client, CLI, Adapter jeweils gleich).
Client wird in `../generated/prisma/client.js` generiert (ESM-Format).

---

## Konfiguration

### Gotcha: `datasource.url` gehört in `prisma.config.ts`, nicht in `schema.prisma`

`packages/db/schema.prisma` (nur `provider`, keine URL):

```prisma
datasource db {
  provider = "postgresql"
}
```

`packages/db/prisma.config.ts` (enthält die URL und Migrations-Pfade):

```ts
import { defineConfig, env } from 'prisma/config';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
```

`.env` liegt im Workspace-Root (zwei Ebenen über `packages/db/`). Sowohl `prisma.config.ts` als auch `src/index.ts` laden es explizit via `dotenv`.

### Gotcha: PG-Password muss URL-safe sein

`DATABASE_URL` ist ein RFC-3986-URI, daher dürfen `+`, `/`, `=` und `?` nicht unencoded im Password-Teil stehen. `openssl rand -base64 32` produziert genau solche Zeichen → URL-Parsing failt mit `P1013: invalid port number in database URL`. **Generieren via `openssl rand -hex 32`** (64-char hex, garantiert URL-safe).

### Gotcha: Source-IP-Spoofing über Docker-Bridge

Wenn Backend vom Host nach Postgres im Container über `127.0.0.1:5432` verbindet, sieht der Container die Source-IP als Docker-Bridge-IP (z.B. `172.18.0.1`), nicht als `127.0.0.1`. Postgres' default `pg_hba.conf` hat `host all all 127.0.0.1/32 trust` für loopback und `host all all all scram-sha-256` als catch-all — die Bridge-IP fällt auf catch-all, scram-sha-256 ist erzwungen. Wenn das Init-Password aus `POSTGRES_PASSWORD_FILE` nicht greift (z.B. Volume war beim Restart nicht leer): direkt `ALTER USER rizzotto WITH PASSWORD '<hex>'` im Container via `docker exec rizzotto-postgres psql -U rizzotto -d rizzotto` (peer-auth innerhalb Container ist `trust`).

---

## Models — Übersicht

| Model | Zweck |
|---|---|
| `User` | Discord-Auth-Nutzer, Rollen, Soft-Delete |
| `Faction` | Referenz-Tabelle der 24 TWW3-Fraktionen (slug als PK) |
| `Tournament` | Turnier mit Format, Status, Sichtbarkeit und Zeitzone |
| `TournamentFactionAllowlist` | Erlaubte Fraktionen pro Turnier (leere Liste = alle erlaubt) |
| `TournamentParticipant` | Anmeldung eines Nutzers zu einem Turnier |
| `Match` | Einzelne Partie inkl. Bracket-Selbstreferenz für Progression |
| `Team` | Team-Stub für zukünftiges 3v3 (Phase 3, aktuell ungenutzt) |
| `TeamMember` | Mitgliedschaft eines Nutzers in einem Team |
| `Season` | Saison-Zeitraum mit aktivem Flag und optionalem Major-Turnier |
| `LeaderboardEntry` | Punkte und ELO eines Nutzers pro Saison |
| `TournamentResult` | Platzierung und Punkte eines Nutzers nach Turnierende |
| `ArmyList` | Hochgeladene Armeeliste (Datei-URL + parsed JSON) |
| `FactionStats` | Aggregierte Fraktionsstatistiken pro Saison |
| `FactionStatsSnapshot` | Täglicher Snapshot für Winrate-Trend (rolling 30d) |
| `MatchupStats` | 24x24-Heatmap-Daten (Fraktions-A vs. Fraktions-B pro Saison) |
| `DraftPreset` | Konfigurierbare Pick/Ban-Vorlage mit Turns und Category-Limits |
| `Draft` | Laufender Draft-Zustand für ein Match |
| `DraftEvent` | Einzelne Pick/Ban/Snipe/Steal-Aktion innerhalb eines Drafts |
| `AuditLog` | Admin-Aktionsprotokoll (wer hat was wann an welcher Entity getan) |
| `ImportLog` | Protokoll jedes Scraper-Laufs (totaltavern.com) für Observability |
| `Map` | **Welle 2** — Master-Pool aller spielbaren Maps; slug @unique, Soft-Delete via `deleted_at` |
| `TournamentMapPool` | **Welle 2** — Snapshot des Map-Pools beim Tournament-Create; composite-PK `[tournament_id, map_id]` |
| `MatchMapDecision` | **Welle 2** — Pre-Match Map-Auswahl (Mode `RANDOM` oder `PICK_BAN`), Coin-Flip-Seed, `bans_top/bottom`-Arrays, `game_index` für Bo3/Bo5 |
| `MatchBlindPick` | **Welle 2** — Blind Faction Pick pro Match (BPT/OPEN-Modus); beidseitiger Lock-Timestamp, Reveal nach beidseitigem Lock |
| `TournamentArmyList` | **Welle 2** — SLT-Pre-Upload (Screenshot required, `.army_setup` optional), Reveal-Logic (nach Match an Gegner, nach Tournament-Complete public) |
| `SteamLink` | **Welle 2** — Steam-OpenID-2.0-Verifikation pro User (user_id @unique, steam_id @unique); Hard-Gate-Voraussetzung |
| ~~`FactionMastery`/`FactionMatchupStat`/`AntiFarmCap`~~ | **Welle-2-MMR — ENTFERNT** (Migration `drop_welle2_mmr_deprecated`, Branch `chore/phase2-consolidation`). Abgelöst vom derive-on-read Rating-Modell (`lib/rating-model.ts`) + OpponentShare-Modifier (`lib/scoring-service.ts`). Faction-vs-Faction-Daten leben jetzt in `MatchupStats` (Heatmap). |
| `AdminConfig` | **Welle 2** — Live-Settings Key-Value-Store (Json `value`); pflegt Defaults, Feature-Flags, Welcome-Banner-Text etc. |

---

## Models — Detail

### User
- `deleted_at DateTime?` — Soft-Delete; Index auf `deleted_at` vorhanden.
- `role Role` — Enum `USER | ORGANIZER | MODERATOR | ADMIN`, Default `USER`.
- `discord_id String @unique` — primäre Identität (kein Passwort).
- Relationen: `organized_tournaments Tournament[]`, `participations TournamentParticipant[]`, `matches_as_player1/player2/won Match[]`.

### Tournament
- `status TournamentStatus` — treibt Registration, Draft-Flow und Bracket-Anzeige.
- `deleted_at DateTime?` — Soft-Delete.
- `draft_enabled Boolean` + `draft_preset_id` — aktiviert den Draft-Flow per Match.
- Relationen: `participants TournamentParticipant[]`, `matches Match[]`, `results TournamentResult[]`.

### Match
- `status MatchStatus` — `PENDING | ONGOING | COMPLETED | BYE | FORFEIT | DISPUTED`.
- `next_match_id String?` — Selbstreferenz (`BracketProgression`) für Bracket-Traversal.
- `deleted_at DateTime?` — Soft-Delete.
- **Dynamic-Leaderboard (2026-06):** `season_id String? @db.Uuid` (+ `season Season?` Relation, Index `[season_id, status]`), `played_at DateTime?`, `ruleset String?` — beim Statuswechsel auf COMPLETED gestempelt (beide Completion-Pfade: `match-result-service.ts` + Legacy `routes/matches.ts`). Authoritative Season-Zuordnung für die derive-on-read-Aggregation.
- Relationen: `player1/player2 User?`, `winner User?`, `draft Draft?`, `feeder_matches Match[]`, `season Season?`.

### TournamentParticipant
- `status ParticipantStatus` — `REGISTERED | CHECKED_IN | DISQUALIFIED | WITHDREW`.
- `deleted_at DateTime?` — Soft-Delete.
- `faction_id String?` — Post-Draft-Zuweisung oder SFT-Vorab-Pick.
- Unique-Constraint: `[tournament_id, user_id]`.

### Season
- `is_active Boolean` — genau eine aktive Saison erwartet; Index drauf.
- `major_tournament_id String?` — optionales verknüpftes Major-Turnier.
- Relationen: `leaderboard LeaderboardEntry[]`, `faction_stats FactionStats[]`, `matchup_stats MatchupStats[]`.

### LeaderboardEntry
- `elo_rating Int @default(1200)` — Standard-ELO-Startwert.
- `total_points Float` — für Ranglisten-Sortierung; Index `[season_id, total_points(sort: Desc)]`.
- ~~`season_points Int`~~ — **ENTFERNT** (Migration `drop_welle2_mmr_deprecated`, Branch `chore/phase2-consolidation`). War Welle-2-MMR, abgelöst durch `total_points` (derive-on-read). Sortierung läuft über `total_points`.
- Unique-Constraint: `[user_id, season_id]`.

### ~~Welle-2-MMR-Models~~ — ENTFERNT (2026-06-03)
`FactionMastery`, `FactionMatchupStat`, `AntiFarmCap` + `LeaderboardEntry.season_points` + Enum `StatsSource` wurden per Migration `drop_welle2_mmr_deprecated` (Branch `chore/phase2-consolidation`) gedroppt. Ersetzt durch die gefitteten Parameter in `lib/rating-model.ts` bzw. den player-spezifischen OpponentShare-Modifier in `lib/scoring-service.ts`; Faction-vs-Faction-Daten leben in `MatchupStats`.

### Draft
- `status DraftStatus` — `PENDING | ONGOING | COMPLETED | CANCELLED`.
- `state Json` — vollständiger `DraftState` (Typdefinition in `packages/types/src/draft.ts`).
- `current_turn Int` — Index für aktuellen Turn-Step.
- `match_id String @unique` — 1:1 mit Match.
- Relationen: `events DraftEvent[]`, `preset DraftPreset`.

### DraftPreset
- `turns Json` — geordnetes Array von Pick/Ban/Snipe/Steal/Reveal-Aktionen.
- `category_limits Json` — Array von `{ category_name, factions[], max_picks, max_bans }`.
- `is_public Boolean` — steuert Sichtbarkeit in der Preset-Auswahl.
- Relationen: `tournaments Tournament[]`, `drafts Draft[]`.

### FactionStats
- `pick_count Int` + `ban_count Int` — separate Counters zusätzlich zu Wins/Losses.
- Unique-Constraint: `[faction_id, season_id]` — ein Datensatz pro Fraktion pro Saison.
- Kein Soft-Delete; Updates via `updatedAt`.

### MatchupStats
- `faction_a_wins Int` + `faction_b_wins Int` + `draws Int` — Grundlage der 24x24-Heatmap.
- Unique-Constraint: `[faction_a_id, faction_b_id, season_id]`.
- Richtungsabhängig: A vs. B ist ein anderer Datensatz als B vs. A.

---

## Enums

```prisma
enum Role {
  USER | ORGANIZER | MODERATOR | ADMIN
}

enum TournamentFormat {
  SWISS | SINGLE_ELIMINATION | DOUBLE_ELIMINATION | ROUND_ROBIN | DOUBLE_ROUND_ROBIN | LIECHTENSTEIN
}

enum TournamentMode {
  // OPEN entfernt (2026-06-05) — Migration 20260605000000_remove_open_mode
  ONE_V_ONE      // legacy 1v1
  THREE_V_THREE  // reserviert Phase 3
  BLIND_PICK     // legacy reserved
  BPT            // Default — Blind Pick Tournament (per-match blind faction pick)
  SFT            // Single Faction Tournament (faction pre-pick at registration, hidden until ONGOING)
  SLT            // Single List Tournament (army-list pre-upload at registration)
}

enum PlayoffFormat {
  NONE | TOP4 | TOP8         // Welle 2 — Host wählt im Setup. TOP8 nur bei ≥16 checked-in, Auto-Fallback TOP8→TOP4
}

enum MatchFormat {
  BO1 | BO3 | BO5            // Welle 2 — per Phase (Swiss / Playoffs / Finale) konfigurierbar
}

enum MapDecisionMode {
  RANDOM | PICK_BAN          // Welle 2 — Tournament-Setup; RANDOM = Server würfelt, PICK_BAN = 3-Map alternierend bannen
}

enum MatchPhase {
  GROUP_STAGE | SWISS | PLAYOFF_QF | PLAYOFF_SF | PLAYOFF_FINAL | PLAYOFF_THIRD_PLACE  // Welle 2 — Discriminator für Match.phase
}

// enum StatsSource — ENTFERNT (drop_welle2_mmr_deprecated); war nur FactionMatchupStat-Herkunft

enum TournamentStatus {
  DRAFT | OPEN_REGISTRATION | REGISTRATION_CLOSED | ONGOING | COMPLETED
}

enum TournamentVisibility {
  PUBLIC | PRIVATE
}

enum ParticipantStatus {
  REGISTERED | CHECKED_IN | DISQUALIFIED | WITHDREW
}

enum MatchStatus {
  PENDING | ONGOING | COMPLETED
  BYE     // system-generated walkover (ungerade Teilnehmerzahl)
  FORFEIT // organizer-triggered (No-Show / DQ)
}

enum FactionCategory {
  ORDER | DESTRUCTION | CHAOS_GODS | UNDEAD | DEFAULT
}

enum ArmyListFileType {
  ARMY_SETUP  // .army_setup Binary-Export
  SCREENSHOT
  TXT         // Plain-Text (M5.4)
  PDF         // PDF (M5.4)
}

enum DraftStatus {
  PENDING | ONGOING | COMPLETED | CANCELLED
}
```

---

## Migration-Workflow

Alle Befehle aus dem Workspace-Root über `pnpm --filter @rizzotto/db`:

| Zweck | Befehl (Root) |
|---|---|
| Dev-Migration erstellen | `pnpm db:migrate` |
| Prod/CI-Migration anwenden | `pnpm db:migrate:deploy` |
| Prisma-Client generieren | `pnpm db:generate` |
| Datenbank seeden | `pnpm db:seed` |
| Prisma Studio öffnen | `pnpm db:studio` (Default-Port 5555, in Schema nicht überschrieben) |

Das Seed-Script liegt bei `packages/db/prisma/seed.ts` und wird via `tsx` ausgeführt (konfiguriert in `prisma.config.ts` unter `migrations.seed`).

---

## Existierende Migrations

| Ordnername | Inhalt (kurz) |
|---|---|
| `20260512152148_init` | Initiales Schema (alle M1–M4-Models) |
| `20260513092053_m4_draft_event` | `DraftEvent`-Model hinzugefügt |
| `20260513115214_add_import_log` | `ImportLog`-Model hinzugefügt |
| `20260513140543_army_list_file_type_txt_pdf` | `TXT` und `PDF` Werte zu `ArmyListFileType` hinzugefügt |
| `20260513150000_add_onboarding` | Onboarding-Felder an `User` + `TournamentParticipant.lists_locked_at` |
| `20260519090818_beta_match_flow_plus_de` | Beta-Match-Flow (Q1/Q3/Q4/Q12), DE-Bracket-Felder, `MatchReport`, `BracketSide`, `MatchResultType` |
| `20260519122538_welle2_tournament_mechanics_and_mmr` | **Welle 2 (Plan 2 + Plan 3)** — Map, TournamentMapPool, MatchMapDecision, MatchBlindPick, TournamentArmyList, SteamLink, FactionMastery, FactionMatchupStat, AntiFarmCap, AdminConfig; neue Enums PlayoffFormat, MatchFormat, MapDecisionMode, StatsSource; TournamentMode +OPEN/BPT/SLT; Tournament +6 Felder (rounds_count, playoff_format, swiss_match_format, playoff_match_format, finale_match_format, map_decision_mode) |
| `20260519131859_welle2_d_integration_fields` | **Welle 2 (Plan D)** — `MatchPhase` enum + `Match.phase` nullable für Playoff-Discriminator; `LeaderboardEntry.season_points Int @default(0)` + compound DESC-Index für 3-Modi-Leaderboard |
| `20260601220129_dynamic_leaderboard_match_fields` | **Dynamic Leaderboard (Alex-Spec)** — `Match.season_id` (FK Season, ON DELETE SET NULL) + `played_at` + `ruleset`, Index `[season_id, status]`; **Backfill** bestehender COMPLETED-Matches (`played_at`←`updated_at`, `season_id`←Season-Datumsbereich) |
| `20260603000000_drop_welle2_mmr_deprecated` | **Phase-2-Cleanup** (Branch `chore/phase2-consolidation`) — DROP `FactionMastery`/`FactionMatchupStat`/`AntiFarmCap` + Spalte `LeaderboardEntry.season_points` (+Index) + Enum `StatsSource`. ⚠️ **Irreversibel** — Prod-Drop läuft beim Auto-Deploy nach `main`-Merge |
| `20260604000000_m7_match_game` | **M7** — `MatchGame`-Model + zugehörige Relations (Lobby-Code, Replay-URL, Winner, Status, FactionIDs); `MatchGame`-Status-Enum; `Match.reporterId`, `Match.confirmedAt` |
| `20260605000000_remove_open_mode` | **M7 Mode-Cleanup** — `OPEN` aus `TournamentMode`-Enum entfernt; bestehende OPEN-Rows per `UPDATE … SET mode='BPT'` migriert; Default von `OPEN` auf `BPT` geändert. **Muss vor dem nächsten Prod-Deploy via `pnpm db:migrate:deploy` appliziert werden** |
| `20260605054848_fix_enum_drift` | Auto-Drift-Fix — fehlende Column-Defaults (`MatchGame.id`, `MatchGame.updated_at`, `Tournament.finale_match_format`, `Tournament.playoff_match_format`) aus Migration-History-Inkonsistenz |
| `20260605095428_map_decision_modes` | Neue MapDecisionMode-Werte: `RANDOM_NO_REPEAT`, `HOST_PRESET`, `HOST_PRESET_PICK_BAN`, `RANDOM_PICK_BAN` |
| `20260606000000_external_game_archive` | `MatchGame.external_archive_url` für Replay-Links |
| `20260607074927_remove_elo` | `LeaderboardEntry.elo_rating` + `TournamentResult.elo_change` gedroppt |
| `20260607121006_add_liechtenstein_format` | `LIECHTENSTEIN` zu `TournamentFormat`-Enum |
| `20260607173753_add_third_place_match` | `Tournament.has_third_place_match Boolean @default(false)` + `PLAYOFF_THIRD_PLACE` zu `MatchPhase` |

Migrations-Lock unter `packages/db/prisma/migrations/migration_lock.toml`.

---

## Test-Pattern

Tests bauen die App ohne Redis und ohne Socket.IO — nur die echte PostgreSQL-DB wird genutzt.

Test-Helpers sind in `apps/backend/test/helpers/db-fixtures.ts`:

```ts
createTestUser()       // erstellt User mit randomUUID-basiertem discord_id
createTestSeason()     // erstellt Season mit eindeutigem name
createTestTournament() // erstellt Tournament mit eindeutigem slug
```

`randomUUID()`-basierte Namen stellen hermetisches Cleanup sicher: Jeder Test-Lauf erzeugt isolierte Datensätze, die sich nicht überschneiden. Cleanup erfolgt am Ende des Test-Runs per `DELETE WHERE` auf die bekannten UUIDs.
