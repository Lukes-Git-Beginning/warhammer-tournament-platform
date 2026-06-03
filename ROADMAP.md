# ROADMAP — Rizzotto

> **Stand:** 2026-06-03 · **Phase:** Post-Launch, Live · **Domain:** rizzotto.gg
>
> Diese Roadmap ist die **SSOT** für _was läuft_, _was als nächstes drankommt_ und _was bewusst nicht gebaut wird_. Sub-Pläne (Detail-Plans für einzelne Tracks) liegen unter `~/.claude/plans/`, nicht im Repo. Historie und Welle-Specs siehe `docs/archive/`.

---

## TL;DR

- **rizzotto.gg ist live seit 2026-05-19** auf Hetzner CX22, Caddy + Cloudflare-Origin-Cert.
- **M1–M5 + Welle 2 (Steam-Hard-Gate, BPT/SFT/SLT, MMR, Match-Flow, 24 Faction-Sigils) sind durch.**
- **Heute (2026-05-19) gefixt:** Steam-Hard-Gate end-to-end verdrahtet, Top-Bar-Navigation-Crash, Wordmark-AVIF, Logout (Content-Type), datetime-Submit, Header-Avatar-Profil-Link.
- **Zuletzt gelandet (2026-06-03):** Phase-2-Konsolidierung (PR #10, MMR-Tabellen auf Prod gedroppt, kein CSV-Export) + **M6 Hub-Foundation** (PR #11) komplett live + **DOUBLE_ELIMINATION** (§6, alle Feldgrößen, migrationsfrei). Offenes Backlog: `DISCORD_BOT_TOKEN` + Hetzner-VM-Backup (User-Tasks), Cold-Fit-Job + Anti-Farming-UI (§2.4), Community-Links (echte URLs ausstehend).
- **Mid-term:** ~~M6 Hub-Foundation~~ ✅ live (2026-06-03). Als nächstes: M7 Datentiefe (Army-List-Browser, Scraper-Write-Path). M8 UGC (Battle-Reports, Comments). M9 Team-Play (3v3, SfT, Blind-Pick).
- **Bewusst geparkt:** In-App-Listenbauer, Live-Stream-Embed, Achievements, Coaching, Multi-Tenant, Native-App.

---

## 1. Status — was läuft

| Track                            | Stand                   | Notiz                                                                                                                                                                                                                                                                         |
| -------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M1 Foundation & Live-Core        | ✅ done                 | Monorepo, Prisma 7, Discord-OAuth2, Single-Elim, Socket.IO + Redis-Adapter                                                                                                                                                                                                    |
| M2 Swiss & Leaderboard           | ✅ done                 | Swiss/RR/DRR via `tournament-pairings`, Season-Modell, ELO, Redis-Caching                                                                                                                                                                                                     |
| M3 Faction-Stats & Meta          | ✅ done                 | GraphQL/mercurius, `FactionStats`, 24×24-Heatmap, 30-Tage-Trend-Snapshots                                                                                                                                                                                                     |
| M4 Draft-System                  | ✅ done                 | Redis-Timer-Rehydration, Lobby-UI, Preset-Editor, Event-Log                                                                                                                                                                                                                   |
| M5 Polish + Admin + E2E          | ✅ done                 | Army-Upload, Scraper read-only, Admin-Panel, Playwright, SEO                                                                                                                                                                                                                  |
| M5.5 UI-Overhaul + Onboarding    | ✅ done                 | Souls-like UI, DRY EmptyStates, Onboarding-Flow                                                                                                                                                                                                                               |
| **Welle 2 — Brand (Rizzotto)**   | ✅ done                 | Komplettes Rebrand, Wordmark, Aubergine-Sigil                                                                                                                                                                                                                                 |
| **Welle 2 — Mechanics**          | ✅ done                 | Steam-Hard-Gate, BPT/SFT/SLT, Match-Decision-Flow, DE-Schema, List-Lock                                                                                                                                                                                                       |
| **Welle 2 — Admin/Stats/MMR**    | ✅ done                 | MMR 3-Faktor, FactionMastery, AntiFarmCap                                                                                                                                                                                                                                     |
| **Production Deploy**            | ✅ live seit 2026-05-19 | Hetzner CX22, Postgres + Redis (docker-compose), Caddy 2.11, Backup-Timer                                                                                                                                                                                                     |
| 24 Faction-Sigils                | ✅ done                 | Default-Sigils im Repo, FactionBadge rendert sie mit Initials-Fallback                                                                                                                                                                                                        |
| Steam-Hard-Gate live             | ✅ done (2026-05-19)    | Frontend-Guard + Discord-Callback-Redirect + meSelect-Field; verifiziert auf rizzotto.gg                                                                                                                                                                                      |
| **Welle-1 Pipeline-Ausbau**      | ✅ done (2026-05-20)    | E2E ist Pre-Deploy-Gate (continue-on-error raus), Discord-Webhook bei Failure (#4 + #5), `STEAM_WEB_API_KEY` in Prod gesetzt → echte Personas                                                                                                                                 |
| **Dynamic Weighted Leaderboard** | ✅ live (2026-06-02)    | Derive-on-read (L2-Logistic-Regression, `lib/rating-model.ts`); `mode=rating_model` ist Live-Default (Prod-Endpoint verifiziert). Frontend (`DynamicLeaderboardTable` + RollOfHonour) + E2E-Contract nachgezogen. Löst Welle-2-MMR ab — Deprecation-Cleanup gelandet (Phase-2, 2026-06-03) |
| **Phase-2-Konsolidierung**       | ✅ live (2026-06-03)    | PR #10 (`36e206e`) nach `main` + deployed: MMR-DB-Drop (`drop_welle2_mmr_deprecated`) auf Prod ausgeführt (Welle-2-Tabellen weg, kein CSV-Export — bewusst), Matrix-/Proficiency-Views im UI. Prod-Smoke grün                |
| **M6 Hub-Foundation**            | ✅ live (2026-06-03)    | PR #11 (`5b8b732`), migrationsfrei: H2H (`/users/$a/vs/$b`), Tournament-Kalender + iCal-Feed, Major-Badge/Filter, ImportLog-Admin-UI, `preferred_factions`-Block. 429+25 Tests, E2E-Routen-Guard grün. Community-Links deferred                |

---

## 2. Nächste Session — sofortiges Backlog

### 2.1 ~~Tournament-Lifecycle-UI~~ ✅ done

Bundled in `f4e3705` und deployed 2026-05-20: Delete-Button, Status-Transition (Publish), Edit-Page — alle drei live in `TournamentDetail.tsx`.

### 2.2 Externe Integrationen freischalten

| #   | Item                                                                          | Wo                           | Notiz                                                                 |
| --- | ----------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| 1   | ~~`STEAM_WEB_API_KEY` in `/etc/rizzotto/env/backend.env` setzen~~             | Server                       | ✅ done 2026-05-20                                                    |
| 2   | **`DISCORD_BOT_TOKEN`** in env setzen + Discord-Bot starten                   | Server + Discord-Application | Vorbereitung für M8 Discord-Bot-Integration                           |
| 3   | **Hetzner-VM-Backup aktivieren**                                              | Hetzner Cloud-Console        | ~1.68 €/mo, User-Task                                                 |
| 4   | ~~`.env.example` ergänzen um `STEAM_OPENID_RETURN_URL`, `STEAM_WEB_API_KEY`~~ | root `.env.example`          | ✅ war faktisch schon geschlossen (Zeile 45, 48); §2.2 #4 war Phantom |

### 2.3 Tech-Debt aus Eigentest 2026-05-19 + Welle-1-Follow-ups

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Pfad                                                                                                          | Severity                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Server-Config (Caddy + systemd) divergiert vom Repo-Stand — `DEPLOYMENT.md` ✅ auf Caddy+systemd+Steam-Env gebracht (Branch `chore/phase2-consolidation`); offen bleibt nur der manuelle Live-Sync `/etc/caddy/Caddyfile` (User-Task)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `deploy/Caddyfile` vs. `/etc/caddy/Caddyfile`                                                                 | Niedrig — beide funktionieren, aber Drift sollte aufgelöst werden                |
| 2   | Keine `AuditLog`-Einträge für direkte DB-Eingriffe (Admin-Promotion 2026-05-19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                             | Niedrig — manuelle Eingriffe sollten dokumentiert sein                           |
| 3   | ~~`warhammer-*`-Tokens in Bracket/Sub-Komponenten~~ ✅ **done (2026-06-03)** — Rest (`TournamentDetail.tsx` 10 Refs + `app.css`-Shim-Block) migriert; `grep warhammer- apps/frontend/src` leer (Branch `chore/phase2-consolidation`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `apps/frontend/src/components/bracket/*`, `TournamentDetail.tsx`                                              | ✅ done                                                                          |
| 4   | ~~**Visual-Snapshot-Stabilität**~~ ✅ **resolved (2026-06-03)** — Audit ergab: Specs laufen bereits unbedingt in CI (keine Skip-Marker), Masks (`leaderboard-data-table` + `roll-of-honour-list` via `data-testid`) greifen, Linux-Baselines committed (PR #9). Es war nur noch ein veralteter „temporarily skipped"-Kommentar in `ci.yml` übrig → entfernt. Einziger bewusster `test.fixme` bleibt (LanguageToggle-Fallback).                                                                                                                                                                                                                                                                                                                                                                                                                          | `apps/e2e/tests/visual/landing-overhaul.spec.ts`, `.github/workflows/ci.yml`                                  | ✅ done                                                                          |
| 5   | ~~**Welle-D Test 3 (`decision/start`)**~~ ✅ done (2026-06-02) — `createTournament` nimmt jetzt `map_pool`/`rounds_count`; Test asserts 201                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `apps/e2e/tests/match-decision-flow.spec.ts:229`, Helper `createTournament`                                   | Niedrig — Unit-Tests decken den Match-Decision-Pfad                              |
| 6   | ~~**Welle-D Test 4 (`Auto-Playoff TOP4`)**~~ ✅ done (2026-06-02) — `rounds_count: 3` + null-sicherer Round-Filter (Prisma `notIn` schloss NULL-Phase-Matches aus)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `apps/e2e/tests/match-decision-flow.spec.ts:308`                                                              | Niedrig — Unit-Tests decken den Playoff-Generator                                |
| 7   | **Heatmap-Daten-Lücke (Dual-Write):** ✅ FIXED (2026-06-02) — `resolveMatchResult()` (Welle-D Dual-Submit-Pfad via `match-reports.ts`) schreibt **keine** `MatchupStats`/`FactionStats` — anders als der Legacy-Pfad `routes/matches.ts` `POST /:id/result`. → 24×24-Heatmap kann live leer/veraltet wirken, obwohl M3 „done". **Kein** Endpoint-Stub: Endpoint (`routes/meta.ts:113`), Aggregation (`lib/heatmap.ts`) und UI (`MatchupHeatmap.tsx`) sind vollständig. Test-Kommentar `factions.test.ts:346` (`// stub`) ist irreführend (beschreibt leeren DB-State, nicht den Endpoint).                                                                                                                                                                                                                                                                | `apps/backend/src/lib/match-result-service.ts`, `routes/matches.ts:188-242`                                   | Mittel — sichtbares M3-Feature                                                   |

---

### 2.4 Dynamic Weighted Leaderboard (Alex-Spec) — ✅ gemergt + deployed (2026-06-02)

Komplett auf `main` gelandet (Merge `30d759e`) und live auf rizzotto.gg — `mode=rating_model` ist Default, Prod-Endpoint gibt die neue Shape mit `HTTP 200`. **Derive-on-read**: speichert nur Match-Fakten, leitet PlayerFactionSkill, MatchupEffect, Win-Chance, RawPoints, Anti-Farm-Modifier und Totals live aus dem Season-Datensatz ab (L2-Logistic-Regression in `lib/rating-model.ts`). Löst das Welle-2-MMR ab. **Restliche offene Punkte:**

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Pfad                                                                                                                 | Severity |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | ~~Frontend-Leaderboard bricht~~ ✅ done (2026-06-02) — `SeasonTab` → neue `DynamicLeaderboardTable`, `RollOfHonourSection` (Landing-Top-10) + `api.ts` auf `DynamicLeaderboardResponse` umgestellt. **Lehre:** Der Merge-Blocker war größer als „Frontend bricht" — der Feature-Contract-Wechsel hatte auch zwei E2E-Specs (`leaderboard-correctness`, `tournament-happy-path`) faction-/shape-blind gelassen; sie brachen erst am Pre-Deploy-E2E-Gate. Fix: faction-aware Fixtures + modell-agnostische Assertions; zusätzlich Rate-Limit unter `NODE_ENV=test` angehoben (live-draft 429 aus single-IP-Polling). | `apps/frontend`, `apps/e2e/tests/{leaderboard-correctness,tournament-happy-path}.spec.ts`, `apps/backend/src/app.ts` | — done   |
| 2   | ~~**Deprecation-Cleanup**~~ ✅ **done auf Branch (2026-06-03)** — User wählte „komplett inkl. DB-Drop". Migration `drop_welle2_mmr_deprecated` droppt `FactionMastery`/`FactionMatchupStat`/`AntiFarmCap`-Tabellen + `LeaderboardEntry.season_points` + `StatsSource`-Enum; `lib/mmr.ts` + Test gelöscht, Legacy-Modi (`season_points`/`weighted_winrate`) + Profil-`FactionMasteryCard`/`per_faction_winrate` raus, `LeaderboardMode` → `rating_model\|winrate`. ⚠️ **Prod-Drop irreversibel beim Merge→Auto-Deploy** (Prod hatte echte Welle-2-Daten — CSV-Export vor Merge erwägen)                                                                                                                                                                                                                                                  | `schema.prisma`, `lib/mmr.ts`, Migration                                                                            | ✅ done (Branch) |
| 3   | Cold-Fit-Kosten validieren (großer Season-Datensatz) — ggf. Fit in deferred Job/Cron auslagern statt im Request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `lib/rating-model-service.ts`                                                                                        | Niedrig  |
| 4   | ~~**Breakdown-/Matrix-/Proficiency-Views**~~ ✅ **done auf Branch (2026-06-03)** — alle 4 `routes/rating.ts`-Endpoints im UI: `ModelMatchupHeatmap` auf `/meta` (reuse `winrateColor`), `PlayerFactionProficiencyCard` im Profil (ersetzt Mastery-Card), Match-Breakdown auf `getMatchScoringBreakdown` umgestellt. Anti-Farming-Endpoint hat Getter, UI-Surface optional/offen                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `apps/frontend`, `routes/rating.ts`                                                                                  | ✅ done (Branch) |

## 3. Bekannte Stubs / 501s

| #   | Issue                                                                                                        | Pfad                                                          | Severity                             | Plan                               |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------ | ---------------------------------- |
| 1   | ~~**DOUBLE_ELIMINATION wirft 501**~~ ✅ **gelöst (2026-06-03)** — Format end-to-end implementiert     | `apps/backend/src/routes/bracket.ts`                          | —                                    | s. §6                              |
| 2   | **Tournament-Edit/Delete-Buttons sind Stubs**                                                                | `TournamentDetail.tsx:151,160`                                | Mittel — Admin-Flow blockiert        | §2.1                               |
| 3   | **Scraper-Write-Path** wirft "not implemented"                                                               | `scraper/src/cli.ts:148,155`                                  | Mittel — Datenhebel ungenutzt        | M7                                 |
| 4   | `Tournament.poster_url` Upload-Flow fehlt                                                                    | `packages/db/prisma/schema.prisma:172`                        | Niedrig                              | M6 optional                        |
| 5   | `SigillumSection`-Community-Links Platzhalter                                                                | `apps/frontend/src/components/landing/SigillumSection.tsx:93` | Niedrig                              | M6 — 🟡 deferred (echte URLs ausstehend) |
| 6   | ~~`ImportLog` ohne Admin-UI~~                                                                                | —                                                             | Niedrig                              | ✅ done (2026-06-03) — §4.7        |
| 7   | `Team`/`TeamMember`-Models reserviert, ungenutzt                                                             | `schema.prisma:286`                                           | —                                    | M9                                 |
| 8   | **MatchDetailPage ist ganzseitiger Stub** („Full match view (scores, result reporting) — coming in Welle D") | `apps/frontend/src/routes/MatchDetailPage.tsx`                | Mittel — nutzer-sichtbarer Kern-Flow | ✅ done (2026-06-02) — §P1a        |

Sonst keine `@ts-expect-error`, kein `FIXME`/`HACK` — Codebase ist sauber.

---

## 4. M6 — Hub-Foundation ✅ _(gelandet 2026-06-03, PR #11, migrationsfrei)_

**Ziel:** Die Plattform fühlt sich nach M6 personalisiert, hierarchisch und visuell konsistent an.

1. ~~**Tournament-Lifecycle-UI**~~ ✅ (§2.1) — Edit/Delete/Status-Transition
2. ~~**Head-to-Head Player Stats**~~ ✅ — `GET /api/users/:a/vs/:b` (inkl. Draws, 60s-Cache, `h2h:*`-Invalidierung) + `/users/$a/vs/$b`-Page, verlinkt aus Profil-Match-History
3. ~~**`preferred_factions`-Personalisierung**~~ ✅ — Landing-Block „Deine Fraktionen" (löst Slugs gegen `/api/factions` auf, Links auf `/factions/$id`). **Scope-Hinweis:** minimaler Faction-Link-Block statt Winrate-Trend-Chart („Dein Meta"); Trend-Variante bei Bedarf später nachrüstbar
4. ~~**Tournament-Kalender-View + iCal-Export**~~ ✅ — `/tournaments/calendar` (Custom Voll-Monatsraster, keine Kalender-Lib) + `GET /api/tournaments/calendar.ics` (RFC 5545 via `ical-generator`; `end_date`-Heuristik `start + rounds_count*2h`)
5. ~~**Major/Regular UI-Distinction**~~ ✅ — `major`-Badge (Crown) auf Listing + Landing, `is_major`-Filter auf Liste + via `PATCH` patchbar
6. **Echte Community-Links setzen** — 🟡 **deferred**: braucht echte Discord-/GitHub-/Reddit-URLs vom User (`SigillumSection.tsx`)
7. ~~**ImportLog Admin-UI**~~ ✅ — `GET /api/admin/import-log` (paginiert, source-Filter, ADMIN) + Admin-Tab `import` (Klon AuditLogTable)
8. **`Tournament.poster_url`-Upload-Flow** — offen (optional)

---

## 5. M7 — Datentiefe & Army-List-Database _(2–3 Wochen)_

**Ziel:** Rizzotto wird **Inspirationsdatenbank** für Listenbau + bekommt echte externe Daten.

1. **Army-List-Browser** — `ArmyList.parsed_data` ist ein JSON-Schatz (`{ battle_type, lord, units }`). UI mit Filter (Faction/Lord/Battle-Type), Search, "neueste", "meistgesehene". Killer-Feature für Listenbauer
2. **Scraper-Write-Path implementieren** — `ExternalTournament`-Tabelle anlegen, totaltavern.com-Daten persistieren. `FactionStats` bekommt externe Match-Basis
3. **Realtime-Leaderboard** — Socket-Push bei ELO-Änderung. Aktuell REST-Pull
4. **News-/Patch-Notes-Feed** — `News`-Tabelle (Admin-only), Frontend-Route `/news`, Landingpage-Integration
5. **Scraper-Backup-Source** — tabletop.to als zweite Datenquelle einbauen, damit `FactionStats` nicht an DOM-Änderungen einer Quelle stirbt
6. **Sentinel-Tests** für Scraper-Selektoren (wöchentlich gegen Live-DOM)

---

## 6. DOUBLE_ELIMINATION — ✅ done (2026-06-03)

End-to-end implementiert, **migrationsfrei** (Schema hatte `loser_next_match_id`, `bracket_side`, Enum `BracketSide` bereits; Generator `generateDoubleElim` existierte). Die eigentliche Arbeit war Verdrahtung + Robustheit:

1. **Progression** (`routes/matches.ts`): Loser-Drop via `loser_next_match_id`, Grand-Final-**Bracket-Reset** (WB-Champ gewinnt GF → Reset = FORFEIT; LB-Champ → Reset wird gespielt), feeder-aware `checkAndPromoteBye`.
2. **Order-unabhängige Slot-Zuweisung** (`lib/bracket.ts` `slotForFeeder`): leitet den Slot aus der statischen Feeder-Struktur ab statt aus Parität/first-free — behob einen reihenfolgeabhängigen Slot-Collision-Bug (Loser-Drop überschrieb den vorgereichten LB-Sieger, auch bei Zweierpotenz-Feldern).
3. **Non-pow2-Felder** (`lib/bracket.ts`): `seedSlotOrder` (verteilte BYEs) + topologischer BYE/Phantom-Auflösungs-Pass → 5/6/7… Spieler laufen sauber durch (vorher: leeres Match blockierte das Bracket).
4. **Finalisierung** (`lib/finalize-tournament.ts`): `computeDoubleElimPlacements` (rundenformel-frei), manuelles Finalize (wie SE).
5. **Frontend**: DE im Create-Dropdown; `computeBracketLayout` WB/LB/GF-Split; `SVGBracket` Loser-Drop-Connectors; DE-Abschluss-Banner.
6. **Tests**: 24 DE-Unit/DB-Integration (inkl. 5/6/7-Spieler-Lifecycle + Order-Independence), E2E 8-Spieler-Lifecycle + Browser-Render.

Details: `.knowledge/algorithms.md` (Abschnitt „Bracket — Double-Elimination").

---

## 7. M8 — UGC & Battle-Reports _(3–4 Wochen, transformativ)_

**Ziel:** Plattform wird Content-Hub.

1. **Battle-Report-Editor** — Markdown + Photo-Upload, Match-Timeline, Card-Embeds für referenzierte Listen/Fraktionen. Verknüpft mit `Match.id` (optional)
2. **Comment-System** — Match-Detail, Tournament, Battle-Report. Markdown, Soft-Delete, Moderation-Flag
3. **Discord-Bot zur Match-Reporting-Integration** — Spieler reportet im Discord-Channel, Bot triggert Backend. Braucht `DISCORD_BOT_TOKEN` (§2.2)

**Risiko:** UGC braucht Moderation. Plan ab ~50 aktive Schreiber: Flag-Queue + Auto-Throttle für neue Accounts.

**Henne-Ei-Caveat:** M8 braucht kritische Masse. M6/M7 zuerst (haben auch mit einem Nutzer Wert).

---

## 8. M9 — Team-Play _(4+ Wochen, große Wette)_

**Ziel:** 3v3 / SfT / Blind-Pick aktivieren.

1. **Team-Management UI** — `Team`/`TeamMember`-Models existieren als "Phase 3 reserved" (`schema.prisma:286`). UI: Team gründen, Mitglieder einladen, Team-Profil
2. **`TournamentMode.THREE_V_THREE`** — Schema vorhanden, Backend-Logik fehlt
3. **Blind-Pick-Modus** — Pick ohne Sicht auf Gegner-Listen bis Runde 1
4. **SfT (Swiss-for-Teams)** — Pairing-Algorithmus für Teams

**Vorab:** Spec-Klärung mit Insidern bevor Schema final.

---

## 9. Out-of-Scope (geparkt oder verworfen)

| Idee                              | Begründung                                                                |
| --------------------------------- | ------------------------------------------------------------------------- |
| **In-App-Listenbauer**            | Externe Tools (Old World Builder, Almanack) decken's. **Skip.**           |
| **Live-Stream-Twitch-Embed**      | Old-World-Stream-Szene zu klein. **Wait** (Re-Eval nach M9)               |
| **Coaching-/Mentorship-Matching** | Nische zu klein, Moderations-Aufwand zu hoch. **Skip**                    |
| **Achievements/Badges**           | Gamification kann billig wirken. **Wait** bis M8 + UGC-Engagement messbar |
| **Federation/Multi-Tenant**       | Single-Tenant bleibt. **Permanent skip**                                  |
| **Mobile-Native-App**             | PWA-Pfad ist pragmatischer. PWA-Manifest in M6+ ergänzen, nicht Native    |

---

## 10. Architektur-Anker (verbindlich seit Tag 1)

Werden in M6+ nicht angerührt:

- **Single-Tenant** — keine Mandanten-Spalten in Tables
- **Socket.IO mit `@socket.io/redis-adapter`** — Multi-Instance-fähig ab Tag 1
- **Draft-Timer-State in Redis** (`draft:{id}:state`) — Backend rehydriert aus `timerExpiresAt`
- **Auth: JWT in HTTP-Only-Cookie** — kein Server-Session-Storage, WebSocket-Auth via Cookie-Handshake
- **Stats: Inkrementelle Counter** — Faction-/Meta-Stats (`FactionStats`, `MatchupStats`) bleiben inkrementell. **Ausnahme seit 2026-06 (Alex-Spec, `feat/dynamic-leaderboard`):** das Leaderboard ist jetzt **derive-on-read** (dynamisches Rating-Modell, `lib/rating-model.ts`) und löst die inkrementellen MMR-Counter (`season_points`/`FactionMastery`/`AntiFarmCap`) ab
- **Pairing: `tournament-pairings`-Library** — Korrektheit nicht selbst verantworten
- **Prisma 7 driver-adapter** — `datasource.url` in `prisma.config.ts`, nicht in `schema.prisma`
- **Steam-Hard-Gate** — nach Discord-Login zwingend Steam-Link, kein Bypass (Ban-Evade-Schutz)

---

## 11. Referenz-Docs

| Datei                     | Inhalt                                                                                                                             |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `CLAUDE.md` (Root)        | Projekt-Übersicht, Top-Level-Commands, Conventions                                                                                 |
| `apps/backend/CLAUDE.md`  | Backend-Plugin-Reihenfolge, Decorator-Quick-Ref, Test-Isolation                                                                    |
| `apps/frontend/CLAUDE.md` | Vite-Proxy, API-Layer, Router-Konventionen                                                                                         |
| `DEPLOYMENT.md`           | Production-Setup. **Hinweis:** noch nicht auf realen Caddy+systemd-Stand gebracht (Follow-up)                                      |
| `docs/design/README.md`   | Design-System-Index (15 Topic-Files: Brand, Voice, Tokens, Components, Motion, Accessibility …)                                    |
| `.knowledge/*.md`         | Topic-Hubs für Caching, Auth, Realtime, Draft-System, DB, Frontend-Patterns, Tests, Algorithmen, Types, Backend-Architektur, Stack |
| `docs/archive/`           | Historische Plan-/Spec-Dateien (alte WARHAMMER-Prompts, Welle-2-Pläne, Spec-Decisions, M3-Smoke). Read-only Referenz               |

---

## 12. Wie diese Roadmap gepflegt wird

- **Beim Landen eines Milestones:** Eintrag in §1 mit `✅ done` + Datum, ggf. Punkte aus §2/§4–§8 nach §1 verschieben
- **Bei neuem Stub/501:** in §3 aufnehmen mit Pfad + Severity
- **Bei Backlog-Add:** in §2 (nächste Session) oder §4–§8 (späterer Milestone) eintragen
- **Sub-Pläne** liegen unter `~/.claude/plans/<topic>.md`, nicht im Repo — diese Roadmap referenziert sie über Track-Namen
- **Out-of-Scope-Entscheidungen** in §9 mit Begründung — wer das wieder reinwill, muss in der ROADMAP-PR argumentieren
