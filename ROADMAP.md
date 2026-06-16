# ROADMAP — Rizzotto

> **Stand:** 2026-06-15 · **Phase:** Live — v1 ausgeliefert, M8 Open Play live, Open-Beta-Turnier gelaufen · **Domain:** rizzotto.gg (Prod-Betrieb: Luke)
>
> Diese Roadmap ist die **SSOT** für _was läuft_, _was als nächstes drankommt_ und _was bewusst nicht gebaut wird_. Sub-Pläne (Detail-Plans für einzelne Tracks) liegen unter `~/.claude/plans/`, nicht im Repo. Historie und Welle-Specs siehe `docs/archive/`.

---

## TL;DR

- **rizzotto.gg ist live seit 2026-05-19** auf Hetzner CX22, Caddy + Cloudflare-Origin-Cert. **Rollenmodell seit 2026-06-04:** Alex = Product Owner + lokale Entwicklung, Luke = Prod-Betrieb (Server, Cloudflare, Deploys). **Seit 2026-06-09:** Alex' Agent pusht direkt auf `main` und deployt selbst (Push→Auto-Deploy, `workflow_dispatch`-Fallback); Server/Cloudflare/Secrets bleiben bei Luke (s. §5 Arbeitsmodell).
- **M1–M6 + Welle 2 + DOUBLE_ELIMINATION + Dynamic Weighted Leaderboard sind durch.**
- **M7 Launch v1 „Match Hub" ist ausgeliefert** (alle §5-Items done): Match-Klärung (BPT-Pick, 4 Map-Modi, Lobby-Code, Game-Kacheln), Decision-Flow, SFT-Hidden-Fix, Withdraw, Bracket-Reset, Englisch-only — alles live. **Open-Beta-Turnier** wurde gespielt (Swiss SFT + Playoffs), die Generalproben deckten viele Bugs auf, die in den Post-Launch-Wellen (§5.7) behoben wurden.
- **M8 Open Play / Ladder ist live** (merge 12.06.): Queue, Availability-Kalender, Challenges, Discord-Lobby-Finder. **Discord-Bot RizzBOTto läuft in Prod** (Token gesetzt ~14./15.06.) — alle bot-abhängigen Features (Check-in-Reminder, 1h-Match-Reminder, Lobby-Finder) aktiv. **MATRIX-Mode** (3×3-Faction-Matrix, eigentlich M12) wurde ebenfalls gebaut.
- **Reprioritisiert (Prio-Session 2026-06-04, Stand nach M8):** M8 ✅ ausgeliefert → Datentiefe M9 (§8.1), UGC M10 (§8.2), Team-Play M11 (§8.3), **Army-Lists/SLT M12 on hold (§8.4, Re-Eval jetzt fällig — v1 ist live)**.
- **Bewusst geparkt:** In-App-Listenbauer, Live-Stream-Embed, Achievements, Coaching, Multi-Tenant, Native-App, Draft-Builder für fremde Hosts (§9).

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
| **M7 Launch v1 „Match Hub"**     | ✅ done (2026-06-08)    | Decision-Flow im Match-Panel, BPT Blind-Pick, 4 Map-Modi, Game-Kacheln, Lobby-Code, SFT-Hidden-Fix, Withdraw, Bracket-Reset, Englisch-only, Map/Faction „Select all". Generalproben (Swiss SFT + BPT) gelaufen (§5.3–§5.5) |
| **M8 Open Play / Ladder**        | ✅ live (2026-06-12)    | Queue (Redis-Matching), Availability-Kalender + Heatmap, Challenges/ScheduledMatchup, Discord-Lobby-Finder. Schema: `Match.tournament_id` nullable + `MatchType`, `AvailabilitySlot`, `ScheduledMatchup` (§7) |
| **Discord-Bot RizzBOTto**        | ✅ live (~2026-06-15)   | HTTP-Interactions (Ed25519), Token in Prod gesetzt (Luke). Aktiv: Check-in-Reminder (T-60min), 1h-Match-Reminder + Ready-Check, Lobby-Finder/Queue, Pairing-/Dispute-Notifications |
| **MATRIX-Mode (3×3-Faction)**    | ✅ done (2026-06-11)    | Blind 3 Fraktionen → 3×3-Ban-Grid. `MATRIX` in `TournamentMode`, `MatchFactionMatrix`-Model, `routes/faction-matrix.ts`, Socket-Event, UI (vorgezogen aus M12) |
| **Replay-Download**              | ✅ done (2026-06-13)    | Upload + Download (`@fastify/static`, `/uploads`), Caddy-Routing committed (`deploy/Caddyfile`). Live-Reload `/etc/caddy/Caddyfile` ist Luke-Server-Task |
| **Post-Launch-Härtung**          | ✅ live (06-13/14)      | Auto Swiss Repair, FORFEIT-Semantik, Match-Control (Restore/Cancel/Void), Admin-Matches-Tab, Drop/Undrop/Late-Joiner, sortable User-Mgmt, Mirror-Vermeidung (Swiss) (§5.7) |

---

## 2. Nächste Session — sofortiges Backlog

### 2.1 ~~Tournament-Lifecycle-UI~~ ✅ done

Bundled in `f4e3705` und deployed 2026-05-20: Delete-Button, Status-Transition (Publish), Edit-Page — alle drei live in `TournamentDetail.tsx`.

### 2.2 Externe Integrationen freischalten

| #   | Item                                                                          | Wo                           | Notiz                                                                 |
| --- | ----------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| 1   | ~~`STEAM_WEB_API_KEY` in `/etc/rizzotto/env/backend.env` setzen~~             | Server                       | ✅ done 2026-05-20                                                    |
| 2   | ~~**`DISCORD_BOT_TOKEN`** in env setzen + Discord-Bot starten~~ ✅ **done (~2026-06-15)** — Token + `DISCORD_PUBLIC_KEY` in Prod gesetzt (Luke), RizzBOTto läuft (HTTP-Interactions). Alle Notify-/Bot-Features live | Server + Discord-Application | ✅ done |
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

### 2.6 Session 2026-06-04 (Alex) — Tournament-Flow end-to-end + Findings

Alex' erstes lokales Probeturnier (9 Spieler, Single-Elim, Dummy-User) deckte massive UI-Löcher im Kern-Flow auf — Backend war jeweils fertig, Frontend fehlte. Alles gefixt + committet (lokal, Push ausstehend):

| Item | Status |
| --- | --- |
| **Tournament-Registration-UI** — Anmelde-Button + Teilnehmerliste existierten nie; kein Spieler konnte sich je über die Site anmelden (`RegisterButton.tsx`, `ParticipantsList.tsx`) | ✅ done |
| **Lifecycle-Buttons** — „Anmeldung schließen" + „Turnier starten" fehlten (nur Publish existierte, §2.1 war unvollständig) | ✅ done |
| **SE-Generator-Bug (non-pow2):** Play-in-Ziel wurde bei 5/9/12… Spielern vorzeitig als BYE finalisiert — Spiegel des DE-Fixes vom 03.06., jetzt feeder-aware (`lib/bracket.ts` + Regression-Tests) | ✅ done |
| Bracket: Spielernamen + Avatare statt UUIDs, Score-Modal-Namen, Full-width-Breakout + 70vh | ✅ done |
| Faction-Select im Score-Modal (füttert Heatmap/MatchupStats) | ✅ done |
| Dummy-User-Seeder `pnpm db:seed:dummies` (--tournament, --with-factions; nur lokale DB) | ✅ done |
| `db:migrate`/`db:migrate:deploy` Root-Scripts: fehlendes `exec` | ✅ done |
| Logo-Rebrand-Assets (§2.5 D) — Cast-Iron-Wordmark/Sigil/Favicon/og-image + `wordmark-contrast`-Utility | ✅ done |

**Neue offene Items:**

| # | Item | Notiz |
| --- | --- | --- |
| 1 | **Abmelden/Withdraw-UI** — Backend-Endpoint existiert (`POST /api/tournaments/:slug/withdraw`, `participants.ts`), nur Frontend fehlt | → **M7 (§5.2)** |
| 2 | **Bracket-Reset-Feature** — Soft-Delete-Matches kollidieren mit Unique `(tournament_id, round, match_number)` beim Re-Generate; braucht partiellen Index oder Hard-Cleanup im /start | → **M7 (§5.2)** |
| 3 | ~~**ONBOARDING.md ergänzen:** `pnpm -F @rizzotto/frontend run images:optimize` + `playwright install chromium`~~ ✅ done (2026-06-04) — `images:optimize` als Pflichtschritt in Teil 4 (inkl. Warnbox: kein PNG-Fallback bei 404), korrekter `-F @rizzotto/e2e`-Install-Befehl in Teil 6 | beide Lücken kosteten Alex Zeit |
| 4 | ~~`MatchScoreModal`/`CheckInButton` hardcoded deutsch/englisch~~ — aufgegangen in **Englisch-only** (Alex 2026-06-04: deutsche Version unnötig, Site konsistent Englisch) | → **M7 (§5.2)** |
| 5 | ~~**M7-Reprioritisierung (Alex)**~~ ✅ done (2026-06-04) — Prio-Session durchgeführt, ROADMAP umgebaut: M7 = Launch v1 (§5), Open Play → M8 (§7), Army-Lists/SLT/3×3 → M12 on hold (§8.4) | Product-Owner-Entscheidung |
| 6 | ~~**Push + Deploy der Session-Commits**~~ ✅ done (2026-06-04) — Push löste rote CI aus (Visual-Baselines, §2.7), nach Fix CI grün + Deploy success, Live-Smoke verifiziert | Push → CI → Auto-Deploy live |

### 2.7 Session 2026-06-04 (Tag) — CI-Fix, Live-Verifikation, Prio-Session

- **CI-Fix:** CI #70 war rot — 3 Landing-Visual-Baselines nach Logo-Rebrand veraltet (einziger Failure; Deploy #25 deshalb geskippt). Actual-PNGs aus dem `playwright-report`-CI-Artifact als neue Linux-Baselines übernommen (`07e88cd`) → CI grün, Deploy success. **Lehre:** Logo-/Landing-Änderungen ⇒ Linux-Baselines aus dem CI-Artifact mitziehen (auf Windows nicht generierbar).
- **Live-Smoke grün:** Registration-Button + Teilnehmerliste live (`test-turnier`), Cast-Iron favicon/og-image live. **Offen:** `https://rizzotto.gg/img/rizzotto-wordmark.avif` hängt im Cloudflare-Edge-Cache (HIT, Stand 03.06.) → **Luke: Custom Purge** (s. §5.3 Checkliste).
- **Rollenmodell geklärt:** Alex = PO + lokale Entwicklung, Luke = Prod-Betrieb (bewusst, Alex hat keinen Cloudflare-/Server-Zugang und will keinen). Feature-Arbeit künftig auf `feat/launch-v1`, Handover = PR.
- **Decision-Flow-Audit** (Grundlage für §5.1): `GET /api/matches/:id/decision` und `POST …/decision/random` existieren im Backend **nicht**, werden vom Frontend aber aufgerufen → `MatchDecisionPage` ist live de facto tot; Socket-Room-Join für `match_decision_*` fehlt (unverifiziert); einziger Entry-Point ist `MatchDetailPage`, keiner im Bracket. **SFT-Leak:** `faction` wird entgegen FieldHint („revealed at tournament start") sofort öffentlich serialisiert (`participants.ts` GET). PICK_BAN funktioniert nur bei Pool = 3 (kein expliziter Pick-Step), RANDOM ohne Re-Pick-Schutz.
- **Tech-Debt neu:** Cache-Busting für `public/img`-Assets (Dateinamen-Versionierung o. ä.); `DraftService forceAutoSelect`-PrismaError im CI-WebServer-Log (Tests grün, beobachten).

### 2.5 Landing/Nav Design-Feedback (Alex, 20.05. → re-iteriert + umgesetzt 03.06.)

Vier annotierte Screenshots von Alex (Stand 20.05.), gegen aktuellen Stand geprüft. Alle Punkte umgesetzt; nur B2 bleibt deferred, F wandert mit dem Listen-Block nach M12.

| #   | Item                                                                                                                                 | Pfad                                       | Status                                |
| --- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------- |
| A1  | Redundanten „Home"-Nav-Link entfernt (Logo bleibt Home)                                                                              | `components/layout/Header.tsx`             | ✅ done                               |
| A2  | „Turniere"-Nav-Reiter ergänzt (Route `/tournaments` + i18n-Key `header.tournaments` existierten bereits)                            | `Header.tsx`                               | ✅ done                               |
| A3  | „View all" der Live-Tournaments → `/tournaments` (zeigte fälschlich auf `/`)                                                         | `landing/ActiveMustersSection.tsx`         | ✅ done                               |
| A4  | „Take up arms" auth-aware: eingeloggt → `/tournaments`, sonst → `/login` (bleibt immer sichtbar)                                     | `landing/HeroSection.tsx`                  | ✅ done                               |
| A5  | Toten „Read the Manifesto"-CTA entfernt (Library-Section hatte kein Backing)                                                         | `landing/ForgeSection.tsx`                 | ✅ done                               |
| B1  | Spielerzahl „—" gefixt: List- **und** Detail-Endpoint serialisieren jetzt `participantCount` aus `_count.participants`              | `backend/routes/tournaments.ts`            | ✅ done                               |
| B2  | „Live Tournaments"-Feed holt alle Status gemischt — Filter auf ONGOING/UPCOMING erwägen                                            | `ActiveMustersSection.tsx`                 | 🟡 deferred                           |
| C   | Rebrand sichtbarer Text → „RizzOtto's Arena" (index.html, i18n de/en, Footer-©, Header/Icon-aria, Discord-Notify, iCal). Domain/Dateinamen bleiben `rizzotto.gg`/`rizzotto-*` | div. Frontend + Backend                    | ✅ done (Text)                        |
| D   | ~~**Neues Logo/Sigil-Asset**~~ ✅ done (2026-06-04) — Cast-Iron-Logo von Alex eingebaut (Wordmark/Sigil/Favicon/og), Gamma-Aufhellung + CSS-Kontrast-Glow | `apps/frontend/public/img/*`, favicon, og  | ✅ done (lokal committet)             |
| E   | ~~**Alex auf ORGANIZER hochstufen**~~ ✅ war bereits erledigt — Alex sieht Create-Tournament auf Prod (Rolle vorhanden); lokal ist er ADMIN | Admin-Panel / DB                           | ✅ done                               |
| F   | Library-Section reaktivieren als Einstieg zum Army-List-Browser                                                                      | `ForgeSection.tsx`                         | → M12 (§8.4) — on hold                |

---

## 3. Bekannte Stubs / 501s

| #   | Issue                                                                                                        | Pfad                                                          | Severity                             | Plan                               |
| --- | ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------- | ------------------------------------ | ---------------------------------- |
| 1   | ~~**DOUBLE_ELIMINATION wirft 501**~~ ✅ **gelöst (2026-06-03)** — Format end-to-end implementiert     | `apps/backend/src/routes/bracket.ts`                          | —                                    | s. §6                              |
| 2   | ~~**Tournament-Edit/Delete-Buttons sind Stubs**~~ ✅ done — Lifecycle-UI gelandet (§2.1, `f4e3705`)          | `TournamentDetail.tsx`                                        | —                                    | §2.1                               |
| 3   | ~~**Scraper-Write-Path** wirft "not implemented"~~ ✅ **done** — `tournaments`-Command persistiert via `externalGame.upsert` (`cli.ts:148`); kein separates `ExternalTournament`-Model (denormalisiert auf `ExternalGame`). Verbleibendes `throw` (`cli.ts:60`) ist eine valide „no active season"-Guard | `scraper/src/cli.ts`                                  | —        | ✅ done                          |
| 9   | ~~**`GET /api/matches/:id/decision` + `POST …/decision/random` fehlen im Backend**~~ ✅ **done** — Endpoints implementiert (GET Zeile 185, POST random Zeile 623, blind-pick lock Zeile 676 in `match-decision.ts`); `BlindPickPhase`-UI in `MatchDecisionPage.tsx` fertig | `apps/backend/src/routes/match-decision.ts` | — | ✅ M7 |
| 10  | ~~**SFT-Fraktions-Leak:** `faction` ist entgegen FieldHint sofort öffentlich~~ ✅ **done (2026-06-05)** — GET participants maskiert `faction: null` wenn mode=SFT und Status nicht ONGOING/COMPLETED | `apps/backend/src/routes/participants.ts` | — | M7 (§5.1 #5) |
| 11  | **PICK_BAN nur bei Pool = 3 funktional** (kein expliziter Pick-Step); **RANDOM ohne Re-Pick-Schutz**          | `apps/backend/src/routes/match-decision.ts`                   | Mittel                               | M7 (§5.1 #3)                       |
| 4   | `Tournament.poster_url` Upload-Flow fehlt                                                                    | `packages/db/prisma/schema.prisma:172`                        | Niedrig                              | M6 optional                        |
| 5   | ~~`SigillumSection`-Community-Links Platzhalter~~ ✅ **done** — echte URLs gesetzt (Discord `discord.gg/MX3cs6gA54`, YouTube `@RizzOttoGaming`) | `apps/frontend/src/components/landing/SigillumSection.tsx` | —                              | ✅ done |
| 6   | ~~`ImportLog` ohne Admin-UI~~                                                                                | —                                                             | Niedrig                              | ✅ done (2026-06-03) — §4.7        |
| 7   | `Team`/`TeamMember`-Models reserviert, ungenutzt                                                             | `schema.prisma:286`                                           | —                                    | M11 (§8.3)                         |
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

## 5. M7 — Launch v1 „Match Hub" — ✅ **AUSGELIEFERT** _(Alex-Spec, Prio-Session 2026-06-04)_

> **Status:** Alle Kern- (§5.1) und Begleit-Items (§5.2) sind live; Generalproben gelaufen (§5.3–§5.5). Post-Launch-Bugfix-Wellen siehe §5.7. Der historische Verlauf (§5.1–§5.6) bleibt als Referenz erhalten.

**Ziel:** Alles, was zum Match zu klären ist, lebt **im Match-Panel auf der Turnierseite** — keine Discord-DMs, kein externes Draft-Tool. Das ist der intrinsische Mehrwert gegenüber dem Status quo der Szene (Totaltavern: Bracket auf TT, Draft auf aoe2cm, Matrix + Map-Bans per Discord-DM). **BPT + SFT decken 80–90 % der real gespielten Turniere ab** — sie sind der v1-Scope; das mit Abstand häufigste Format ist **Swiss SFT, 4–5 Runden + Top-4-Playoffs**.

**Arbeitsmodell (seit 2026-06-09):** Alex' Coding-Agent pusht **direkt auf `main`** (kein PR/Review-Gate mehr) und löst den Deploy selbst aus — Push → CI → Auto-Deploy via `workflow_run`, plus `workflow_dispatch` als manueller Fallback, falls die Kette hängt. Pflicht-Gate vor jedem Push: `pnpm typecheck && pnpm lint && pnpm test && pnpm build` grün; bei UI-/Landing-Änderungen keine `*-win32.png`-Snapshots committen (Linux-Baselines via CI-Artifact). Prod-Betrieb (Server, SSH, Cloudflare, DNS, Secrets) bleibt bei Luke; Alex hat dafür weiterhin keinen Zugang. _(Vorheriges Modell bis 2026-06-08: Feature-Branch `feat/launch-v1` → PR → Luke-Merge.)_

### 5.1 Kern — Match-Klärung im Match-Panel

1. **Decision-Flow reparieren** (Audit §2.7): `GET /api/matches/:id/decision` implementieren (Frontend ruft sie bereits — 404), `POST /api/matches/:id/decision/random` implementieren, Socket-Room-Join für `match_decision_*` verifizieren/bauen
2. **Match-Panel** auf der Turnierseite, außerhalb der Bracket-View (Alex-UI-Spec): das eigene aktuelle Match mit Spielern, Avataren, Fraktionen, Map und Phase-Status — alle Klärungs-Aktionen inline, Bracket verlinkt hinein. Inkl. **Lobby-Code-Feld** (Host trägt den Ingame-Code ein, Gegner sieht ihn — damit entfällt der letzte DM-Anlass). **Game-Kacheln (Alex-Spec 2026-06-04):** pro Game der Serie eine Kachel, sequenziell aktiviert (Bo1 = eine Kachel; Serie endet, sobald entschieden — Bo5 ggf. nach 3 Games); jede Kachel trägt ihren eigenen Map-/Faction-Klärungs-Vorgang. Mappt 1:1 auf das vorhandene `MatchGame`-Modell
3. **Vier Map-Modi** (ersetzen heutiges RANDOM/PICK_BAN):
   - a) **Random pro Runde** — ohne Map-Wiederholung im selben Turnier (Re-Pick-Schutz neu)
   - b) **Host-Preset, 1 Map pro Runde** — keine Spielerwahl (Schema: Runden-Map-Zuordnung neu)
   - c) **Host-Preset, 3 Maps pro Runde** — Coin-Flip bestimmt Banner (1 Ban), der Gegner **pickt explizit** aus den verbleibenden 2
   - d) **Random 3 aus dem Pool** — gleicher Ban→Pick-Ablauf wie c)
   - **Serien (Bo3/Bo5):** Der eingestellte Modus läuft **pro Game-Kachel** neu; innerhalb einer Serie keine Map-Wiederholung (gespielte Serien-Maps fliegen aus den Kandidaten)
4. **BPT im Panel:** verdeckter Fraktions-Pick per Dropdown, beidseitiger Lock, simultaner Reveal. **Sequenz:** nach Map-Bekanntgabe bei Modi a/b, **vor** der Map-Phase bei Modi c/d. **Serien-Option (Host-Checkbox im Create-Form):** Blind-Pick gilt **pro Game** oder **einmal pro Serie** — Host entscheidet beim Erstellen
5. ~~**SFT fixen:** Fraktion wird bei Anmeldung gewählt, bleibt aber **hidden bis Turnierstart**~~ ✅ **done (2026-06-05)** — `GET /api/tournaments/:slug/participants` gibt `faction: null` für alle Teilnehmer zurück, solange Status nicht `ONGOING` oder `COMPLETED`
6. ~~**Mode-Cleanup:** `OPEN` **entfernen**~~ ✅ **done (2026-06-05)** — `OPEN` aus `TournamentMode`-Enum entfernt, BPT ist neuer Default; Migration `20260605000000_remove_open_mode` appliziert; Blind-Pick-Guard in `match-decision.ts` auf nur `BPT` reduziert

### 5.2 Begleiter — Organisator- & UX-Basics

7. ~~**Withdraw-UI**~~ ✅ **done (2026-06-05)** — 2-Stufen-Confirm in `RegisterButton.tsx`; `withdrawFromTournament()` in `api.ts`; invalidiert tournament/participant-me/tournament-participants
8. ~~**Bracket-Reset**~~ ✅ **done (2026-06-05)** — `POST /api/tournaments/:id/bracket/reset`: nullt Self-Referenz-FKs, `deleteMany` Matches (cascaded), setzt Status auf `REGISTRATION_CLOSED`. Frontend: oranges Reset-Button in Admin-Controls (nur bei ONGOING). Lösung für Unique-Constraint: Hard-Delete statt Soft-Delete + FK-Null-Pass vor Delete
9. ~~**Englisch-only**~~ ✅ **done (2026-06-05)** — `LanguageToggle.tsx` gelöscht, Header bereinigt; alle DE-Strings in 13 Dateien → EN (bracket, draft, admin, tournament, calendar, H2H, preset-Bereiche)
10. ~~**UI-Kleinkram:** Map-Pool **„Select All"**~~ ✅ **done** — „Select all/Deselect all"-Toggle für Map-Pool **und** Faction-Pool, in Create- (`TournamentCreateForm.tsx:734,836`) und Edit-Form (`TournamentEditPage.tsx:907,1002`)

### 5.2b Session 2026-06-05 — M7-Begleit-Items + Bugfixes ✅

| Item | Status |
|---|---|
| **Coin-Toss-Bug (Runde 2):** `decisionPreloaded=true` übersprang Animation auch bei frischer Navigation — Fix: `state: { freshDecision: true }` in GameTile navigate, `useRouterState` in MatchDecisionPage zum Auslesen, `decisionPreloaded` nur setzen wenn Flag fehlt | ✅ done |
| **SFT Hidden-Fix** (§5.1 #5) — GET participants maskiert faction vor Turnierstart | ✅ done |
| **Englisch-only** (§5.2 #9) — LanguageToggle raus, 13 Dateien DE→EN | ✅ done |
| **Withdraw-UI** (§5.2 #7) — 2-Stufen-Confirm in RegisterButton | ✅ done |
| **Bracket-Reset** (§5.2 #8) — Backend + Frontend | ✅ done |
| **Mode-Cleanup** (§5.1 #6) — OPEN aus TournamentMode entfernt, BPT Default | ✅ done |
| **Onboarding „Build Your First List"-Step entfernt** — Stage 3 aus OnboardingOverlay; Tour springt direkt zu „Done" | ✅ done |
| **DB-Migration-Reset** — Migration-History-Inkonsistenz aus Session 04 bereinigt; migrate reset + seed + Drift-Migration `20260605054848_fix_enum_drift` | ✅ done |
| **feat/launch-v1 gepusht** zu origin | ✅ done |

### 5.3 Generalprobe & gestufter Launch

11. **Lokale Generalprobe:** Swiss SFT, 4–5 Runden + Top-4-Playoffs mit `db:seed:dummies` — **abgeschlossen (2026-06-06), alle Runden + Playoffs gespielt.** Zahlreiche Bugs gefunden und gefixed (Faction-Latch, GL-Berechnung, All-Games-Architektur, Leaderboard-Pfade, Match/Game-Terminologie-Konvention).
12. ~~**Handover-PR** an Luke~~ — **obsolet:** Arbeitsmodell seit 09.06. direkter `main`-Push + Auto-Deploy (git-History bestätigt), kein PR-Gate mehr
13. **Luke-Checkliste (extern):** ✅ `DISCORD_BOT_TOKEN` + `DISCORD_PUBLIC_KEY` gesetzt · ✅ echte Community-Links (`SigillumSection`). **Serverseitig offen / Status bei Luke (nicht aus Repo verifizierbar):** Cloudflare Custom Purge `rizzotto-wordmark.avif` (vermutlich durch OG-Reworks überholt) · Hetzner-VM-Backup (~1.68 €/mo) · `Caddyfile`-Live-Sync inkl. Replay-`/uploads/*`-Reload (§2.3 #1)
14. **Stufe 1 — geschlossener Kreis:** ✅ Open-Beta-Turnier (Swiss SFT + Playoffs) auf rizzotto.gg gespielt — diente als realer QA-Lauf (Quelle der §5.7-Bugfix-Wellen)
15. **Stufe 2 — öffentlich** (Reddit/Foren): noch offen — nach weiteren sauberen Stufe-1-Turnieren

**Offene Items aus Generalprobe (vor Handover-PR abschließen):**
- [x] Meta-Overview-Counter: aus All-Games-Quelle statt FactionStats — ✅ done (2026-06-06, direktes `prisma.match.count()`)
- [x] Faction-Diversity-Metrik: Pielou's J — ✅ done (2026-06-06, `meta.ts` + `resolvers.ts`)
- [x] Heatmap-Achsen: alphabetisch — ✅ done (2026-06-06, `name.localeCompare()`)
- [x] Leaderboard: Faction-Filter entfernen, Null-Factions = neutrale Gewichtung — ✅ done (2026-06-06)
- [x] Feature: Faction-Beschränkung bei Turniererstellung — ✅ done (2026-06-06, `TournamentFactionAllowlist`, Backend + Frontend-Fieldset)
- [x] Leaderboard auf Game-Ebene (MatchGame) umgestellt — ✅ done (2026-06-06, `loadSeasonObservations` + `loadConfirmedGames` via Match-first + Game-Expansion; `totalMatches` → `totalGames` in DTO + UI)
- [ ] **FactionStats-Drift bei Overrides:** Counter über-inkrementiert → mittelfristig Recalculate-Endpoint oder Event-Sourcing (post-v1)
- [x] **Generalprobe abgeschlossen** — ✅ done (2026-06-06)
- [x] **ELO-System entfernt** (placement-basiert, faction-blind, zu wenig Datenmasse für kleine Szene) — ✅ done (2026-06-07, Migration `remove_elo`)
- [x] **Win-Rate-Tab** auf dynamische MatchGame-Quelle umgestellt (war: `LeaderboardEntry`, jetzt: `computeSeasonLeaderboard`) — ✅ done (2026-06-07)
- [x] ~~**Handover-PR** feat/launch-v1 → main~~ — **obsolet:** seit 09.06. direkter `main`-Push; Code ist längst auf `main` + deployed
- [ ] **post-v1: `LeaderboardEntry.games_played/wins/losses` entfernen** — redundant, dynamisch aus MatchGame berechenbar; nur noch `total_points` für All-Time-Tab nötig

### 5.4 Session 2026-06-07/08 — BPT-Generalprobe + Feature-Welle

| Item | Status |
|---|---|
| **Liechtenstein-Format** — Pre-randomised Swiss, alle Runden vorab generiert, kein Balancing, Rematches via RR-Algorithmus ausgeschlossen. `lib/liechtenstein.ts`, `LIECHTENSTEIN` in TournamentFormat-Enum, vollständig in Dispatcher/Standings/Playoffs/Finalize verdrahtet | ✅ done |
| **Map-Images** — 86 Maps mit Imgur-URLs aus TT Map Notes.xlsx extrahiert (Python, openpyxl); `seed.ts` auf `MAP_DATA[]` mit `image_url` umgestellt. Blasphemous Snowfield als lokales Asset in `public/maps/`. Itza ohne Bild (Legacy-Map, nicht im Spreadsheet) | ✅ done |
| **Bracket-Kandidaten-Labels** — Statt „BYE" in zukünftigen Runden: „Grombrindal / Louen" (feeder-Spieler). `SVGBracket` baut `slotLabels`-Map, `MatchNode` empfängt `p1SlotLabel`/`p2SlotLabel` | ✅ done |
| **Map-Thumbnail + Lightbox in GameTile** — Mini-Bild unter Mapname (`object-contain`, proportional skaliert), Klick öffnet Vollbild-Overlay (`fixed inset-0 z-50`), Escape/Backdrop/×-Button schließt | ✅ done |
| **Discord-Timestamp-Button** — `⏱ Discord`-Button neben Turnierdatum in `TournamentDetail`; kopiert `<t:UNIX:F>` in Clipboard. `toDiscordTimestamp()` in `lib/timezone.ts` | ✅ done |
| **Fraktionen alphabetisch** — `getFactions()` in `api.ts` sortiert jetzt an der Quelle via `.sort((a,b) => a.faction.name.localeCompare(b.faction.name))`. Galt für alle Consumer gleichzeitig | ✅ done |
| **BPT Blind-Pick — mehrere Bugs gefixt** — (1) `game.decision.blindPick` existiert nicht; korrektes Feld ist `game.blindPick` (top-level auf `GameDto`). (2) `decisionComplete` warf JS-loose-equality-Fallstrick: `undefined == null === true`. (3) `isPlayer1` in `BlindPickPhase` nutzte Coin-Flip-Reihenfolge (`topPlayerId`) statt Match-Reihenfolge (`matchPlayer1Id`) → Backend gibt `matchPlayer1Id` jetzt zurück. (4) `lockBlindPick` schluckte Fehler still; jetzt mit Error-Display + Query-Invalidation nach Erfolg. (5) `MatchDecisionPage.resolvePhase` erkannte BPT-Blind-Pick-Phase nicht wenn `blindPick === null` (vor erstem Lock) | ✅ done |
| **Blind-Pick Auto-Resolve Cron** — `lib/blind-pick-auto-resolve.ts`: findet Blind-Picks wo ein Spieler > 2 min gewartet hat, assigned zufällige Fraktion (exkl. bereits gewählter Fraktion des Partners), emittiert Socket-Event. `cron.ts` registriert Job `*/1 * * * *`. Frontend: `BlindPickCountdown`-Komponente zeigt `Auto-pick in 1:47`-Countdown ab `firstLockedAt` | ✅ done |
| **Bracket Auto-Fit** — Removed `, 1`-Cap in `BracketView.ts:centerView()` und Reset-Button; kleines 8-Spieler-Bracket füllt jetzt den Container statt bei 100% zu stoppen | ✅ done |
| **MyMatchSection: nur bei bekannten Gegnern** — Guard `m.player1Id !== null && m.player2Id !== null` verhindert frühe GameTile-Anzeige vor SF-Ergebnis in SE | ✅ done |
| **Third-Place-Match-Option** — `has_third_place_match Boolean` auf Tournament; `PLAYOFF_THIRD_PLACE` in `MatchPhase`-Enum. SE: via `generateSingleElim(opts.hasThirdPlace)`; Playoffs: `advance-playoffs` erstellt 3rd-Place-Match gleichzeitig mit GF, mit bereits gefüllten SF-Verlierern + retroaktives `loser_next_match_id`-Update auf SFs. UI: Checkbox im Create-Form, „3rd Place"-Badge im `MatchNode` | ✅ done |
| **MatchDecisionPage** — 5s-Refetch-Interval (`refetchInterval: 5000`) damit Cron-Updates ohne Socket ankommen. `← Back to tournament`-Link oben links | ✅ done |
| **BPT-Generalprobe Phase 2** — Einzelne Runde + Blind-Pick von Ende zu Ende getestet; zahlreiche Bugs gefunden und gefixt (s.o.) | ✅ done (partiell — Playoffs noch nicht getestet) |

**Offen vor Handover-PR (Stand §5.4):**
- [x] **Duplicate Map-Records bereinigen** — ✅ done (2026-06-08): Map-Pool auf kanonische 36 Maps zurückgebaut, `seed.ts` korrigiert, DB-Cleanup via `prisma/cleanup-maps.ts`. Korrekte In-Game-Namen laut Alex: Bleakspire Labor Camp, Glade of the Everqueen, Rifts at World's Edge, Skjalandir's Cave, Battle for Itza.
- [x] **Itza** — ✅ done: Kein Bild verfügbar, Map heißt korrekt „Battle for Itza", bleibt im Pool ohne Bild.
- [x] **Onboarding-Tour-Stops** — ✅ done (2026-06-08): Hardcoded strings in `OnboardingOverlay.tsx` durch i18n ersetzt, `data-testid` off-by-one gefixt.
- [x] ~~**Handover-PR**~~ — **obsolet** (direkter `main`-Push seit 09.06.)

### 5.5 Session 2026-06-08 — Edit-View, counts_for_leaderboard, SFT-Registration, Bracket-Polish

| Item | Status |
|---|---|
| **Edit Tournament — vollständige Felder + Lifecycle-Locks** — Alle Felder aus Create-Form nun auch im Edit sichtbar; Felder je nach Turnierstatus gesperrt (Draft-only: Format/Mode/Visibility/Faction-Pool; Until-ONGOING: Mechanics/Map-Pool/Dates; Always: Name/Discord/is_major/counts_for_leaderboard). Timezone aus Edit-Form entfernt (auto per Browser). Status-Badge oben | ✅ done |
| **Edit Tournament — GET lieferte fehlende Felder** — `rounds_count`, `has_third_place_match` und `map_pool`-Relation fehlten im GET-Select → Edit-Form zeigte immer Defaults | ✅ done |
| **Edit PATCH — rules null-Fehler** — `rules` ist `String @default("")` (nicht nullable); Frontend sendete null statt `""` → 422. Fix: Normalisierung auf `""`, backend `description` auf `.nullable()` | ✅ done |
| **PATCH akzeptiert nun format/mode/has_third_place_match/counts_for_leaderboard/faction_pool** — Backend `PatchTournamentSchema` erweitert; draft-only-Felder server-seitig validiert | ✅ done |
| **counts_for_leaderboard auf MatchGame denormalisiert** — Migration `20260608000000_match_game_counts_for_leaderboard` schreibt Flag bei Game-Erstellung; retroaktives Re-Stamp wenn Tournament-Flag geändert wird; Filter-Sites (`rating-model-service`, `breakdown-service`) nutzen nun direktes Feld statt Tournament-Join | ✅ done |
| **SFT-Registration: disallowed Factions grayed out** — `FactionSelectGrid` in `RegisterButton` respektiert `tournament.faction_allowlist`; nicht erlaubte Fraktionen sind disabled + halbtransparent | ✅ done |
| **SFT-Registration: Faction-Picker nutzt FactionBadge** — Visuell konsistent mit Onboarding und Blind-Pick (selbe Logo-Größe, font-display, uppercase tracking) | ✅ done |
| **Bracket-Polish** — Rote gestrichelte Loser-Connector-Linien entfernt; „3rd Place"-Badge bronze gefärbt; Grand-Final-Node: `border-2` Goldrahmen + „GRAND FINAL"-Badge in Gold | ✅ done |
| **Deutsche UI-Strings** — 9 Dateien bereinigt: TournamentDetail, BracketView, ParticipantsList, CalendarPage, FactionDetailPage, H2HPage, DraftSpectatorPage, DraftLobbyPage, PresetListPage | ✅ done |
| **Back-to-Tournament-Link** oben auf Edit-Page | ✅ done |
| **Dev-Scripts** — `prisma/fill-registrations.ts` (nutzt bestehende User zuerst), `prisma/list-users.ts`, `prisma/fix-dummy-registrations.ts` | ✅ done |

**Offen nach §5.5:**
- [x] ~~**Handover-PR**~~ — **obsolet** (direkter `main`-Push seit 09.06.)
- [x] ~~**SFT-Generalprobe mit Playoffs**~~ — ✅ durch das echte Open-Beta-Turnier (Swiss SFT + Playoffs) abgedeckt; Bugs in §5.7-Wellen behoben
- [ ] **post-v1: `LeaderboardEntry.games_played/wins/losses` entfernen** — redundant zu MatchGame-Level-Aggregation

**§5.6 Session 2026-06-09 — Playoff-Standings, Check-in, Admin-IDs, German-Strings-Final:**

| Item | Status |
|---|---|
| **Standings-Sort Root Cause** — `TournamentDetail` renderte `SwissStandings` eigenständig mit unsortierten Daten; `BracketView`-Fix griff nicht. Shared utility `lib/bracketStandings.ts` extrahiert (`sortStandingsByPlayoffResult`, `getFinalistIds`); beide Render-Stellen nutzen sie | ✅ done |
| **SF-Fallback in Standings** — GF-/TP-Match noch nicht erstellt → SF-Gewinner/-Verlierer als Proxy; alle drei States (pre-GF, GF pending, GF done) korrekt | ✅ done |
| **Check-in UI** — `CheckInButton` nicht mehr für `ONGOING`-Turniere angezeigt; `/checkin/self` lehnt Requests ab wenn Turnier bereits gestartet | ✅ done |
| **Admin: Discord ID + Steam ID** — `GET /api/users` joined `steam_link`-Relation; Tabelle zeigt beide IDs monospace + select-all | ✅ done |
| **Leaderboard Elo-Spalte** — verwaister `<th>` nach ELO-Removal entfernt; Columns wieder korrekt ausgerichtet | ✅ done |
| **Faction-Strings + Tagline** — `FactionDetailPage` übersetzt; `race`/`category`-Tagline entfernt; `H2HPage` Faction-Header | ✅ done |
| **Finaler German-Strings-Sweep** — Draft (DraftLobby, CategoryLimitsEditor, DraftLobbyPage, DraftSpectatorPage), Admin (StatsDashboard, PresetLibraryAdmin, ImportLogTable), Bracket (BracketView, MatchScoreModal), ArmyListList | ✅ done |
| **Session-Archivierung** — Stop-Hook schreibt nach jedem Turn `~/.claude/session-archives/<id>.md` | ✅ done |

**Offen (post-v1 oder Luke):**
- [ ] **Admin: Discord/Steam ID re-auth** — Luke entscheidet: ADMIN-Guard reicht oder separater Discord-Confirm-Step? (Details im PR-Body)
- [x] **Admin: User Management — sortierbare Spalten** — ✅ done (2026-06-14): Member/Role/Joined/Status per Click sortierbar (`AdminPage.tsx`)
- [ ] **post-v1: `LeaderboardEntry.games_played/wins/losses` entfernen** — redundant zu MatchGame-Aggregation; Felder werden aber noch aktiv gelesen (`leaderboard.ts`, `users.ts`, `LeaderboardPage.tsx`, `UserProfilePage.tsx`) → erst Lese-Stellen auf dynamische Aggregation umstellen
- [~] **post-v1: Mirror-Vermeidung im Swiss/Liechtenstein-Pairing** — ✅ **Swiss done** (`lib/swiss.ts` `tryAvoidMirrors()`, jede Runde). 🔴 **Liechtenstein offen** — nur passives `interleaveFactions()` beim Schedule-Aufbau, kein aktiver `tryAvoidMirrors`-Nachbearbeitungsschritt. Prio-Reihenfolge bleibt: (1) Score-Delta → (2) Rematch → (3) Mirror; nie größeres Score-Delta für Mirror-Vermeidung.
- [x] **post-v1: Discord-Check-in-Reminder** — ✅ done + **live**: Cron T-60min DMs an `REGISTERED` (`notifyCheckInReminder()` in `discord-notify.ts`, `cron.ts`). Bot läuft in Prod (§1).

### 5.7 Post-Launch-Wellen (2026-06-10 – 06-15) — konsolidiert

Nach v1 folgten sechs Sessions Feature-Ausbau + Härtung (Detail-Logs in den Session-Memories `~/.claude/projects/.../memory/session-2026-06-1X.md`). Kompakt:

- **10.06.** — CI nach Bruch (09.06.) entsperrt; Check-in-Enforcement, **Mirror-Vermeidung (Swiss)**, BPT-Faction-Pick; OG-Preview neu. **M8 Open Play** vollständig gebaut (Branch `feat/m8-open-play`).
- **11.06.** — **MATRIX-Mode** (3×3-Faction); WB/LB-Round-Presets für DE, EliminationStandings.
- **12.06.** — `feat/m8-open-play` → `main` gemergt + deployed; CI-Fixes (Test-Rolle `ORGANIZER`→`HOST`).
- **13.06.** — **Replay-Download** (Upload+Download, Caddy-`/uploads/*`); **Auto Swiss Repair**; **FORFEIT-Semantik** (Drop = BYE, kein BH-Beitrag); Standings-Overhaul (Placement-Badges, dynamische Divider); Faction-Diversity = Coverage × Evenness; OG-Image v4.
- **14.06.** — Beta-Bugfix-Tag: **Match-Control** (Restore/Cancel/Void), **Admin-Matches-Tab** (Void-Toggle, Leaderboard-Exclusion), **Drop-System** (Doppel-Drop→CANCELLED, Undrop, Late-Joiner, WITHDREW als authoritative dropped-Flag), sortable User-Mgmt, Draw=½ aus All-Games excludiert.
- **15.06.** — **Discord-Bot live** (Luke setzt Token/Public-Key in Prod) → alle bot-abhängigen Features aktiv. ROADMAP + Memory auf verifizierten Stand gebracht (diese Session).

**Verbleibendes post-v1-Backlog (codebar, verifiziert offen):** 2FT/3FT-Formate (nur Frontend-Guard `SwissStandings.tsx:51` vorbereitet) · Liechtenstein Early Clinching + aktive Mirror-Vermeidung · MMR-Matchmaking-Format · FactionStats-Recalculate-Endpoint (Drift) · `LeaderboardEntry`-Felder-Cleanup · `poster_url`-Upload-Flow (totes Schema-Feld).

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

## 7. M8 — Open Play / Ladder — ✅ **LIVE (merge 2026-06-12)**

**Ziel:** Leaderboard-relevante Matches **ohne Turnier-Commitment** — „viele Spieler scheuen sich vor dem Commitment von Turnieren" (Alex). Matchmaking auf der Site senkt die Einstiegshürde und füttert Leaderboard + Meta, bevor Spieler sich an Turniere trauen.

> **Status:** Ausgeliefert. Gebaut: nullable `Match.tournament_id` + `MatchType`-Enum, `AvailabilitySlot`- & `ScheduledMatchup`-Models; `routes/open-play-queue.ts` (Redis-FIFO-Matching), `routes/availability.ts` (CRUD + Heatmap), `routes/scheduled-matchups.ts`; Discord-Lobby-Finder (`discord-interactions.ts`) + Match-Reminder; Frontend `/open-play` (Queue/Availability/Challenges) + 1h-Match-Reminder mit Ready-Check. Anti-Farm-Kalibrierung (Item 5) bei wachsender Datenmasse beobachten.
>
> **Prio-Vermerk (erfüllt):** Open Play war Alex' Wunsch-Vorzug — ist umgesetzt. Jetzt Adoption/Feinschliff beobachten ([[produkt-prioritaeten-alex]]).

1. **Challenge-/Open-Match-Modell** (Schema-Entscheidung): `Match.tournament_id` ist heute required → nullable machen oder eigenes Challenge-Konzept. Matches tragen bereits den Season-Tag (Rating-Einbeziehung möglich); **Anti-Farm-Modifier existiert** im Rating-Modell (Validierung gegen Punkte-Schieberei)
2. **Friendlies (Bo1) + organisierte Bo3/Bo5-Series**
3. **Challenge-Flow:** erstellen (Zeit, Format, Map-Modus) → browsen/annehmen → Termin im **M6-Kalender** (+ iCal)
4. **Match-Panel-Wiederverwendung** aus v1: BPT-Pick, Map-Verfahren, Lobby-Code — identische Klärungs-UX wie im Turnier
5. **Rating:** Open-Play-Ergebnisse fließen ins Season-Leaderboard; Anti-Farming-Kalibrierung prüfen

---

## 8. Spätere Milestones — M9 / M10 / M11 / M12 _(Reihenfolge nach Stufe-1-Erfahrung re-evaluieren)_

### 8.1 M9 — Datentiefe

**Ziel:** Echte externe Turnierdaten füllen Meta/Heatmap auch ohne eigene User-Masse. (Listen-unabhängige Reste des alten M7.)

1. **Scraper-Write-Path implementieren** — `ExternalTournament`-Tabelle anlegen, totaltavern.com-Daten persistieren. `FactionStats` bekommt externe Match-Basis
2. **News-/Patch-Notes-Feed** — `News`-Tabelle (Admin-only), Frontend-Route `/news`, Landingpage-Integration (Kommunikationskanal für die Launch-Community)
3. **Realtime-Leaderboard** — Socket-Push bei Rating-Änderung (Live-Ticker-Komfort; Recording passiert ohnehin — derive-on-read)
4. **Scraper-Backup-Source** — tabletop.to als zweite Datenquelle, damit `FactionStats` nicht an DOM-Änderungen einer Quelle stirbt
5. **Sentinel-Tests** für Scraper-Selektoren (wöchentlich gegen Live-DOM)

### 8.2 M10 — UGC & Battle-Reports _(3–4 Wochen, transformativ)_

**Ziel:** Plattform wird Content-Hub.

1. **Battle-Report-Editor** — Markdown + Photo-Upload, Match-Timeline, Card-Embeds für referenzierte Listen/Fraktionen. Verknüpft mit `Match.id` (optional)
2. **Comment-System** — Match-Detail, Tournament, Battle-Report. Markdown, Soft-Delete, Moderation-Flag
3. **Discord-Bot zur Match-Reporting-Integration** — Spieler reportet im Discord-Channel, Bot triggert Backend. Bot-Infra steht bereits (Token live, Interactions-Endpoint + Ed25519, `discord-interactions.ts`) → nur neue Slash-Commands/Handler nötig

**Risiko:** UGC braucht Moderation. Plan ab ~50 aktive Schreiber: Flag-Queue + Auto-Throttle für neue Accounts.

**Henne-Ei-Caveat:** M10 braucht kritische Masse. M7–M9 zuerst (haben auch mit wenigen Nutzern Wert).

### 8.3 M11 — Team-Play _(4+ Wochen, große Wette)_

**Ziel:** 3v3 / SfT aktivieren.

1. **Team-Management UI** — `Team`/`TeamMember`-Models existieren als "Phase 3 reserved" (`schema.prisma:286`). UI: Team gründen, Mitglieder einladen, Team-Profil
2. **`TournamentMode.THREE_V_THREE`** — Schema vorhanden, Backend-Logik fehlt (Enum-Wert wird in M7 §5.1 #6 mit aufgeräumt — Re-Einführung dann sauber)
3. **SfT (Swiss-for-Teams)** — Pairing-Algorithmus für Teams

**Vorab:** Spec-Klärung mit Insidern bevor Schema final.

### 8.4 M12 — Listen, SLT & 3×3-Matrix _(on hold)_

**Kontext (Alex, Prio-Session 2026-06-04):** Die Army-List-Annahme der ursprünglichen Planung ist widerlegt — 1-List-Tournaments sind in der Szene extrem selten, ohne organische Uploads hat ein Listen-Browser keine Inhalte. Die 3×3-Matrix (beide Spieler melden 3 Fraktionen, Matrix-Verfahren entscheidet die Matchups) ist populär, aber zu komplex für v1 — „maybe with or before the lists".

1. **Army-List-Browser** (ex-M7-Kern) — Filter (Faction/Lord/Battle-Type), Search, "neueste"/"meistgesehene"
2. **Library-Section-Reaktivierung** als Einstieg (§2.5 F)
3. **SLT-Vertiefung** (Listen-Upload bei Anmeldung, Reveal-Regeln)
4. ~~**3×3-Matrix-Format** im Match-Panel~~ ✅ **done (2026-06-11)** — `MATRIX`-Mode aus M12 vorgezogen & gebaut (s. §1); Rest des Listen-Blocks bleibt on hold

> **Re-Eval-Trigger:** Wenn v1 produktiv live geht, Alex erneut fragen, wie dieser Block priorisiert wird — nicht vorher anfassen.

---

## 9. Out-of-Scope (geparkt oder verworfen)

| Idee                              | Begründung                                                                |
| --------------------------------- | ------------------------------------------------------------------------- |
| **In-App-Listenbauer**            | Externe Tools (Old World Builder, Almanack) decken's. **Skip.**           |
| **Live-Stream-Twitch-Embed**      | Old-World-Stream-Szene zu klein. **Wait** (Re-Eval nach M11)              |
| **Coaching-/Mentorship-Matching** | Nische zu klein, Moderations-Aufwand zu hoch. **Skip**                    |
| **Achievements/Badges**           | Gamification kann billig wirken. **Wait** bis M10 + UGC-Engagement messbar |
| **Federation/Multi-Tenant**       | Single-Tenant bleibt. **Permanent skip**                                  |
| **Mobile-Native-App**             | PWA-Pfad ist pragmatischer. PWA-Manifest in M6+ ergänzen, nicht Native    |
| **Draft-Preset-Builder für fremde Hosts** | Der Admin-Draft-Bereich (Presets in aoe2cm-Komplexität) bleibt Alex' Werkzeug; Öffnung für andere Organisatoren ist Zukunftsmusik (Alex, 2026-06-04). **Wait** |

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
