# ROADMAP — Rizzotto

> **Stand:** 2026-06-04 · **Phase:** Live (Beta) — auf dem Weg zu Launch v1 · **Domain:** rizzotto.gg (Prod-Betrieb: Luke)
>
> Diese Roadmap ist die **SSOT** für _was läuft_, _was als nächstes drankommt_ und _was bewusst nicht gebaut wird_. Sub-Pläne (Detail-Plans für einzelne Tracks) liegen unter `~/.claude/plans/`, nicht im Repo. Historie und Welle-Specs siehe `docs/archive/`.

---

## TL;DR

- **rizzotto.gg ist live seit 2026-05-19** auf Hetzner CX22, Caddy + Cloudflare-Origin-Cert. **Rollenmodell seit 2026-06-04:** Alex = Product Owner + lokale Entwicklung, Luke = Prod-Betrieb (Server, Cloudflare, Deploys); Handover künftig per Feature-Branch-PR.
- **M1–M6 + Welle 2 + DOUBLE_ELIMINATION + Dynamic Weighted Leaderboard sind durch.**
- **Zuletzt live (2026-06-04):** Die 13 Commits der Nacht-Session (Registration-UI, Lifecycle-Buttons, SE-Generator-Fix, Bracket-Polish, Faction-Select, Cast-Iron-Logo) sind deployed — nach CI-Fix (Visual-Baselines, §2.7). Live-Smoke grün; 1 staler Cloudflare-Cache-Eintrag (`rizzotto-wordmark.avif`) wartet auf Luke-Purge.
- **Aktueller Fokus: M7 — Launch v1 „Match Hub" (§5, Alex-Spec 2026-06-04):** Match-Klärung (BPT-Pick, Map-Ban&Pick, 4 Map-Modi) lebt im Match-Panel statt in Discord-DMs — der intrinsische Mehrwert ggü. Totaltavern. Dazu: Decision-Flow-Reparatur (§2.7-Audit), SFT-Hidden-Fix, Withdraw, Bracket-Reset, Englisch-only. Danach gestufter Community-Launch (geschlossener Kreis → öffentlich).
- **Reprioritisiert (Prio-Session 2026-06-04):** **Open Play/Ladder → M8 (§7, neu — Alex-Wunsch, regelmäßig auf Prio ansprechen)**, Datentiefe → M9 (§8.1), UGC → M10 (§8.2), Team-Play → M11 (§8.3), **Army-Lists/SLT/3×3 → M12 on hold (§8.4, Re-Eval bei v1-Launch)**.
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

---

## 2. Nächste Session — sofortiges Backlog

### 2.1 ~~Tournament-Lifecycle-UI~~ ✅ done

Bundled in `f4e3705` und deployed 2026-05-20: Delete-Button, Status-Transition (Publish), Edit-Page — alle drei live in `TournamentDetail.tsx`.

### 2.2 Externe Integrationen freischalten

| #   | Item                                                                          | Wo                           | Notiz                                                                 |
| --- | ----------------------------------------------------------------------------- | ---------------------------- | --------------------------------------------------------------------- |
| 1   | ~~`STEAM_WEB_API_KEY` in `/etc/rizzotto/env/backend.env` setzen~~             | Server                       | ✅ done 2026-05-20                                                    |
| 2   | **`DISCORD_BOT_TOKEN`** in env setzen + Discord-Bot starten                   | Server + Discord-Application | Schaltet vorhandene Notify-Features frei (`discord-notify.ts`: Announce, Check-in, Pairings, Dispute); Bot-Commands später in M10 (§8.2). Teil der Luke-Checkliste §5.3 |
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
| 3   | **Scraper-Write-Path** wirft "not implemented"                                                               | `scraper/src/cli.ts:148,155`                                  | Mittel — Datenhebel ungenutzt        | M9 (§8.1)                          |
| 9   | **`GET /api/matches/:id/decision` + `POST …/decision/random` fehlen im Backend** — Frontend (`api.ts`/`MatchDecisionPage`) ruft beide auf → Decision-UI de facto tot | `apps/backend/src/routes/match-decision.ts`                   | **Hoch — v1-Kernfeature**            | M7 (§5.1 #1)                       |
| 10  | **SFT-Fraktions-Leak:** `faction` ist entgegen FieldHint sofort öffentlich (kein Hidden-until-Start)          | `apps/backend/src/routes/participants.ts` (GET participants) | Mittel — Counterpick-Schutz fehlt    | M7 (§5.1 #5)                       |
| 11  | **PICK_BAN nur bei Pool = 3 funktional** (kein expliziter Pick-Step); **RANDOM ohne Re-Pick-Schutz**          | `apps/backend/src/routes/match-decision.ts`                   | Mittel                               | M7 (§5.1 #3)                       |
| 4   | `Tournament.poster_url` Upload-Flow fehlt                                                                    | `packages/db/prisma/schema.prisma:172`                        | Niedrig                              | M6 optional                        |
| 5   | `SigillumSection`-Community-Links Platzhalter                                                                | `apps/frontend/src/components/landing/SigillumSection.tsx:93` | Niedrig                              | M6 — 🟡 deferred (echte URLs ausstehend) |
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

## 5. M7 — Launch v1 „Match Hub" _(aktueller Fokus — Alex-Spec, Prio-Session 2026-06-04)_

**Ziel:** Alles, was zum Match zu klären ist, lebt **im Match-Panel auf der Turnierseite** — keine Discord-DMs, kein externes Draft-Tool. Das ist der intrinsische Mehrwert gegenüber dem Status quo der Szene (Totaltavern: Bracket auf TT, Draft auf aoe2cm, Matrix + Map-Bans per Discord-DM). **BPT + SFT decken 80–90 % der real gespielten Turniere ab** — sie sind der v1-Scope; das mit Abstand häufigste Format ist **Swiss SFT, 4–5 Runden + Top-4-Playoffs**.

**Arbeitsmodell:** Alex entwickelt lokal auf `feat/launch-v1`; Handover = PR → Luke reviewt/merged → Auto-Deploy. Direkte `main`-Pushes nur noch für Docs.

### 5.1 Kern — Match-Klärung im Match-Panel

1. **Decision-Flow reparieren** (Audit §2.7): `GET /api/matches/:id/decision` implementieren (Frontend ruft sie bereits — 404), `POST /api/matches/:id/decision/random` implementieren, Socket-Room-Join für `match_decision_*` verifizieren/bauen
2. **Match-Panel** auf der Turnierseite, außerhalb des Bracket-Embeds (Alex-UI-Spec): das eigene aktuelle Match mit Spielern, Avataren, Fraktionen, Map und Phase-Status — alle Klärungs-Aktionen inline, Bracket verlinkt hinein. Inkl. **Lobby-Code-Feld** (Host trägt den Ingame-Code ein, Gegner sieht ihn — damit entfällt der letzte DM-Anlass)
3. **Vier Map-Modi** (ersetzen heutiges RANDOM/PICK_BAN):
   - a) **Random pro Runde** — ohne Map-Wiederholung im selben Turnier (Re-Pick-Schutz neu)
   - b) **Host-Preset, 1 Map pro Runde** — keine Spielerwahl (Schema: Runden-Map-Zuordnung neu)
   - c) **Host-Preset, 3 Maps pro Runde** — Coin-Flip bestimmt Banner (1 Ban), der Gegner **pickt explizit** aus den verbleibenden 2
   - d) **Random 3 aus dem Pool** — gleicher Ban→Pick-Ablauf wie c)
4. **BPT im Panel:** verdeckter Fraktions-Pick per Dropdown, beidseitiger Lock, simultaner Reveal. **Sequenz:** nach Map-Bekanntgabe bei Modi a/b, **vor** der Map-Phase bei Modi c/d
5. **SFT fixen:** Fraktion wird bei Anmeldung gewählt, bleibt aber **hidden bis Turnierstart** (Anti-Counterpick) — Public-Serialisierung in `participants.ts` maskieren; löst den heute faktisch falschen FieldHint („revealed at tournament start") ein. Map-Phase immer nach Fraktions-Reveal
6. **Mode-Cleanup:** `OPEN` **entfernen** (Begründung Alex: offenes Picking ohne Lock = endlose Counterpick-Spirale, mit Lock = First-Lock-Nachteil → BPT ist das einzig sinnvolle offene Picking, vgl. Ingame-Ladder). **SFT wird Default.** Migration bestehender OPEN-Turniere + Alt-Enum-Werte (`ONE_V_ONE`/`THREE_V_THREE`/`BLIND_PICK`) aufräumen

### 5.2 Begleiter — Organisator- & UX-Basics

7. **Withdraw-UI** — Backend existiert (`POST /:slug/withdraw`), nur Frontend-Button + Bestätigung
8. **Bracket-Reset** („falsch ausgelost"): Unique `(tournament_id, round, match_number)` vs. Soft-Delete → partieller Index oder Hard-Cleanup im `/start`
9. **Englisch-only** (Stufe-1-Blocker): LanguageToggle raus, Default `en`, hardcoded DE-Strings → EN; i18n-Infra bleibt im Code. Dabei Texte fixen: Create-Aside (behauptet „mode sets the match size — 1v1 or team encounters" — falsch, Mode = Picking-Format) + „What is a tournament?"-Header neu
10. **UI-Kleinkram:** Turnier-Kacheln überall voll klickbar (`TournamentsListing` + `ActiveMustersSection` haben noch „View Tournament"-Buttons), **Datum + Uhrzeit** auf Kacheln (`showTime: true`), **BO1** für `playoff_match_format`/`finale_match_format` zulassen (Enum kann es, Zod/UI sperren), Map-Pool **„Select All"** (36 Checkboxen einzeln ist unzumutbar)

### 5.3 Generalprobe & gestufter Launch

11. **Lokale Generalprobe:** Swiss SFT, 4–5 Runden + Top-4-Playoffs mit `db:seed:dummies` — kompletter Organisator-Durchlauf (Alex' manuelle Probeturniere sind die wirksamste QA der Plattform; der Swiss-Pfad hatte noch keinen Praxistest)
12. **Handover-PR** an Luke → Review/Merge → Auto-Deploy
13. **Luke-Checkliste (extern):** Cloudflare Custom Purge `https://rizzotto.gg/img/rizzotto-wordmark.avif` · Hetzner-VM-Backup aktivieren (~1.68 €/mo) · `DISCORD_BOT_TOKEN` setzen · echte Community-Links (`SigillumSection`) · Caddyfile-Live-Sync (§2.3 #1)
14. **Stufe 1 — geschlossener Kreis:** Prod-Generalprobe (Alex als ORGANIZER auf rizzotto.gg), dann erstes echtes Turnier (Swiss SFT) mit Discord-Kreis
15. **Stufe 2 — öffentlich** (Reddit/Foren): erst nach 1–2 sauberen Stufe-1-Turnieren

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

## 7. M8 — Open Play / Ladder _(direkt nach v1 — Alex-Wunsch 2026-06-04)_

**Ziel:** Leaderboard-relevante Matches **ohne Turnier-Commitment** — „viele Spieler scheuen sich vor dem Commitment von Turnieren" (Alex). Matchmaking auf der Site senkt die Einstiegshürde und füttert Leaderboard + Meta, bevor Spieler sich an Turniere trauen.

> **Prio-Vermerk:** Alex in regelmäßigen Abständen auf dieses Thema ansprechen — es ist ihm wichtig und könnte weiter vorrücken.

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
3. **Discord-Bot zur Match-Reporting-Integration** — Spieler reportet im Discord-Channel, Bot triggert Backend. Braucht `DISCORD_BOT_TOKEN` (§5.3 Luke-Checkliste)

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
4. **3×3-Matrix-Format** im Match-Panel

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
