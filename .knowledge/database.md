> Read-when: Schema-Frage, neues Model, Migration nötig, Prisma-Setup, Seeding.

**TL;DR:**
- Prisma 7 (`^7.8.0`) mit driver-adapter `PrismaPg` aus `@prisma/adapter-pg` — kein nativer Prisma-Connection-String-Modus.
- 20 Models in `packages/db/prisma/schema.prisma` (User, Faction, Tournament, TournamentFactionAllowlist, TournamentParticipant, Match, Team, TeamMember, Season, LeaderboardEntry, TournamentResult, ArmyList, FactionStats, FactionStatsSnapshot, MatchupStats, DraftPreset, Draft, DraftEvent, AuditLog, ImportLog).
- **Gotcha:** `datasource.url` steht NICHT in `schema.prisma`, sondern in `prisma.config.ts` — `schema.prisma` enthält nur `provider = "postgresql"`.

---

## Setup

Import im gesamten Monorepo:

```ts
import { prisma } from '@tww3/db';
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
- `status MatchStatus` — `PENDING | ONGOING | COMPLETED | BYE | FORFEIT`.
- `next_match_id String?` — Selbstreferenz (`BracketProgression`) für Bracket-Traversal.
- `deleted_at DateTime?` — Soft-Delete.
- Relationen: `player1/player2 User?`, `winner User?`, `draft Draft?`, `feeder_matches Match[]`.

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
- Unique-Constraint: `[user_id, season_id]`.

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
  SWISS | SINGLE_ELIMINATION | DOUBLE_ELIMINATION | ROUND_ROBIN | DOUBLE_ROUND_ROBIN
}

enum TournamentMode {
  ONE_V_ONE
  THREE_V_THREE  // reserviert Phase 3
  BLIND_PICK     // reserviert Phase 3
  SFT            // Single Faction Tournament, reserviert Phase 3
}

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

Alle Befehle aus dem Workspace-Root über `pnpm --filter @tww3/db`:

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
