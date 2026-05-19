# Welle 2 — Plan 2: Tournament-1 Mechanik (Kritischer Pfad)

> **Status:** Geplant 2026-05-19 (Alex-Briefing). Parallelitätsklasse B — DB-Schema first → Backend parallel → Frontend → E2E. **Kritischer Pfad für Tournament-1-Launch Anfang Juli 2026.**
>
> **Master-Plan:** [`commands-f-r-das-neue-starry-hare.md`](../../../.claude/plans/commands-f-r-das-neue-starry-hare.md)
>
> **Sibling-Pläne:** [Plan 1 – Branding & Voice](./welle2-plan1-branding.md) · [Plan 3 – Admin & Stats & MMR](./welle2-plan3-admin-stats-mmr.md)

## Context

Alex hat den vollständigen Tournament-1-Spec geliefert:

- **Steam-Pflichtverlinkung** als Hard-Gate nach Discord-Login. Ban-Evade-Schutz + Vorbereitung für Arena-Queue-Skip.
- **Match-Decision-Flow direkt vor jedem Match:**
  1. Coin-Flip → Top/Bottom-Designation
  2. Map-Decision: entweder `RANDOM` (System würfelt aus Pool) oder `PICK_BAN` (Top bannt 1, Bottom bannt 1, übrig = picked). Modus wird vom Organizer im Tournament-Setup gewählt.
  3. Blind-Faction-Pick: beide Spieler simultan, Lock-In, Reveal nach beidseitigem Lock.
  4. Match startet.
  - Bei Bo3/Bo5-Playoffs: **pro Game** neuer Map-Pick/Ban-Zyklus.
  - Live Socket-Sync, UI inspiriert von aoe2cm.net.
- **Tournament-Modi** (im Konfigurator wählbar):
  - `OPEN` — keine Restriktion (Default, Casual)
  - `BPT` — Blind Pick Tournament: jedes Match hat Blind-Faction-Pick
  - `SFT` — Single Faction Tournament: Faction-Pre-Pick bei Registrierung, Reveal erst nach Tournament-Start
  - `SLT` — Single List Tournament: Army-List-Pre-Upload bei Registrierung (`.army_setup`-Datei + Screenshot). Reveal-Logic:
    - Lock bis 1 Sekunde vor Tournament-Start
    - Nach abgeschlossenem Match: Gegner sieht Liste (zusammen mit Admin)
    - Nach Tournament-Complete: alle Listen werden öffentlich
- **Swiss-Engine:** Host wählt Rundenzahl (3-6). Tiebreaker-Hierarchie: Buchholz → Solkoff → Head-to-Head (kein ELO).
- **Playoffs:** Host wählt `NONE` / `TOP4` / `TOP8` im Setup. `TOP8` nur verfügbar wenn ≥16 verbleibende Spieler bei Playoff-Start. Bei Drop-out unter 16 → Auto-Fallback `TOP8 → TOP4`.
- **Match-Format pro Phase:** Host wählt frei (Swiss: Bo1/Bo3, Playoffs: Bo3/Bo5, Finale: Bo3/Bo5).
- **Map-Pool:** 35 Maps von Alex (siehe unten). Admin-pflegbar via Live-Settings (Plan 3). Tournament-Pool wird beim Create als **Snapshot** kopiert (Min 3 / Max 35). Spätere globale Edits berühren laufende Tournaments nicht.
- **Check-in:** Self-Service, 1h vor `start_date` öffnet via Cron, schließt 1 Sekunde vor `start_date`. Nicht eingecheckte Spieler werden in Round-1-Pairing nicht berücksichtigt.
- **Discord-Notifications** (4 Trigger): Tournament-Announce, Check-in-Reminder (DM), Round-Pairing (Channel + DM), Match-Dispute (Organizer-DM).
- **Dispute-Resolution:** Organizer + Moderator + Admin (bisheriger Stand bleibt).

## Scope

### 2.1 Prisma-Schema-Migration

**Neue Tabellen** (`packages/db/prisma/schema.prisma`):

```prisma
model Map {
  id          String   @id @default(cuid())
  slug        String   @unique
  name        String
  description String?
  image_url   String?
  deleted_at  DateTime?
  created_at  DateTime @default(now())
  updated_at  DateTime @updatedAt
}

model TournamentMapPool {
  tournament_id String
  map_id        String
  tournament    Tournament @relation(fields: [tournament_id], references: [id])
  map           Map        @relation(fields: [map_id], references: [id])
  @@id([tournament_id, map_id])
}

enum MapDecisionMode { RANDOM PICK_BAN }

model MatchMapDecision {
  match_id          String        @id
  match             Match         @relation(fields: [match_id], references: [id])
  game_index        Int           @default(0)  // für Bo3/Bo5 (Game 1=0, Game 2=1, …)
  mode              MapDecisionMode
  coin_flip_seed    String
  top_player_id     String
  bottom_player_id  String
  bans_top          String[]      // Map-IDs gebannt von Top
  bans_bottom       String[]      // Map-IDs gebannt von Bottom
  picked_map_id     String?
  decided_at        DateTime?
}

model MatchBlindPick {
  match_id              String   @id
  match                 Match    @relation(fields: [match_id], references: [id])
  game_index            Int      @default(0)
  player1_faction_id    String?
  player2_faction_id    String?
  player1_locked_at     DateTime?
  player2_locked_at     DateTime?
  revealed_at           DateTime?
}

model ArmyList {
  tournament_id              String
  user_id                    String
  tournament                 Tournament @relation(fields: [tournament_id], references: [id])
  user                       User       @relation(fields: [user_id], references: [id])
  file_url                   String?    // .army_setup
  screenshot_url             String     // primary
  parsed_json                Json?
  locked_at                  DateTime?
  revealed_to_opponents_at   DateTime?
  revealed_publicly_at       DateTime?
  @@id([tournament_id, user_id])
}

model SteamLink {
  user_id      String   @unique
  steam_id     String   @unique
  persona      String
  avatar_url   String?
  profile_url  String?
  verified_at  DateTime @default(now())
  user         User     @relation(fields: [user_id], references: [id])
}
```

**Tournament-Erweiterung:**

```prisma
enum PlayoffFormat { NONE TOP4 TOP8 }
enum MatchFormat   { BO1 BO3 BO5 }
enum MapDecisionMode { RANDOM PICK_BAN }

model Tournament {
  // … bestehende Felder …
  rounds_count           Int             @default(5)  // 3-6 via Constraint
  playoff_format         PlayoffFormat   @default(NONE)
  swiss_match_format     MatchFormat     @default(BO1)
  playoff_match_format   MatchFormat     @default(BO3)
  finale_match_format    MatchFormat     @default(BO3)
  map_decision_mode      MapDecisionMode @default(PICK_BAN)
  map_pool               TournamentMapPool[]
  army_lists             ArmyList[]
}
```

**TournamentMode-Enum-Aktivierung:**

```prisma
enum TournamentMode {
  OPEN           // neuer Default
  ONE_V_ONE
  THREE_V_THREE
  BPT            // war "reserved for Phase 3"
  SFT
  SLT            // neu
}
```

**Backfill bestehende Tournaments:**
- `rounds_count = 5`
- `playoff_format = NONE`
- `swiss_match_format = BO1`
- `playoff_match_format = BO3`
- `map_decision_mode = PICK_BAN`
- Bestehende `ONE_V_ONE`-Tournaments bleiben, neuer Default für neue ist `OPEN`.

**Map-Pool Initial-Seed** (`packages/db/prisma/seed.ts`):

35 Maps von Alex:
> Jade Tomb, Rapturous Expanse, Chateau De Roquefort, Hashut's Oilfields, Norscan Rise, Bray Valley, Proving Grounds, Dustbowl, Whirling Maelstrom, Dunes of Khaine, Aracknarock Lair, Crystal Lake, The Changer's Madhouse, Rift at Worlds Edge, Imperial Road, Lost Temple of Sotek, Dried Floodplain, Bleakspire Labor Camp, Glinty Toof's Crag, Skjlanadir's Cave, Khsar's Cursed Oasis, Putrefying Carcass, Blazing Ramparts, Creeping Swamp, Imperial Ambush, Decrepit Moor, Haunted Vale, Bordeleaux Landing, Glades of the Everqueen, Eastern Isle Colony, Edge of the Darkwood, Altar of the Champion, Road to Talabheim, Itza, The Blood Grove, Celestial Lake

### 2.2 Backend-Routes

**Maps** (`apps/backend/src/routes/maps.ts` NEU)
- `GET /api/maps` — public, listet alle aktiven Maps
- `POST /api/admin/maps`, `PATCH /api/admin/maps/:id`, `DELETE /api/admin/maps/:id` (Soft-Delete) — Admin-only via Live-Settings (siehe Plan 3)

**Match-Decision** (`apps/backend/src/routes/match-decision.ts` NEU)
- `POST /api/matches/:id/decision/start` — initialisiert Coin-Flip (`crypto.randomBytes`), persistiert `MatchMapDecision` mit Top/Bottom, emit `match.decision.started` an beide Spieler via Socket.IO
- `POST /api/matches/:id/decision/ban` body `{ map_id }` — alternierender Ban-Flow, Validation: nur aktueller Spieler darf bannen, nur Map aus TournamentMapPool, Mode muss `PICK_BAN` sein
- `POST /api/matches/:id/decision/random` — bei `mode=RANDOM`: Server würfelt deterministisch (mit `coin_flip_seed`) aus `TournamentMapPool`, persistiert `picked_map_id`
- `POST /api/matches/:id/decision/blind-pick/lock` body `{ faction_id }` — Player lockt Faction, beim beidseitigen Lock automatischer Reveal + Socket-Event
- Socket-Events: `match.decision.update` (Phase + Turn + Time-Remaining), `match.decision.complete`

**Army-Lists** (`apps/backend/src/routes/army-lists.ts` NEU)
- `POST /api/tournaments/:slug/army-list` (multipart: `file` `.army_setup` + `screenshot` PNG/JPG) — speichert ArmyList, parsed_json via Parser
- `GET /api/tournaments/:slug/army-lists/me` — eigene Liste anschauen vor Lock
- `GET /api/tournaments/:slug/army-lists/:opponent_id` — Gegner-Liste nach Match-Complete (Reveal-Check)
- `GET /api/tournaments/:slug/army-lists/all` — alle Listen nach Tournament-Complete

**Army-Setup-Parser** (`apps/backend/src/lib/army-setup-parser.ts` NEU)
- Decoder für TWW3-Format. `.army_setup` ist binary mit Header-Magic + UTF-16-Strings. Reverse-Engineering aus Alex' Beispiel-File `c:\Users\Luke\Desktop\last_setup_for_wh2_main_hef_high_elves_domination.army_setup`.
- Fallback bei Parse-Fehler: Plain-Text-Extraction (utf-16-LE Strings extrahieren, Faction-Slug + Unit-Names heuristisch matchen).
- Return-Type: `{ faction: string; units: Array<{ name: string; count: number }>; total_points: number }`
- Test-Fixture: `apps/backend/test/fixtures/sample.army_setup`

**Swiss-Tiebreaker-Extension** (`apps/backend/src/lib/swiss.ts:178`)
- Aktuell: `sort by score desc, buchholz desc`
- Neu: `sort by score desc, buchholz desc, solkoff desc, headToHeadWinner desc`
- `solkoff` = Buchholz minus höchster und niedrigster Opponent-Score
- `headToHeadWinner` = bei 2 Spielern mit allen vorherigen Tiebreakern gleich: wer hat das direkte Match gewonnen
- Update `SwissStanding`-Interface in `@rizzotto/types`

**Playoff-Generator** (`apps/backend/src/lib/playoff-generator.ts` NEU)
- `generatePlayoffBracket(tournament, finalStandings) → Match[]`
- `playoff_format=NONE`: kein Bracket, Swiss-Standings = Final
- `playoff_format=TOP4`: Top-4 Standings, Single-Elimination Bo3 (oder configured `playoff_match_format`), Seed 1v4 + 2v3
- `playoff_format=TOP8`: Validation `tournament.checked_in_count >= 16`. Falls nicht → Auto-Fallback auf TOP4. Top-8 SE-Bracket mit Seed 1v8 / 4v5 / 3v6 / 2v7
- Drop-out-Check 1h vor Playoff-Start: wer nicht eingecheckt war → ausgeschlossen
- Per-Game Map-Pick (jedes Bo3-Game neuer `MatchMapDecision` mit `game_index`)

**Steam-OpenID** (`apps/backend/src/routes/auth.ts` Erweiterung)
- `GET /auth/steam/login?return_to=/tournaments` — initialisiert OpenID-2.0 Discovery, redirect zu Steam-Login mit Callback-URL
- `GET /auth/steam/return` — verifiziert Steam-OpenID-Signature, Persist `SteamLink`, redirect zurück
- Steam-OpenID 2.0 ist Legacy — Manual-Implementation (kein gepflegtes Package mit aktuellem Status). Recherche zu `openid-client` (v6+, OpenID-Connect-Library, OpenID-2.0-Support kontrollieren).

**Hard-Gate** (`apps/backend/src/plugins/auth.ts`)
- Neuer PreHandler: nach `authenticate`, prüfe `req.user.steam_link != null`
- Bei null → 403 `{ code: 'STEAM_REQUIRED', message: 'Connect Steam to continue' }`
- Whitelist: `/auth/steam/*`, `/auth/logout`, `/api/users/me` (für initial-state-fetch)

**Check-in-Cron** (`apps/backend/src/plugins/cron.ts`)
- Neuer Cron `*/5 * * * *` (alle 5 min)
- Pro `Tournament` mit `status=ANNOUNCED` und `start_date - 1h <= now() < start_date`:
  - Setze `checkin_open_at = now()` falls null
  - Trigger `notifyCheckInReminder()` (Discord) einmalig
- Pro `Tournament` mit `start_date <= now()`:
  - Setze `checkin_closed_at = start_date`
  - Spieler ohne `CHECKED_IN` werden in Round-1-Pairing nicht berücksichtigt

**Self-Check-in** (`apps/backend/src/routes/participants.ts`)
- Neuer Endpoint `POST /api/tournaments/:slug/checkin/self`
- Validation: `tournament.checkin_open_at != null && tournament.checkin_closed_at == null`
- Sonst 409 `{ code: 'CHECKIN_NOT_OPEN' }`

**Discord-Notifications** (`apps/backend/src/lib/discord-notify.ts` NEU)
- `notifyTournamentAnnounce(tournament)` — Embed in `tournament.discord_announce_channel_id`, optional Ping einer Opt-in-Rolle (Config in AdminConfig)
- `notifyCheckInReminder(tournament)` — DM an alle `TournamentParticipant` mit `status=REGISTERED`
- `notifyRoundPairings(round)` — Embed in Tournament-Channel + DM an jeden Spieler "Du spielst gegen X auf Map Y"
- `notifyDispute(match, reporter)` — DM an Organizer + alle `User` mit Role `MODERATOR`
- Verwendet `@discord.js/core` REST-Calls (kein Bot-Process — nur HTTP-Requests an Discord-API mit Bot-Token aus ENV)

**Tournament-Zod-Schemas erweitern** (`apps/backend/src/routes/tournaments.ts:18-49`)
- `CreateTournamentSchema`: neue Felder `rounds_count` (3-6 int), `playoff_format` (enum), `swiss_match_format`, `playoff_match_format`, `finale_match_format`, `map_decision_mode`, `map_pool` (string[] Map-IDs, Min 3 / Max 35)
- `UpdateTournamentSchema`: gleiche Felder optional

### 2.3 Frontend

**Match-Decision-Page** (`apps/frontend/src/routes/MatchDecisionPage.tsx` NEU)
- Live-Socket-Connect zu `match.decision.*`
- Phase 1 Coin-Flip: Animation (motion + scale + rotate), Reveal Top/Bottom mit Player-Avataren
- Phase 2a (mode=RANDOM): Wheel-Spin-Animation, dann Reveal picked map mit Image
- Phase 2b (mode=PICK_BAN): 3 Map-Cards horizontal, Top-Player kann eine bannen (Click → Karte wird grayscale + "BANNED" overlay), dann Bottom-Player → übrig = picked
- Phase 3 (BPT-Mode): beide Spieler sehen Faction-Grid (alle aktiven Factions), beide picken simultan. Eigene Pick: hervorgehoben. Gegner-Pick: hidden. "Lock In"-Button. Nach beidseitigem Lock: Reveal-Animation.
- Phase-Skip: Mode=OPEN → kein Blind-Pick, Mode=SFT → kein Blind-Pick (pre-locked), Mode=SLT → kein Faction-Pick (folgt aus pre-locked List).

**Check-in-Button** (`apps/frontend/src/components/tournament/CheckInButton.tsx` NEU)
- Visible nur in `T-60min` Fenster (basierend auf `tournament.checkin_open_at` und `start_date`)
- Live-Countdown bis `start_date`
- Click → `POST /api/tournaments/:slug/checkin/self` + Socket-Update
- States: "Check-in opens in 23min" / "Check in now! (closes in 45min)" / "You're checked in ✓" / "Check-in closed"

**Army-List-Uploader** (`apps/frontend/src/components/tournament/ArmyListUploader.tsx` NEU)
- Drag-Drop für `.army_setup` (optional) + Screenshot (PNG/JPG, required)
- Preview vor Submit
- Submit-Button = Lock-In, disabled nach Tournament-Start
- Reveal-Logic-aware: Nach Match zeigt es Gegner-Liste, nach Tournament-End alle

**Steam-Connect-Page** (`apps/frontend/src/routes/SteamConnectPage.tsx` NEU)
- Hard-Gate-Onboarding nach Discord-Login (wenn `user.steam_link == null`)
- Centered Hero "Connect your Steam account to continue"
- Button → redirect zu `/auth/steam/login?return_to=…`
- Nach erfolgreichem Return: Redirect zur ursprünglich angefragten Route

**Tournament-Create-Form-Erweiterung** (`apps/frontend/src/components/tournament/TournamentCreateForm.tsx`)
- Mode-Dropdown: OPEN / BPT / SFT / SLT
- Rounds-Count Slider (3-6)
- Playoff-Format Radio (None / Top-4 / Top-8) mit "Top-8 needs ≥16 participants"-Hint
- Match-Format pro Phase: 3 Dropdowns (Swiss: Bo1/Bo3, Playoffs: Bo3/Bo5, Finale: Bo3/Bo5)
- Map-Pool Multi-Select: 35 Maps, Min 3 / Max 35, Validation
- Map-Decision-Mode Radio: Random / Pick-Ban

**API-Wrappers** (`apps/frontend/src/lib/api.ts`)
- Neue Wrappers für alle neuen Endpoints, typsicher via `@rizzotto/types`

### 2.4 Critical Bug-Fix

`apps/backend/src/routes/users.ts:50` fehlt `GET /api/users?search=…`
- Aktuell ruft `apps/frontend/src/lib/api.ts:371 searchUsers()` einen nicht-existenten Endpoint
- UserBan-Tab im Admin (`apps/frontend/src/components/admin/UserBanTab.tsx`) ist kaputt
- Fix in Plan 3 (Welle B.3) — wird zusammen mit Admin-API gelöst

## Critical Files

- `packages/db/prisma/schema.prisma` — Schema-Migration
- `packages/db/prisma/migrations/<timestamp>_welle2_tournament_mechanics/` — Generated
- `packages/db/prisma/seed.ts` — 35 Maps Initial-Seed
- `apps/backend/src/routes/maps.ts` (NEU)
- `apps/backend/src/routes/match-decision.ts` (NEU)
- `apps/backend/src/routes/army-lists.ts` (NEU)
- `apps/backend/src/lib/army-setup-parser.ts` (NEU)
- `apps/backend/src/lib/playoff-generator.ts` (NEU)
- `apps/backend/src/lib/swiss.ts` — Tiebreaker-Erweiterung
- `apps/backend/src/routes/auth.ts` — Steam-OpenID
- `apps/backend/src/plugins/auth.ts` — Hard-Gate
- `apps/backend/src/plugins/cron.ts` — Check-in-Cron
- `apps/backend/src/routes/participants.ts` — Self-Check-in
- `apps/backend/src/lib/discord-notify.ts` (NEU)
- `apps/backend/src/routes/tournaments.ts` — Schema-Erweiterungen
- `apps/frontend/src/routes/MatchDecisionPage.tsx` (NEU)
- `apps/frontend/src/components/tournament/CheckInButton.tsx` (NEU)
- `apps/frontend/src/components/tournament/ArmyListUploader.tsx` (NEU)
- `apps/frontend/src/routes/SteamConnectPage.tsx` (NEU)
- `apps/frontend/src/components/tournament/TournamentCreateForm.tsx` — Erweiterung
- `apps/frontend/src/lib/api.ts` — neue Wrappers
- `packages/types/src/match-decision.ts` (NEU) — Socket-Event-Types

## Dependencies

- **Welle A.2** (DB-Schema) **muss** vor Welle B.* abgeschlossen sein.
- **Welle B.*** kann parallel laufen (Backend-Routes + Library-Code + Admin-API auf gemeinsamer Schema-Basis).
- **Welle C.*** braucht stable Backend.
- **Plan 3 MMR-Foundation** kann parallel zu Welle B.1/B.2 laufen (Plan 3 nutzt eigene Tabellen, aber Match-Result-Triggering hooks in Match-Result-Endpoint, der in Plan 2 erweitert wird).

## Verification

1. **DB-Migration:** `pnpm db:migrate` lokal sauber, neue Tabellen sichtbar in `pnpm db:studio`.
2. **Seed:** `pnpm db:seed` legt 35 Maps an.
3. **Backend-Routes:** Manual-Test via cURL:
   - `POST /api/matches/:id/decision/start` → Socket-Event empfangen
   - `POST /api/matches/:id/decision/ban` mit valid + invalid map_id
   - `POST /api/tournaments/:slug/checkin/self` außerhalb Fensters → 409
4. **Swiss-Tiebreaker:** Unit-Tests für edge cases (2 Spieler Buchholz-tied, 3 Spieler Solkoff-tied).
5. **Playoff-Generator:** Unit-Tests für `TOP8 → TOP4 auto-fallback` bei N<16.
6. **Steam-OpenID:** Manual-Test mit Test-Steam-Account, verify Signature + DB-Persistierung.
7. **Army-Setup-Parser:** Unit-Test mit `sample.army_setup` Fixture, Validate Output gegen erwartetes JSON.
8. **Discord-Notifications:** Mock-Test mit Test-Channel und Test-DM.
9. **Frontend-E2E** (Playwright, `apps/e2e/tests/match-decision.spec.ts` NEU):
   - Full Match-Decision-Flow: Coin-Flip → Pick/Ban → Blind-Faction-Pick → Match-Created
10. **TypeCheck/Lint/Test:** `pnpm typecheck && pnpm lint && pnpm test` clean.

## Sub-Agent-Briefs

**Welle A.2 — DB-Schema (Sub-Agent SA2):**
```
Lies zuerst CLAUDE.md, .knowledge/database.md, packages/db/prisma/schema.prisma.

Implementiere Schema-Erweiterung aus docs/roadmap/welle2-plan2-tournament-mechanics.md §2.1.

Kritisch:
- Eine Migration für alle neuen Tabellen + Tournament-Erweiterung.
- Backfill bestehender Tournaments mit Default-Werten (rounds_count=5 etc.).
- Map-Pool Initial-Seed mit 35 Maps in seed.ts.
- pnpm db:migrate testen lokal, pnpm db:generate, types in @rizzotto/types updaten.

Sonnet, kein paralleles Sub-Sub-Agent.
```

**Welle B.1 — Backend Routes (Sub-Agent SB1):**
```
Lies zuerst CLAUDE.md, .knowledge/backend-architecture.md, .knowledge/realtime.md, .knowledge/auth.md, .knowledge/database.md.

Implementiere Backend-Routes aus docs/roadmap/welle2-plan2-tournament-mechanics.md §2.2 (alle außer army-setup-parser, swiss-tiebreaker, playoff-generator — die übernimmt SB2).

Routes: maps.ts, match-decision.ts, army-lists.ts, auth.ts (Steam-OpenID), participants.ts (Self-Check-in), discord-notify.ts, tournaments.ts (Zod-Erweiterung).
Plugins: auth.ts (Hard-Gate), cron.ts (Check-in-Cron).

Validation und Error-Shape gemäß CLAUDE.md. Cached() für Read-Heavy Endpoints.

Sonnet, kein paralleles Sub-Sub-Agent.
```

**Welle B.2 — Library-Code (Sub-Agent SB2):**
```
Lies zuerst CLAUDE.md, .knowledge/algorithms.md, .knowledge/draft-system.md.

Implementiere Library-Code aus docs/roadmap/welle2-plan2-tournament-mechanics.md §2.2 Sub-Sektionen:
- army-setup-parser.ts (Reverse-Engineering aus c:\Users\Luke\Desktop\last_setup_for_wh2_main_hef_high_elves_domination.army_setup; Fallback Plain-Text-Extraction)
- swiss.ts Tiebreaker-Extension (Buchholz → Solkoff → Head-to-Head)
- playoff-generator.ts (TOP4/TOP8 mit Auto-Fallback)

Unit-Tests für jeden Edge-Case schreiben.

Sonnet, kein paralleles Sub-Sub-Agent.
```

**Welle C.1 — Frontend Mechanik (Sub-Agent SC1):**
```
Lies zuerst CLAUDE.md, .knowledge/frontend-patterns.md, .knowledge/realtime.md, docs/design/README.md.

Implementiere Frontend aus docs/roadmap/welle2-plan2-tournament-mechanics.md §2.3:
- MatchDecisionPage.tsx (Live-Socket-UI)
- CheckInButton.tsx (Countdown + Self-Check-in)
- ArmyListUploader.tsx (File + Screenshot Upload)
- SteamConnectPage.tsx (Hard-Gate-Onboarding)
- TournamentCreateForm.tsx (Erweiterung um neue Settings)
- api.ts (neue Wrappers)

motion + shadcn/ui + Tailwind, dark-only.

Sonnet, kein paralleles Sub-Sub-Agent.
```

## Phase-2-Erweiterungen (NICHT jetzt)

- Pick/Ban-Spectator-Mode (Live-Stream-View für Zuschauer)
- Auto-Pairing für 3v3-Mode (TournamentMode.THREE_V_THREE)
- Replay-Upload nach Match
- Match-Caster-Tools (Picture-in-Picture)
