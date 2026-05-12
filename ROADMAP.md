# ROADMAP — TWW3 Tournament Platform

> **Stand:** 2026-05-12 · **Verdict:** GO · **Realistische Timeline:** 17–22 Wochen Vollzeit AI-first (50% Konfidenz)

---

## ⚙️ Session-Constraints (für Claude Code)

**Sub-Agent-Parallelität:**
- **Bis zu 4 Agents gleichzeitig** launchen ist OK — bewährter Sweet-Spot für diesen PC
- **6+ parallele Agents brechen das System** (Memory-Limit) — niemals mehr als 4 in einem Message-Block
- Bei Bedarf für mehr Exploration: lieber sequenzielle Wellen (4 → warten → nächste 4) statt mehr parallel

**Model-Routing (80/20 Sonnet/Opus):**
- Sonnet: Code-Volumen (CRUD, Komponenten, Tests, Migration-Files, Tailwind, Resolver)
- Opus: Architektur, Algorithmus-Design (Draft-State-Machine, Double-Elim-Logik), Debugging, Refactors
- Sub-Agents standardmäßig auf Sonnet (CLAUDE_CODE_SUBAGENT_MODEL=sonnet) — Opus-Agents nur bei explizitem Architektur-Bedarf

**Workflow:**
- Sub-Agent-First Planung — Hauptkontext schlank halten
- Bei Exploration: max. 4 Explore-Agents parallel mit klar abgegrenzten Such-Aufträgen
- Plan-Phase in Opus, Execute-Phase manuell auf Sonnet wechseln (`/model sonnet`)

---

## Context

Drei detaillierte Spec-Dokumente liegen unter `WARHAMMER_PLATFORM_PROMPT_TEIL_{1,2,3}.md` und beschreiben eine **Total War Warhammer 3 Tournament-Plattform** (kein Tabletop, kein Lore-Wiki, keine Federation — der Plan-File-Slug "federated-tome" ist Auto-Generated und fachlich irrelevant). Aktueller Stand: **null Zeilen Code**, reines Spec-Stadium.

Diese Roadmap beantwortet die Frage *"wie umsetzbar ist das Projekt?"* mit einem Go-Verdict, einer realistischen Timeline für AI-first Solo-Development, einer Risiko-Mitigation für die versteckten Komplexitäten der Specs und einer empfohlenen Phasenfolge.

**User-Kontext bestätigt:**
- Vollzeit, AI-first (Claude Code als Pair-Programmer, keine menschlichen Co-Devs)
- Nachgewiesene Velocity (vergleichbares KMU-Hub-Projekt in <8 Monaten)
- Full Scope angestrebt (alle 3 Doc-Phasen)
- Alle externen Blocker schon geklärt: Faction-Icons-Lizenz vorhanden, totaltavern.com-Scraping erlaubt, Discord-Community existiert (kein Cold-Start-Problem)

---

## Verdict: GO — mit klaren Caveats

**Technisch machbar:** Ja, ohne Showstopper. Stack-Wahl (Fastify/Prisma/Postgres/Redis/React) ist mainstream, alle externen Risiken sind vorgeklärt.

**Scope realistisch:** Ja, **wenn drei Disziplin-Punkte gehalten werden**:
1. Architektur-Entscheidungen vor dem ersten Commit (siehe unten)
2. Pairing-/Bracket-Algorithmen mit Library `tournament-pairings` lösen, nicht selbst bauen
3. 3v3/Blind-Pick/SFT-Modi als Enum reservieren, Implementation auf Post-Phase-2 verschieben

---

## Realistische Timeline (AI-first Solo)

Doc-Schätzung war 30-35 Wochen Solo-Klassisch. AI-first verschiebt das Gewicht:
- CRUD/Boilerplate (~40% der Zeit) → **2.5× schneller**
- Algorithmus-/UX-Logik (~40%) → **1.4× schneller**
- Testing/Debugging/Real-World-Edge-Cases (~20%) → kaum schneller

**50%-Konfidenz: 17–22 Wochen** (~4-5 Monate Vollzeit) für Full Scope
**80%-Konfidenz: 22–26 Wochen** (~5-6 Monate) wenn Draft-Engine-Edge-Cases, Double-Elim-Visualisierung und Army-Parser mehr Iteration brauchen als erwartet

---

## Top-3 Reale Risiken

1. **Draft-Engine-Korrektheit unter Hidden+Parallel+Snipe/Steal-Kombinationen.** Ein falscher State-Übergang lässt in Live-Drafts gebannte Factions als verfügbar erscheinen → Turnier-Credibility tot. Mitigation: State-Machine isoliert als Service mit umfangreichen Unit-Tests aufbauen, bevor WebSocket-Integration beginnt. **Timer-State ab Tag 1 in Redis persistieren**, nicht in Process-Memory.

2. **Swiss-Pairing bricht in Runde 4-5 echter Turniere.** Der Greedy-Algorithmus in den Docs läuft bei 20+ Spielern in unlösbare Zustände. Mitigation: **`tournament-pairings`-Library** (npm) verwenden — bringt Swiss + Double Elimination + Rematch-Avoidance fertig. Spart 5-8 Tage gegenüber Eigenbau.

3. **Scope-Drift bei 3v3/Blind-Pick/SFT.** Im Schema reserviert, nirgends spezifiziert. 3v3 ist ein anderes Datenmodell (Team statt User als Participant). Mitigation: Enums anlegen + 501-Handler zurückgeben + UI-Label "(Coming Soon)". Spec-Klärung mit Insidern vor Phase 3.

---

## Architektur-Entscheidungen die VOR dem ersten Commit feststehen müssen

Diese Punkte kosten 3–7 Tage Refactor wenn später geändert:

- **Single-Tenant bleibt** — keine Federation, keine Mandanten-Spalte in Tables
- **Socket.io mit `@socket.io/redis-adapter` ab Tag 1** — nicht nachrüsten. Setup-Aufwand: 2 Stunden vs. 1-2 Tage später + Risk
- **Draft-Timer-State in Redis Hash `draft:{id}:state`** — Backend hält keinen Memory-Timer als Source-of-Truth, nur ephemere `setTimeout`s die aus `timerExpiresAt` rehydrieren
- **Auth: JWT in HTTP-Only-Cookie**, keine Server-Sessions in Redis (kein Logout-Revoke-Bedarf bei Gaming-Community). WebSocket-Auth via Cookie im Handshake (Middleware), nicht nach Connect
- **Stats: Inkrementelle Counter (`FactionStats`-Tabelle) + Materialized View für Leaderboard**, keine Live-Aggregation aus Match-Rohdaten
- **Pairing: `tournament-pairings`-Library** (npm) für Swiss, Round-Robin, Double Elimination — Algorithmus-Korrektheit nicht selbst verantworten

---

## Empfohlene Phasenfolge — 5 Meilensteine

Die Docs legen Stats komplett in Phase 3 — das ist falsch für Community-Retention. Faction-Stats und Leaderboard sind die täglich-konsumierten Inhalte. Vorgezogene Phasenfolge:

### M1 — Foundation & Live-Core (Woche 1-4)
Monorepo (Turborepo), **vollständiges Prisma-Schema für Phase 1+2** (kein Nachmigrieren), Discord-OAuth2, Tournament-CRUD, Single-Elimination via `tournament-pairings` + `react-brackets`, WebSocket mit Redis-Adapter, Docker-Compose, Railway-Deploy.

**Deliverable:** Single-Elimination-Turnier live durchführbar.

### M2 — Swiss + Leaderboard-Basics (Woche 5-7)
Swiss, Round-Robin, Double-Round-Robin via Library. Season-Modell, Basis-Leaderboard (nur Platzierungspunkte, ELO später), Spieler-Profil. Redis-Caching für Liste/Leaderboard.

**Deliverable:** Alle 5 Formate spielbar.

### M3 — Faction-Stats & Meta (Woche 8-10) — VORGEZOGEN
GraphQL via mercurius, FactionStats-Counter, Faction-Overview-Page, **24×24 Matchup-Heatmap** (Tabellen-basiert, kein Chart-Lib), Meta-Dashboard, ELO ergänzt im Leaderboard, All-Time-Decay.

**Deliverable:** Tägliche-Use-Case-Retention sichergestellt.

### M4 — Draft-System (Woche 11-17) — längster Milestone
Draft-Schema, Redis-Timer-State, Draft-Engine als isoliert getesteter Service, dann WebSocket-Integration, Draft-Lobby-UI, Preset-Editor, Event-Log. **Human-in-the-Loop für Edge-Case-Testing zwingend.**

**Deliverable:** Captain's Mode end-to-end mit Reconnect-Recovery.

### M5 — Polish, Scraper, Admin, E2E (Woche 18-22)
Army-List-Upload + naïver Parser (iterativ erweitern), totaltavern-Scraper, Admin-Panel, Playwright-E2E-Tests, UI-Polish, SEO.

**Deliverable:** Production-Launch-Ready.

---

## AI-Workflow (80/20 Sonnet/Opus)

**Sonnet (Code-Volumen):** CRUD-Handler, Prisma-Queries, React-Komponenten mit klarer Spec, Unit-Tests für deterministische Funktionen (ELO, Round-Robin), Tailwind-Styling, Docker/CI/CD-Files, GraphQL-Resolver, Migration-Files.

**Opus (Architektur, Algorithmus-Design, Debug):** Draft-Engine-State-Machine formal definieren bevor Code, Double-Elim-Logik validieren, Draft-Reconnect-Debugging, Leaderboard-Formel-Fairness-Analyse, Performance-Diagnose, Refactors.

**Sub-Agents parallel (max 4 gleichzeitig — siehe Session-Constraints oben):**
- Schema-Design + API-Contracts + Frontend-Stubs parallel (alle brauchen nur das Prisma-Schema)
- Scraper-Implementation parallel zu Draft-Engine-Frontend (unabhängige Codebases)
- Test-Suite-Erstellung parallel zu Feature-Logik

**NICHT delegieren (Human-in-the-Loop):** Draft-Engine-Edge-Cases manuell durchspielen, Swiss-Pairing für späte Runden mit echten 16+ Spielern simulieren, Draft-Lobby-UX-Review, Leaderboard-Formel über 2-3 simulierte Seasons kalibrieren.

---

## Top-3 Prework-Tasks vor dem ersten Code-Commit

1. **Vollständiges `schema.prisma` für Phase 1+2** drafften, von Opus reviewen lassen auf fehlende Relations/Indexes/N+1-Fallen. Erst danach `prisma migrate dev`.
2. **Insider-Interviews zu 3v3/SFT/Blind-Pick und Leaderboard-Formel** — diese Antworten haben Schema-Konsequenzen.
3. **Infrastruktur-Setup ohne Code:** Discord-Developer-App, Railway-Projekt mit PostgreSQL+Redis-Plugins, `.env.example` vollständig dokumentiert, Monorepo-Struktur (`apps/backend`, `apps/frontend`, `packages/types`) angelegt.

---

## Kritische Files (für die Implementierung)

- `apps/backend/prisma/schema.prisma` — Single Source of Truth, vor erstem Commit final
- `apps/backend/src/services/DraftEngine.ts` — zentralste Business-Logik, State-Machine
- `apps/backend/src/services/DraftTimerService.ts` — Redis-backed Timer mit Rehydration
- `apps/backend/src/plugins/socket.ts` — Socket.io + Redis-Adapter + Auth-Middleware + Room-Management
- `packages/types/src/socket-events.ts` — typisierte Event-Contracts Frontend↔Backend

---

## Risiko-Mitigation für die 6 versteckten Komplexitäten

| # | Komplexität | Strategie | Aufwand |
|---|---|---|---|
| 1 | Draft-Timer-Recovery | Redis-Hash `draft:{id}:state` ab Tag 1, ephemere `setTimeout` aus `timerExpiresAt` rehydrieren | +1.5 Tage gegen naïv |
| 2 | Double Elimination Bracket | `tournament-pairings` für Algorithmus, custom 2-teilige SVG-Visualisierung (Winners oben, Losers unten kollabierbar) | 3 Tage |
| 3 | Swiss-Pairing | `tournament-pairings`-Library mit `avoidRematches: true` | 0.5 Tage (vs. 5-10 Eigenbau) |
| 4 | WebSocket-Scaling | `@socket.io/redis-adapter` mit gleichem Redis | 2 Stunden |
| 5 | Army-List Parser | Phased: Best-Effort-Parser, bei Failure nur File-Download, Community liefert Test-Daten | 1 Tag Basis + 2-3 Tage iterativ |
| 6 | 3v3/Blind/SFT-Modi | Enum reservieren, 501-Handler, UI "(Coming Soon)", Spec klären vor Phase 3 | 2 Stunden Stub |

---

## Verifikation (E2E)

Kritische User-Journeys als Playwright-Tests bevor Production:

1. **Tournament Lifecycle Happy Path** (16-Spieler Single-Elim von Erstellung bis Leaderboard-Update) — Smoke-Test, blockiert Deploy bei Failure
2. **Live-Draft end-to-end** (zwei Browser-Tabs, echte WebSocket-Verbindungen, kein Mocking)
3. **Swiss Rematch-Avoidance** (8 Spieler, 4 Runden, programmatisch prüfen dass keine Paarung wiederholt)
4. **Leaderboard-Punkte-Korrektheit** (drei Turniere unterschiedlicher Grösse mit bekannten Placements gegen Formel)
5. **Reconnect-Recovery bei laufendem Draft** (Backend-Restart simulieren, Client rehydriert State aus Redis korrekt)

Vor jedem Major-Turnier zusätzlich manuell: Vollständiger Draft im Staging mit echten Spielern, Swiss-Bye-Logik bei ungerader Spielerzahl, Timezone-Anzeige für nicht-europäische User, Mobile-Browser-Bracket-View.

---

## Empfehlung

**Starten.** Das Projekt ist in 4-6 Monaten Vollzeit AI-first realistisch lieferbar, deutlich unter der Doc-Schätzung. Die zwei Disziplin-Knoten sind: (a) Architektur-Entscheidungen oben *vor* dem ersten Commit treffen, (b) Library-Wahl `tournament-pairings` ernst nehmen statt Pairing selbst zu bauen. Wenn beides hält, ist der Rest Routine-Engineering mit punktueller Algorithmus-Komplexität nur im Draft-System.

---

## Quellen-Specs

- `WARHAMMER_PLATFORM_PROMPT_TEIL_1.md` — Projekt-Übersicht, Tech-Stack, Auth, Tournament-Management, Bracket-View
- `WARHAMMER_PLATFORM_PROMPT_TEIL_2.md` — Draft-System (Captain's Mode), Army-Lists-Parser, Leaderboard, Season-Management
- `WARHAMMER_PLATFORM_PROMPT_TEIL_3.md` — Faction-Statistiken, UI/UX-Design, Scraper, Deployment, Testing, Zeitplanung
