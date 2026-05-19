# Welle 2 — Plan 3: Admin-Dashboard + Live-Settings + MMR-Foundation

> **Status:** Geplant 2026-05-19 (Alex-Briefing). Parallelitätsklasse C — startet nach Schema-Init parallel zu Plan 2 Backend.
>
> **Master-Plan:** [`commands-f-r-das-neue-starry-hare.md`](../../../.claude/plans/commands-f-r-das-neue-starry-hare.md)
>
> **Sibling-Pläne:** [Plan 1 – Branding & Voice](./welle2-plan1-branding.md) · [Plan 2 – Tournament-Mechanik](./welle2-plan2-tournament-mechanics.md)

## Context

Alex' Briefing zu Admin + Stats + MMR:

- **Admin-Dashboard ist zu dünn.** Aktuell nur User-Count + Tournament-Count + Top-5-Factions by Pick-Count. Alex will:
  - **Faction Win-Rates** (mit Season/Format-Filter)
  - **ELO-Verteilung** (Histogram)
  - **Drop-off Funnel** (Registered → Checked-in → Finished)
  - **Pick/Ban-Stats** (Maps + Factions, mit Win-Rates)
- **Live-Configurables fehlen.** Alex will Settings selbst pflegen ohne Code-Commit:
  - **Map-Pool-Editor** (Add/Remove/Rename Maps — 35 Maps + neue Releases)
  - **Faction-Management** (Add/Edit + Sigil-Upload — z.B. neue Factions oder bei DLCs)
  - **Default-Tournament-Settings** (Rundenzahl, Match-Format pro Phase, Tiebreaker-Order)
  - **Feature-Flags** (Arena on/off, SLT on/off, etc.)
- **Personal-Stats fehlen im Profil.** Alex' Vorlage: TotalTavern-Style 2-Spalten-Layout (Faction-Win-Rate-Tabelle global + Per-Faction-Matchup-Tabelle). Aktuell zeigt das Profil nichts ausser Onboarding-Status. Bis eigene Daten reichen → Seed-Import aus `totaltavern.com/factionstatistics`.
- **Globales Leaderboard mit 3 Tabs:** Win-Rate / Season-Punkte / Gewichtete Win-Rate. Letztere abhängig vom MMR-Modell.
- **MMR-Redesign — Konzept:**
  - **Keine Punkte-Verluste** (Loss = 0 delta, kein negatives ELO). "Animiert zum Spiel."
  - **Win-Quality-skaliert:** Billiger Sieg = wenig, harter Sieg = viel.
  - **Drei Faktoren:**
    1. Faction-Mastery Spieler 1 (wie gut bist du in deiner Faction)
    2. Faction-Mastery Spieler 2 (wie gut ist Gegner in seiner Faction)
    3. Faction-Matchup-Win-Rate (wie sieht das Matchup global aus)
  - **Globaler MMR weniger gewichten** — Anti-One-Trick-Pony-Logik.
  - **Anti-Farming:** Pro `(Spieler-Paar × Faction-Combo × Season)` ein Punkte-Cap. Wenn Cap erreicht: keine weiteren Punkte aus dieser Combo. Tournaments ignorieren den Cap.
  - **Faction-Mastery persistent** (kein Season-Reset). **Faction-Matchup-Win-Rates** resetten pro Season (Meta ändert sich durch Patches).
  - **TotalTavern als Seed-Quelle:** Scrapen jetzt als Initial-Data, 50/50 Hybrid bis eigene Daten reichen (500 Matches), dann nur eigene.
  - **Anzeige:** Im Leaderboard nur Season-Punkte sichtbar. Faction-Mastery intern für Matchmaking, nur im eigenen Profil sichtbar.

## Scope

### 3.1 Prisma-Schema-Erweiterung

```prisma
model FactionMastery {
  user_id        String
  faction_id     String
  rating         Int      @default(1200)
  games_played   Int      @default(0)
  wins           Int      @default(0)
  losses         Int      @default(0)
  last_played_at DateTime?
  user           User     @relation(fields: [user_id], references: [id])
  faction        Faction  @relation(fields: [faction_id], references: [id])
  @@id([user_id, faction_id])
}

enum StatsSource { TT_SEED OWN_DATA HYBRID }

model FactionMatchupStat {
  season_id      String
  faction_a_id   String
  faction_b_id   String
  wins           Int          @default(0)
  losses         Int          @default(0)
  win_rate       Decimal      @default(0.5) @db.Decimal(5, 4)
  source         StatsSource  @default(TT_SEED)
  confidence     Decimal      @default(0.5) @db.Decimal(3, 2)
  updated_at     DateTime     @updatedAt
  season         Season       @relation(fields: [season_id], references: [id])
  faction_a      Faction      @relation("FactionA", fields: [faction_a_id], references: [id])
  faction_b      Faction      @relation("FactionB", fields: [faction_b_id], references: [id])
  @@id([season_id, faction_a_id, faction_b_id])
}

model AntiFarmCap {
  season_id      String
  player_a_id    String
  player_b_id    String
  faction_a_id   String
  faction_b_id   String
  points_earned  Int      @default(0)
  max_cap        Int      @default(200)
  updated_at     DateTime @updatedAt
  season         Season   @relation(fields: [season_id], references: [id])
  @@id([season_id, player_a_id, player_b_id, faction_a_id, faction_b_id])
}

model AdminConfig {
  key         String   @id
  value       Json
  updated_by  String?
  updated_at  DateTime @updatedAt
}
```

**Wichtige AdminConfig-Keys:**

| Key | Value-Typ | Default |
|-----|-----------|---------|
| `map_pool_default_size` | int | 5 |
| `default_tournament_settings` | object | `{ rounds_count: 5, playoff_format: 'NONE', swiss_match_format: 'BO1', map_decision_mode: 'PICK_BAN' }` |
| `feature_flags` | object | `{ arena: false, slt: true, bpt: true, sft: true }` |
| `welcome_banner_text` | string (Markdown) | `""` |
| `season_active` | string (Season-ID) | currently active |
| `discord_announce_channel_id` | string | aus ENV initial |
| `discord_announce_role_id` | string? | null |
| `mmr_base_points_tournament` | int | 100 |
| `mmr_base_points_casual` | int | 50 |
| `mmr_max_cap_per_combo` | int | 200 |
| `mmr_mastery_threshold_games` | int | 10 |

### 3.2 Backend

**TT-Scraper** (`apps/backend/src/lib/tt-scraper.ts` NEU)
- Crawled `totaltavern.com/factionstatistics`
- Da JS-rendered: Playwright-Headless-Browser-Crawler (Chromium, Page.goto, wait-for-table-selector, extract DOM)
- Alternative: Manual-JSON-Export einmalig, im Repo committen unter `packages/db/prisma/seed-data/tt-faction-stats-snapshot-<date>.json`
- Cron monthly: re-fetch + diff + persist
- Initial-Output: `seedFactionMatchupStats(season_id, snapshot)` schreibt in `FactionMatchupStat` mit `source=TT_SEED, confidence=0.5`
- 35 Maps (von Alex) bekommen kein TT-Seed — Maps haben keine Cross-Stats auf TT.

**MMR-Library** (`apps/backend/src/lib/mmr.ts` NEU)

```typescript
async function computeWinPoints({
  winner, loser, winnerFaction, loserFaction,
  isTournament, isMajor,
  matchupStat, winnerMastery, loserMastery,
  antiFarmCap
}): Promise<number> {
  const BASE = isTournament
    ? await getAdminConfig('mmr_base_points_tournament', 100)
    : await getAdminConfig('mmr_base_points_casual', 50);
  const MAJOR_BONUS = isMajor ? 1.5 : 1.0;

  // Win-Quality basiert auf den 3 Faktoren
  const matchupWinrateForWinner = matchupStat.win_rate; // 0.0-1.0
  const opponentMasteryFactor = loserMastery
    ? Math.min(1.5, loserMastery.rating / 1500)
    : 1.0;
  const myMasteryDampener = winnerMastery
    ? Math.max(0.5, 1.0 - (winnerMastery.rating - 1200) / 2000)
    : 1.0;

  const winQuality = (1 - matchupWinrateForWinner)
                   * opponentMasteryFactor
                   * myMasteryDampener;

  // Anti-Farming-Modifier (Tournaments ignorieren Cap)
  const antiFarmModifier = isTournament
    ? 1.0
    : Math.max(0, (antiFarmCap.max_cap - antiFarmCap.points_earned) / antiFarmCap.max_cap);

  const points = Math.max(0, Math.round(BASE * MAJOR_BONUS * winQuality * antiFarmModifier));

  return points;
}
```

**Hooks** (in `apps/backend/src/routes/matches.ts` Match-Result-Endpoint):
- Nach Match-Complete: `computeWinPoints` → `LeaderboardEntry.season_points += points` (für Winner) → `FactionMastery.games_played + wins` (für Winner) + `+ games_played + losses` (für Loser) → `FactionMatchupStat.wins/losses` (Season-Stats) → `AntiFarmCap.points_earned`-Increment (für Casual-Matches)

**Admin-API-Erweiterung** (`apps/backend/src/routes/admin.ts`)

Stats-Endpoints:
- `GET /api/admin/stats/faction-winrates?season=…&format=…&mode=…&period=…`
  - Aggregat: `SELECT faction_id, COUNT(wins), COUNT(losses), AVG(elo_gain) FROM matches WHERE …`
  - Filter: Season-ID, Tournament-Format (Swiss/SE/DE/RR), Tournament-Mode (OPEN/BPT/SFT/SLT), Period (last_30d/90d/season)
  - Response: `Array<{ faction_id, slug, name, wins, losses, win_rate, avg_elo_gain, sample_size }>`
- `GET /api/admin/stats/elo-distribution?season=…`
  - Histogram: bucketize `LeaderboardEntry.elo_rating` in 50-Punkte-Buckets
  - Response: `Array<{ bucket_start, bucket_end, count, median, top1_percent, bottom_tail }>`
- `GET /api/admin/stats/dropoff-funnel?tournament_id=…`
  - Counts: `registered`, `checked_in`, `played_round_1`, `played_final_round`, `finished`
  - Optional: `?season=…` für Aggregate über Season
- `GET /api/admin/stats/pickban-stats?season=…&entity=maps|factions`
  - Pick-Counts + Ban-Counts + Win-Rates pro Entity
  - Response: `Array<{ entity_id, slug, name, picks, bans, pick_rate, ban_rate, win_when_picked }>`

CRUD-Endpoints für Live-Settings:
- `GET / POST / PATCH / DELETE /api/admin/maps[/:id]` — Map-Pool-Editor
- `GET / POST / PATCH /api/admin/factions[/:id]` + `POST /api/admin/factions/:id/sigil` (multipart) — Faction-Management + Sigil-Upload
- `GET / PUT /api/admin/config/:key` — Generic Key-Value-Editor
- `GET /api/admin/config/all` — alle Configs für Settings-UI

**Bug-Fix Users-Search** (`apps/backend/src/routes/users.ts`)
- Neuer Handler: `GET /api/users?search=<query>` — Volltextsuche auf `username` + `discord_id`
- Validation: Min 2 Zeichen, Max 50
- Auth-Required (Admin-only via `fastify.requireRole('admin')`)
- Pagination: `?page=1&limit=20`
- Wird in `UserBanTab` aktuell aufgerufen aber existiert nicht → kaputter Admin-Tab fixen.

**Personal-Stats-Endpoint** (`apps/backend/src/routes/users.ts`)
- `GET /api/users/:id/stats?season=…`
- Response:
  - `Match-History` (letzte 20 mit Tournament-Slug, Opponent, Score, Faction, Map)
  - `Win/Loss-Total`
  - `Per-Faction Win-Rate` (eigene Daten oder TT-Seed-Fallback bei <10 Matches)
  - `ELO-History` (TimeSeries für LineChart)
  - `Faction-Mastery-Top-5` (sortiert nach Rating, nur visible für eigenes Profil)

**Leaderboard-3-Tabs-Endpoints** (`apps/backend/src/routes/leaderboard.ts` Erweiterung)
- `GET /api/leaderboard?mode=winrate&season=…` — Sorted by `wins/total`
- `GET /api/leaderboard?mode=season_points&season=…` — Sorted by `season_points` (Default)
- `GET /api/leaderboard?mode=weighted_winrate&season=…` — Sorted by Win-Rate gewichtet mit `Σ(opponent_faction_mastery + matchup_difficulty)`

### 3.3 Frontend

**Admin-Page-Erweiterung** (`apps/frontend/src/routes/AdminPage.tsx`)
- 4 Tabs bleiben (dashboard, audit, users, presets) + neue Tabs: `stats`, `settings`
- Im `stats`-Tab: 4 Charts via Recharts
- Im `settings`-Tab: 5 Editors

**Charts:**
- `apps/frontend/src/components/admin/FactionWinRatesChart.tsx` (NEU) — Tabelle + BarChart side-by-side
- `apps/frontend/src/components/admin/EloDistributionChart.tsx` (NEU) — Histogram (Recharts BarChart mit kontinuierlichen Buckets)
- `apps/frontend/src/components/admin/DropOffFunnelChart.tsx` (NEU) — Funnel (custom oder Recharts AreaChart inverted)
- `apps/frontend/src/components/admin/PickBanStatsChart.tsx` (NEU) — Stacked Bar (Pick-Anteil + Ban-Anteil) + Win-Rate-Line-Overlay

**Editors:**
- `apps/frontend/src/components/admin/MapPoolEditor.tsx` (NEU) — Drag-Drop-Sortable, Inline-Edit-Name/Description, Image-Upload pro Map, Soft-Delete-Button
- `apps/frontend/src/components/admin/FactionManager.tsx` (NEU) — Add/Edit-Faction-Modal, Sigil-Upload (PNG/WebP/AVIF-Pipeline via sharp)
- `apps/frontend/src/components/admin/TournamentDefaultsEditor.tsx` (NEU) — Default-Settings pro Format (Swiss/SE/DE/RR)
- `apps/frontend/src/components/admin/FeatureFlagsPanel.tsx` (NEU) — Toggles für Arena, SLT, BPT, SFT
- `apps/frontend/src/components/admin/WelcomeBannerEditor.tsx` (NEU) — Markdown-Editor mit Live-Preview

**Leaderboard 3-Tab-Variante** (`apps/frontend/src/routes/Leaderboard.tsx`)
- TabBar: Win-Rate / Season-Punkte / Gewichtete Win-Rate
- Search-Param `?tab=…` für Deep-Links
- Default-Tab = Season-Punkte

**User-Profile Personal-Stats** (`apps/frontend/src/routes/UserProfile.tsx`)
- Nach Onboarding-Status-Block: neue Section "Statistics"
- 4 Cards:
  1. Win/Loss-Total + Win-Rate (mit Trend-Arrow)
  2. ELO-Verlauf LineChart (last 90d)
  3. Match-History last 20 (Table)
  4. Per-Faction Win-Rate Top-5 (linked zu Faction-Detail-Page) — initialisiert via TT-Seed bis 10+ eigene Matches pro Faction

## Critical Files

- `packages/db/prisma/schema.prisma` — neue Tabellen (FactionMastery, FactionMatchupStat, AntiFarmCap, AdminConfig)
- `apps/backend/src/lib/tt-scraper.ts` (NEU)
- `apps/backend/src/lib/mmr.ts` (NEU)
- `apps/backend/src/routes/admin.ts` — Stats + CRUD-Erweiterungen
- `apps/backend/src/routes/users.ts` — Search-Bug-Fix + Personal-Stats
- `apps/backend/src/routes/leaderboard.ts` — 3-Tab-Modi
- `apps/backend/src/routes/matches.ts` — Match-Complete-Hook für MMR-Update
- `apps/frontend/src/routes/AdminPage.tsx` — neue Tabs
- `apps/frontend/src/components/admin/*Chart.tsx` (4 NEU)
- `apps/frontend/src/components/admin/*Editor.tsx` (5 NEU)
- `apps/frontend/src/routes/Leaderboard.tsx` — 3-Tab
- `apps/frontend/src/routes/UserProfile.tsx` — Personal-Stats-Block

## Dependencies

- **Welle A.3 (TT-Scraper Standalone)** kann am Tag 1 parallel laufen, kein Schema-Dep — Output ist JSON-Snapshot.
- **Welle B.3 (Admin-API + MMR-lib)** braucht Schema von Welle A.2 (Plan 2).
- **Welle C.2 (Admin-UI + Personal-Stats)** braucht Backend-API von Welle B.3.

## Verification

1. **TT-Scraper-Output:** JSON-Snapshot validiert (35 Maps + alle Factions + Matchup-Win-Rates).
2. **MMR-Library Unit-Tests:**
   - Faction-Mastery-Threshold-Edge-Case (9 Games → Pre-Threshold, 10 Games → aktiv)
   - Anti-Farming-Cap-Erreichung (Match 5 ist 0 Punkte)
   - Tournament-Match ignoriert Cap (immer voll)
   - No-Loss-Modus (Loser bekommt 0)
   - Major-Tournament-Multiplier (1.5x)
3. **Admin-API-Smoke-Tests:**
   - `GET /api/admin/stats/faction-winrates` mit Filter → JSON
   - `POST /api/admin/maps` legt neue Map an → erscheint in `GET /api/maps`
   - `PATCH /api/admin/config/feature_flags` → Frontend zeigt nach Refresh entsprechende Tabs an/aus
   - `GET /api/users?search=alex` → liefert User-Liste
4. **Personal-Stats-Endpoint:**
   - Eigener User mit <10 Matches pro Faction → Faction-WinRate via TT-Seed
   - Eigener User mit ≥10 Matches pro Faction → eigene Daten
5. **Leaderboard 3-Tabs:** alle 3 Modi liefern korrekt sortierte Listen.
6. **Frontend-Manual:**
   - Admin-Dashboard zeigt alle 4 Charts mit Live-Daten
   - Map-Pool-Editor: Add/Edit/Delete funktioniert
   - Faction-Sigil-Upload: PNG → WebP/AVIF generiert, im Header sichtbar
   - User-Profile: Stats-Block rendert
7. **Bug-Fix Verification:** UserBan-Tab im Admin funktioniert wieder (Search liefert Treffer).
8. **TypeCheck/Lint/Test:** `pnpm typecheck && pnpm lint && pnpm test` clean.

## Sub-Agent-Briefs

**Welle A.3 — TT-Scraper Standalone (Sub-Agent SA3):**
```
Lies zuerst CLAUDE.md.

Implementiere docs/roadmap/welle2-plan3-admin-stats-mmr.md §3.2 TT-Scraper als Standalone-Skript:
- apps/backend/src/lib/tt-scraper.ts mit Playwright-Headless-Crawler
- Crawled https://totaltavern.com/factionstatistics
- Output: JSON-Snapshot mit Global-Faction-Stats + Per-Faction-Matchup-Matrix
- Commit als packages/db/prisma/seed-data/tt-faction-stats-snapshot-2026-05.json

Falls Playwright-Browser nicht installiert: Pre-Step pnpm dlx playwright install chromium ausführen.

Kein DB-Touch in dieser Welle — nur JSON-Export. Seeding kommt in Welle B.3.

Sonnet.
```

**Welle B.3 — Admin-API + MMR-lib (Sub-Agent SB3):**
```
Lies zuerst CLAUDE.md, .knowledge/backend-architecture.md, .knowledge/algorithms.md, .knowledge/database.md.

Implementiere Plan 3 Backend aus docs/roadmap/welle2-plan3-admin-stats-mmr.md §3.2 (alle außer TT-Scraper — schon in A.3):
- lib/mmr.ts (computeWinPoints mit 3-Faktor-Formel)
- routes/admin.ts Erweiterung (4 Stats-Endpoints + CRUD für Maps/Factions/Config)
- routes/users.ts Bug-Fix /api/users?search + Personal-Stats
- routes/leaderboard.ts 3-Tab-Modi
- routes/matches.ts Hook für MMR-Update + AntiFarmCap-Increment
- Seed-Skript für FactionMatchupStat aus TT-Snapshot

Caching via cached() für Read-Heavy Endpoints.

Unit-Tests für mmr.ts edge cases.

Sonnet.
```

**Welle C.2 — Admin-UI + Personal-Stats (Sub-Agent SC2):**
```
Lies zuerst CLAUDE.md, .knowledge/frontend-patterns.md, docs/design/README.md.

Implementiere Frontend aus docs/roadmap/welle2-plan3-admin-stats-mmr.md §3.3:
- 4 Charts (FactionWinRatesChart, EloDistributionChart, DropOffFunnelChart, PickBanStatsChart) via Recharts
- 5 Editors (MapPoolEditor, FactionManager, TournamentDefaultsEditor, FeatureFlagsPanel, WelcomeBannerEditor)
- Leaderboard.tsx mit 3 Tabs via Search-Param
- UserProfile.tsx Personal-Stats-Section mit 4 Cards

Dark-only, shadcn/ui + motion + Recharts.

Sonnet.
```

## Phase-2-Erweiterungen (NICHT jetzt)

- **MMR-Display-Refinement:** Tier-System (Bronze/Silver/Gold/Master) statt nackter Zahlen, Faction-Mastery im Public-Profil sichtbar
- **Faction-Mastery-Leaderboard** pro Faction (Top-10 Empire-Spieler etc.)
- **Match-Caster-Stats** für Cast-Overlays
- **Player-Activity-Heatmap** (Tageszeit × Wochentag) — gestrichen aus Welle 2 da niedrig-priority
- **Live-Settings: Welcome-Banner-Editor** ist Phase-1-Stretch (kann in Welle D nachgereicht werden falls Timeline knapp)
