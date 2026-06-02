# ROADMAP — Rizzotto

> **Stand:** 2026-05-19 · **Phase:** Post-Launch, Live · **Domain:** rizzotto.gg
>
> Diese Roadmap ist die **SSOT** für _was läuft_, _was als nächstes drankommt_ und _was bewusst nicht gebaut wird_. Sub-Pläne (Detail-Plans für einzelne Tracks) liegen unter `~/.claude/plans/`, nicht im Repo. Historie und Welle-Specs siehe `docs/archive/`.

---

## TL;DR

- **rizzotto.gg ist live seit 2026-05-19** auf Hetzner CX22, Caddy + Cloudflare-Origin-Cert.
- **M1–M5 + Welle 2 (Steam-Hard-Gate, BPT/SFT/SLT, MMR, Match-Flow, 24 Faction-Sigils) sind durch.**
- **Heute (2026-05-19) gefixt:** Steam-Hard-Gate end-to-end verdrahtet, Top-Bar-Navigation-Crash, Wordmark-AVIF, Logout (Content-Type), datetime-Submit, Header-Avatar-Profil-Link.
- **Sofortiges Backlog für nächste Session:** Tournament-Lifecycle-UI (Edit/Delete/Status-Transition) und Discord-Bot-Token + Steam-API-Key in Production einbringen.
- **Mid-term:** M6 Hub-Foundation (Faction-Crests sind durch → jetzt H2H, Personalisierung, Calendar, Major-Badges). M7 Datentiefe (Army-List-Browser, Scraper-Write-Path). M8 UGC (Battle-Reports, Comments). M9 Team-Play (3v3, SfT, Blind-Pick).
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
| **Dynamic Weighted Leaderboard** | ✅ live (2026-06-02)    | Derive-on-read (L2-Logistic-Regression, `lib/rating-model.ts`); `mode=rating_model` ist Live-Default (Prod-Endpoint verifiziert). Frontend (`DynamicLeaderboardTable` + RollOfHonour) + E2E-Contract nachgezogen. Löst Welle-2-MMR ab — Deprecation-Cleanup noch offen (§2.4) |

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

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Pfad                                                                                                          | Severity                                                                         |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| 1   | Server-Config (Caddy + systemd) divergiert vom Repo-Stand                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `deploy/Caddyfile` vs. `/etc/caddy/Caddyfile`                                                                 | Niedrig — beide funktionieren, aber Drift sollte aufgelöst werden                |
| 2   | Keine `AuditLog`-Einträge für direkte DB-Eingriffe (Admin-Promotion 2026-05-19)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | —                                                                                                             | Niedrig — manuelle Eingriffe sollten dokumentiert sein                           |
| 3   | `BracketView` und einige Tournament-Sub-Komponenten nutzen noch `warhammer-*`-Tokens                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | `apps/frontend/src/components/bracket/*`, `TournamentDetail.tsx`                                              | Niedrig — kosmetisch                                                             |
| 4   | **Visual-Snapshot-Stabilität** für `visual/landing-overhaul.spec.ts` — Bootstrap via `update-snapshots.yml` ist verdrahtet und produziert Linux-PNGs (PR #7 versucht), aber `leaderboard-mobile` zeigt 41 % Pixel-Diff zwischen Runs, weil die Leaderboard die randomisierten Test-User-Namen (`happy-p-0-<uuid-tail>`) aus anderen Specs rendert. Fix: entweder `mask` auf datengetriebene Elemente (Tabellen, Tournament-Cards) oder visual-Suite mit garantiertem DB-State (cleanup-before + leerer Leaderboard). Aktuell sind die 9 Visual-Specs per `UPDATE_SNAPSHOTS`-Conditional in CI skipped — kein Schutz gegen Visual-Regressions auf landing/login/leaderboard. | `apps/e2e/tests/visual/landing-overhaul.spec.ts`, `apps/e2e/tests/visual/landing-overhaul.spec.ts-snapshots/` | Mittel — eigener Track, ~2–3 h Arbeit für saubere Datenisolation oder Mask-Setup |
| 5   | **Welle-D Test 3 (`decision/start`)** ist `test.skip` — Fixture konfiguriert keinen `map_pool`, Backend wirft 422                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | `apps/e2e/tests/match-decision-flow.spec.ts:229`, Helper `createTournament`                                   | Niedrig — Unit-Tests decken den Match-Decision-Pfad                              |
| 6   | **Welle-D Test 4 (`Auto-Playoff TOP4`)** ist `test.skip` — sendet `rounds_count: 2`, Schema-Min ist 3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | `apps/e2e/tests/match-decision-flow.spec.ts:308`                                                              | Niedrig — Unit-Tests decken den Playoff-Generator                                |
| 7   | **Heatmap-Daten-Lücke (Dual-Write):** `resolveMatchResult()` (Welle-D Dual-Submit-Pfad via `match-reports.ts`) schreibt **keine** `MatchupStats`/`FactionStats` — anders als der Legacy-Pfad `routes/matches.ts` `POST /:id/result`. → 24×24-Heatmap kann live leer/veraltet wirken, obwohl M3 „done". **Kein** Endpoint-Stub: Endpoint (`routes/meta.ts:113`), Aggregation (`lib/heatmap.ts`) und UI (`MatchupHeatmap.tsx`) sind vollständig. Test-Kommentar `factions.test.ts:346` (`// stub`) ist irreführend (beschreibt leeren DB-State, nicht den Endpoint).                                                                                                          | `apps/backend/src/lib/match-result-service.ts`, `routes/matches.ts:188-242`                                   | Mittel — sichtbares M3-Feature                                                   |

---

### 2.4 Dynamic Weighted Leaderboard (Alex-Spec) — ✅ gemergt + deployed (2026-06-02)

Komplett auf `main` gelandet (Merge `30d759e`) und live auf rizzotto.gg — `mode=rating_model` ist Default, Prod-Endpoint gibt die neue Shape mit `HTTP 200`. **Derive-on-read**: speichert nur Match-Fakten, leitet PlayerFactionSkill, MatchupEffect, Win-Chance, RawPoints, Anti-Farm-Modifier und Totals live aus dem Season-Datensatz ab (L2-Logistic-Regression in `lib/rating-model.ts`). Löst das Welle-2-MMR ab. **Restliche offene Punkte:**

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Pfad                                                                                                                 | Severity |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------- | -------- |
| 1   | ~~Frontend-Leaderboard bricht~~ ✅ done (2026-06-02) — `SeasonTab` → neue `DynamicLeaderboardTable`, `RollOfHonourSection` (Landing-Top-10) + `api.ts` auf `DynamicLeaderboardResponse` umgestellt. **Lehre:** Der Merge-Blocker war größer als „Frontend bricht" — der Feature-Contract-Wechsel hatte auch zwei E2E-Specs (`leaderboard-correctness`, `tournament-happy-path`) faction-/shape-blind gelassen; sie brachen erst am Pre-Deploy-E2E-Gate. Fix: faction-aware Fixtures + modell-agnostische Assertions; zusätzlich Rate-Limit unter `NODE_ENV=test` angehoben (live-draft 429 aus single-IP-Polling). | `apps/frontend`, `apps/e2e/tests/{leaderboard-correctness,tournament-happy-path}.spec.ts`, `apps/backend/src/app.ts` | — done   |
| 2   | **Deprecation-Cleanup** — `season_points`/`FactionMastery`/`FactionMatchupStat`/`AntiFarmCap` nur als `// DEPRECATED` markiert, Spalten nicht gedroppt. Drop-Migration nach Validierung an echten Daten (Go/No-Go vor irreversiblem Drop)                                                                                                                                                                                                                                                                                                                                                                          | `schema.prisma`, `lib/mmr.ts`                                                                                        | Niedrig  |
| 3   | Cold-Fit-Kosten validieren (großer Season-Datensatz) — ggf. Fit in deferred Job/Cron auslagern statt im Request                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `lib/rating-model-service.ts`                                                                                        | Niedrig  |
| 4   | **Breakdown-/Matrix-/Proficiency-Views** (`routes/rating.ts` existiert backend-seitig) noch nicht im Frontend angebunden — Explainability-Iteration, kein Blocker                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `apps/frontend`, `routes/rating.ts`                                                                                  | Niedrig  |

## 3. Bekannte Stubs / 501s

| #   | Issue                                                                                                        | Pfad                                                          | Severity                             | Plan                               |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------ | ---------------------------------- |
| 1   | **DOUBLE_ELIMINATION wirft 501**                                                                             | `apps/backend/src/routes/bracket.ts:275`                      | Mittel — UI bietet das Format an     | Eigenständiger Feature-Block s. §6 |
| 2   | **Tournament-Edit/Delete-Buttons sind Stubs**                                                                | `TournamentDetail.tsx:151,160`                                | Mittel — Admin-Flow blockiert        | §2.1                               |
| 3   | **Scraper-Write-Path** wirft "not implemented"                                                               | `scraper/src/cli.ts:148,155`                                  | Mittel — Datenhebel ungenutzt        | M7                                 |
| 4   | `Tournament.poster_url` Upload-Flow fehlt                                                                    | `packages/db/prisma/schema.prisma:172`                        | Niedrig                              | M6 optional                        |
| 5   | `SigillumSection`-Community-Links Platzhalter                                                                | `apps/frontend/src/components/landing/SigillumSection.tsx:93` | Niedrig                              | M6                                 |
| 6   | `ImportLog` ohne Admin-UI                                                                                    | —                                                             | Niedrig                              | M6                                 |
| 7   | `Team`/`TeamMember`-Models reserviert, ungenutzt                                                             | `schema.prisma:286`                                           | —                                    | M9                                 |
| 8   | **MatchDetailPage ist ganzseitiger Stub** („Full match view (scores, result reporting) — coming in Welle D") | `apps/frontend/src/routes/MatchDetailPage.tsx:90-95`          | Mittel — nutzer-sichtbarer Kern-Flow | §P1a (in Arbeit)                   |

Sonst keine `@ts-expect-error`, kein `FIXME`/`HACK` — Codebase ist sauber.

---

## 4. M6 — Hub-Foundation _(1–2 Wochen)_

**Ziel:** Die Plattform fühlt sich nach M6 personalisiert, hierarchisch und visuell konsistent an. Alle Punkte unter 1 Tag Arbeit, alle Daten existieren.

1. **Tournament-Lifecycle-UI** (§2.1) — Edit/Delete/Status-Transition
2. **Head-to-Head Player Stats** — Route `/users/$a/vs/$b`, Direktbegegnungs-History. Match-Daten existieren, nur Aggregation + UI
3. **`preferred_factions`-Personalisierung** — Landingpage zeigt "Dein Meta" (Winrate-Trend der gewählten Fraktionen, 30 Tage). Feld existiert (`schema.prisma:107`), wird im Onboarding befüllt, nirgends ausgewertet
4. **Tournament-Kalender-View** + iCal-Export (RFC 5545) — alle Daten da, nur ein Render-Modus
5. **Major/Regular Tournament UI-Distinction** — Badge auf Cards, Filter auf Liste, Landingpage-Hervorhebung. `Tournament.is_major`-Flag existiert ungenutzt (`schema.prisma:187`)
6. **Echte Community-Links setzen** — Discord-Server-ID, GitHub-Repo, Reddit (`SigillumSection.tsx:93`)
7. **ImportLog Admin-UI** — Scraper-Lauf-Sichtbarkeit, paginierte Liste analog zu AuditLog
8. **`Tournament.poster_url`-Upload-Flow** (optional)

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

## 6. DOUBLE_ELIMINATION — eigenständiger Feature-Block

**Nicht trivial.** Match-Schema hat aktuell nur `next_match_id` (Single-Link, `schema.prisma:258`). Für DoubleElim braucht's:

1. **Prisma-Migration:** `loser_next_match_id String? @db.Uuid` mit Self-Relation, Enum `BracketSide { WINNERS, LOSERS, GRAND_FINAL }` + Feld `Match.bracket BracketSide @default(WINNERS)`. Optional: `Match.grand_final_reset Boolean`
2. **Lib-Funktion** `generateDoubleElim()` in `apps/backend/src/lib/bracket.ts`
3. **Loser-Drop-Progression** in `apps/backend/src/routes/matches.ts`
4. **`BracketResponse`-DTO erweitern** — separate Listen für Winners/Losers/Grand-Final
5. **Frontend-Rendering** — zwei Bracket-Trees + Grand-Final
6. **Tests** — Unit + Integration + Visual

**Aufwand:** 1–2 Tage solide Arbeit. Eigener PR, eigener Plan-File. Direkt nach M6.

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
