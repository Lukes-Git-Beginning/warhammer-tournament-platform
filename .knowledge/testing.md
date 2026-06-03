> Read-when: Tests schreiben (Unit, Integration, E2E), Fixture-Helper finden, Vitest/Playwright-Config.

**TL;DR**

- Backend-Unit-Tests laufen mit Vitest (`pool: 'forks'`, `singleFork: true`) in `apps/backend/test/` — 25 Test-Files, kein Parallel-State-Conflict.
- E2E-Tests laufen mit Playwright (Chromium-only, `baseURL: http://localhost:5173`) in `apps/e2e/tests/` — 9 Spec-Files.
- Hermetic-Cleanup via `db-fixtures.ts` (Backend) bzw. `tournament-fixture.ts` (E2E): randomUUID-basierte Entities, gezieltes Delete — nie globales `deleteMany`. Siehe auch `.knowledge/database.md`.

---

## Backend-Unit-Tests

- Pfad: `apps/backend/test/*.test.ts`
- Config: `apps/backend/vitest.config.ts`
- Wichtige Optionen:

```typescript
{
  environment: 'node',
  include: ['test/**/*.test.ts'],
  testTimeout: 20_000,
  hookTimeout: 20_000,
  pool: 'forks',
  poolOptions: { forks: { singleFork: true } },
}
```

`singleFork: true` verhindert parallele DB-State-Konflikte — alle Tests laufen sequenziell in einem Worker-Prozess. Aktuell 25 Test-Files:

| Bereich           | Files                                                                                                                                                                                |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Bracket/Format    | `bracket.test.ts`, `swiss.test.ts`, `round-robin.test.ts`                                                                                                                            |
| Draft             | `draft-state.test.ts`, `draft-service.test.ts`, `draft-socket.test.ts`, `draft-reconnect.test.ts`, `drafts-routes.test.ts`, `tournament-with-draft.test.ts`, `draft-presets.test.ts` |
| Match             | `match-start.test.ts`, `finalize-tournament.test.ts`                                                                                                                                 |
| Stats/Leaderboard | `elo.test.ts`, `leaderboard.test.ts`, `matchup-stats.test.ts`, `faction-snapshot.test.ts`, `factions.test.ts`, `heatmap.test.ts`                                                     |
| Infra             | `cache.test.ts`, `role-cache.test.ts`, `auth.test.ts`, `graphql.test.ts`                                                                                                             |
| Admin/Army        | `admin-routes.test.ts`, `army-parser.test.ts`, `army-lists.test.ts`                                                                                                                  |

---

## buildApp() für Tests

Isolierte Fastify-Instanz ohne echte Infrastruktur:

```typescript
import { buildApp } from '../src/app.js';

const app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
await app.ready();
// ...
await app.close();
```

`withSocket: false` verhindert Socket.IO-Initialisierung, `withRedis: false` überspringt Redis-Connect, `withCron: false` startet keine Cron-Jobs. Ideal für reine Route-/Service-Tests.

---

## db-fixtures.ts API

Pfad: `apps/backend/test/helpers/db-fixtures.ts`

Alle Factories generieren IDs via `randomUUID()` — keine Kollisionen bei parallelen Test-Runs.

```typescript
// Factories
createTestUser(overrides?: { username?: string }): Promise<TestUser>
// Felder: id, discord_id, username — discord_id = `test-disc-${uuid}`

createTestSeason(overrides?: { is_active?: boolean }): Promise<TestSeason>
// Felder: id, name — name = `test-season-${uuid}`

createTestTournament(opts: { organizerId: string; slug?: string }): Promise<TestTournament>
// Felder: id, slug — format: 'SWISS', status: 'ONGOING'

// Cleanup (cascade-geordnet, scoped auf generierte IDs)
cleanupUsers(userIds: string[]): Promise<void>
cleanupSeason(seasonId: string): Promise<void>
cleanupTournament(tournamentId: string): Promise<void>
```

`cleanupTournament` löscht in Reihenfolge: `AuditLog` → `Match` → `TournamentParticipant` → `TournamentResult` → `Tournament`.
`cleanupSeason` löscht: `FactionStatsSnapshot` → `MatchupStats` → `FactionStats` → `LeaderboardEntry` → `TournamentResult` → `Season`.

---

## Frontend-Unit-Tests

- Pfad: `apps/frontend/src/**/*.test.tsx` (oder `apps/frontend/test/`)
- Config: `apps/frontend/vitest.config.ts`
- Wichtige Optionen:

```typescript
{
  environment: 'happy-dom',  // nicht jsdom — leichter, schneller
  globals: true,
  alias: { '@/': './src/' },
}
```

Command: `pnpm -F @rizzotto/frontend test`

---

## E2E (Playwright)

- Pfad: `apps/e2e/tests/*.spec.ts`
- Config: `apps/e2e/playwright.config.ts`
- Browser: Chromium only (`devices['Desktop Chrome']`)
- `baseURL`: `http://localhost:5173`
- `timeout`: 30 000 ms pro Test, `expect.timeout`: 5 000 ms

**webServer-Strategie:**

| Umgebung | Backend                                             | Frontend                                   |
| -------- | --------------------------------------------------- | ------------------------------------------ |
| Lokal    | `pnpm --filter @rizzotto/backend dev`               | `pnpm --filter @rizzotto/frontend dev`     |
| CI       | `pnpm --filter @rizzotto/backend start` (pre-built) | `pnpm --filter @rizzotto/frontend preview` |

`NODE_ENV=test` wird automatisch an den Backend-Prozess übergeben — aktiviert den Test-Login-Bypass.

**Spec-Files:**

| File                              | Zweck                                                                         |
| --------------------------------- | ----------------------------------------------------------------------------- |
| `tournament-happy-path.spec.ts`   | 16-Player Single-Elim, vollständiger Turnier-Lifecycle                        |
| `live-draft.spec.ts`              | 2 Browser-Tabs, echte WebSocket-Draft-Session (~38 s)                         |
| `swiss-rematch-avoidance.spec.ts` | 8 Spieler / 3 Runden Swiss, kein Rematch-Pairing                              |
| `leaderboard-correctness.spec.ts` | 3 Turniere, dynamic-FinalPoints-Ranking + Sortier-Korrektheit (faction-aware) |
| `reconnect-recovery.spec.ts`      | Socket-Disconnect + Redis-Rehydrate                                           |
| `smoke.spec.ts`                   | Basis-Smoke (Navigation, Health)                                              |
| `draft.spec.ts`                   | Draft-Smoke (kleinerer Umfang als `live-draft`)                               |
| `meta.spec.ts`                    | Meta-Seiten-Smoke (Faction-Stats, Heatmap)                                    |
| `production-smoke.spec.ts`        | Separat — läuft gegen `PLAYWRIGHT_BASE_URL`, kein Auth                        |

---

## E2E-Fixture-Helper

Pfad: `apps/e2e/tests/helpers/tournament-fixture.ts`

```typescript
// User-Management
createTestUsers(count: number, opts?: { role?: TestRole; usernamePrefix?: string }): Promise<TestUser[]>
// TestRole: 'USER' | 'PLAYER' | 'ORGANIZER' | 'MODERATOR' | 'ADMIN'
// 'PLAYER' ist Alias für 'USER' (kein PLAYER im DB-Schema)

// Auth
signInRequest(request: APIRequestContext, userId: string, backendURL?): Promise<void>
// POST /auth/test-login auf APIRequestContext — setzt Auth-Cookie automatisch

signInBrowser(ctx: BrowserContext, userId: string, backendURL?): Promise<void>
// Gleich, aber auf BrowserContext (Cookie auf Browser-Context gesetzt)

// Season
ensureActiveSeason(): Promise<string>
// Idempotent — aktiviert erste Season falls keine aktiv. Pflicht in beforeAll.

// Tournament-Lifecycle
createTournament(request, opts: { name, format, draft_enabled?, draft_preset_id?, rounds? }, backendURL?): Promise<{ id, slug }>
// POST /api/tournaments → DRAFT → OPEN_REGISTRATION (2 API-Calls)

registerUsers(slug: string, users: TestUser[], backendURL?): Promise<void>
// Jeder User meldet sich sequenziell an (eigener temporärer Request-Context)

generateBracket(request, slug: string, backendURL?): Promise<void>
// PATCH → REGISTRATION_CLOSED, dann POST /api/tournaments/:id/start

startMatch(request, matchId: string, backendURL?): Promise<{ draftId?: string }>
// PATCH /api/matches/:id/start — gibt draftId zurück wenn Draft-aktiviert

reportMatchResult(request, matchId, opts: { winner_id, p1_score?, p2_score?, p1_faction_id?, p2_faction_id? }, backendURL?): Promise<void>
// POST /api/matches/:id/result

// Cleanup
cleanupTestData(userIds: string[]): Promise<void>
// Löscht cascade-geordnet alle Daten der Test-User inkl. deren Tournaments
```

---

## E2E-Gotchas — Dynamic Leaderboard + Rate-Limit

Drei nicht-offensichtliche Stolpersteine, die beim Dynamic-Weighted-Leaderboard-Merge (2026-06-02) das **Pre-Deploy-E2E-Gate** brachen (die 436 Unit-Tests fingen sie NICHT — E2E ist nicht in der Unit-Suite):

1. **Leaderboard zählt nur Faction-Matches.** Das derive-on-read-Leaderboard (`mode=rating_model`, Default) aggregiert via `confirmedMatchWhere` (`apps/backend/src/lib/rating-model-service.ts`): ein Match zählt nur mit `status=COMPLETED`, `winner_id`, **beiden** `player{1,2}_faction_id != null`, gesetztem `season_id` **und** `tournament.counts_for_leaderboard=true` (Default true; `season_id` + Fraktionen werden beim Result-Report gestempelt). E2E, das Leaderboard-Einträge erwartet, MUSS `reportMatchResult(..., { p1_faction_id, p2_faction_id })` mit zwei geseedeten Faction-IDs (`prisma.faction.findMany({ take: 2 })`) aufrufen — sonst kommt das Leaderboard leer zurück.
2. **Modell-agnostisch asserten, nicht ELO-Intuition.** Das gewichtete Modell kann „weniger, aber härtere" Siege (starker Gegner, niedriger Anti-Farm-Share) über „mehr, aber repetitive" Siege ranken. NICHT „mehr Siege = höherer Rang" asserten. Stattdessen: deterministische Win-Counts, positive `totalFinalPoints`, korrekte Sortierung (`totalFinalPoints` desc) + dichte Ränge (1..n). Response-Shape: `{ rank, playerId, displayName, avatarUrl, totalFinalPoints, totalRawPoints, totalMatches, wins, losses }` — **kein** `user`/`elo_rating`/`total_points` mehr.
3. **Rate-Limit ist in Tests angehoben.** Globales `@fastify/rate-limit` ist `max: 300 / 1 min` pro IP (`apps/backend/src/app.ts`). In CI kommen alle Specs von **einer** IP; dauer-pollende Tests (`live-draft` via `pollUntil`, 400 ms-Intervall) reißen das Limit → `429`. Unter `NODE_ENV=test` ist `max` auf `100_000` angehoben — Prod/Dev bleiben bei 300. Neue heavy-polling-Tests brauchen daher kein eigenes Throttling.

**Meta-Lehre:** Bei Feature-Contract-Wechseln (Response-Shape, „was zählt"-Regeln) **immer E2E lokal/auf Branch fahren, bevor nach `main` gemergt wird** — Unit-Grün allein ist kein ausreichendes Merge-Signal.

---

## E2E lokal fahren — Gotchas (Phase-1-Session 2026-06-02)

- **Redis vor lokalem E2E flushen.** Der Redis-Container-Volume persistiert über Sessions; ein **veralteter Cache** (z.B. leerer `factions:list` aus einem alten Lauf) lässt Specs spurious failen — `meta.spec.ts` „GET /api/factions" bekam `data.length === 0`, der Decision-Flow keine Maps. Fix: `docker exec tww3-redis redis-cli FLUSHALL` vor `pnpm test:e2e`. (Lokale DB-Credentials: User/DB/PW = `tww3`, nicht `postgres`.)
- **Prisma `notIn` schließt NULL-Rows aus (SQL-3-Wert-Logik).** Swiss-**Runde-1**-Matches (bei `/start` generiert) haben `phase = NULL`; erst `next-round` taggt `phase='SWISS'` (`bracket.ts:603`). Ein Filter `where: { phase: { notIn: ['PLAYOFF_*'] } }` überspringt damit NULL-Phase-Matches → Runde gilt fälschlich als „nicht gespielt". Playoff-Phasen **in JS** ausfiltern, nicht via Prisma `notIn`.
- **`decision/start` liefert `201 Created`** (nicht 200) — `routes/match-decision.ts:172`.

## M6-Integrationstests + E2E-Guard

### Neue Backend-Test-Files (M6)

Drei neue Test-Files ergänzen die Backend-Suite (jetzt 28 Files):

| File                          | Tests | Schwerpunkte                                                                                               |
| ----------------------------- | ----- | ---------------------------------------------------------------------------------------------------------- |
| `h2h.test.ts`                 | 7     | H2H-Summary, Symmetrie, **Draw-Regression**, 404, 400-non-UUID, `faction_breakdown`                       |
| `tournament-calendar.test.ts` | 13    | `is_major`/`status`-Filter, **`is_major=false`-Regressionsguard**, `end_date`-Heuristik (calendar-JSON), VCALENDAR/VEVENT-Struktur, Content-Type `text/calendar`, PATCH `is_major` |
| `import-log.test.ts`          | 5     | 401, 403, 200 + `source`-Filter                                                                            |

### Neuer E2E-Spec: `m6-routes.spec.ts`

Pfad: `apps/e2e/tests/m6-routes.spec.ts` — **Routen-Resolution-Guard** für `/tournaments/calendar` und `/users/$a/vs/$b`.

Pattern: `page.waitForResponse(...)` prüft ob die seiteneigene API-Call feuert — copy-unabhängig, robust gegen UI-Text-Änderungen. Beweist, dass eine Route zur richtigen Page auflöst und nicht von einem vorrangigen `$slug`/`$id`-Segment verschluckt wird.

### Neuer E2E-Spec: `double-elimination.spec.ts`

Pfad: `apps/e2e/tests/double-elimination.spec.ts` — 8-Player-DE-Lifecycle über den echten Server-Stack + Browser-Render-Check.

Wiederverwendbares Pattern **„drive-to-completion"**: ein generischer Loop (Iterations-Cap gegen Endlosschleifen) lädt das Bracket neu, meldet für jedes Match mit beiden gesetzten Slots ein Ergebnis (player1 gewinnt), bis kein spielbares Match mehr übrig ist — funktioniert für beliebige Bracket-Formate/Feldgrößen. `createTournament`-Fixture akzeptiert jetzt `DOUBLE_ELIMINATION`. Backend-seitig deckt `double-elimination.test.ts` dasselbe via DB-Integration für 4/5/6/7 Spieler + Order-Independence ab.

### Gotcha — parallele Sub-Agenten + `typecheck`

Wenn mehrere Sub-Agenten **parallel** Frontend-Dateien editieren und jeder eigenständig `typecheck` läuft, melden sie transiente, widersprüchliche Fehler (Mid-Edit-Snapshots der anderen Agenten). → Nach jeder Agentwelle **einmal** selbst `pnpm -F <ws> typecheck` als Ground Truth fahren; Agenten-Selbstreports sind in diesem Szenario unzuverlässig.

Zusätzlich: Die `typecheck`-tsconfig schließt `test/**` aus. Nach Schema-/Contract-Änderungen zwingend DB-abhängige Tests (`pnpm -F @rizzotto/backend test`) separat fahren — `typecheck`-Grün allein deckt diese Pfade nicht ab.

---

## Visual-Snapshots — Bootstrap + CI-Validierung

Die 9 Visual-Specs (`visual/landing-overhaul.spec.ts`, landing/login/leaderboard × 3 Viewports) sind seit 2026-06-02 **aktiv in CI** (Linux-Baselines committed, `UPDATE_SNAPSHOTS`-Guard entfernt).

- **Datengetriebene Regionen container-maskieren.** `leaderboard-mobile` driftete ~41% durch randomisierte Cross-Spec-Usernames. Fix: `data-testid="leaderboard-data-table"` + `data-testid="roll-of-honour-list"` + `mask: [...]` + `maskColor` im `toHaveScreenshot`. **Container-Level** (nicht Zeilen-Level), weil die Zeilenzahl zwischen Läufen variiert.
- **Baselines neu erzeugen:** `gh workflow run update-snapshots.yml --ref <branch>` → `playwright --update-snapshots` auf ubuntu-latest → Artifact `e2e-snapshots` → `gh run download <id> -n e2e-snapshots` → die `*-chromium-linux.png` ins Snapshot-Verzeichnis committen.
- **Vor `main` per PR validieren.** CI läuft auf `push:[main]` **und** `pull_request`; **Deploy** nur bei CI-Success auf `main`. Lokal (win32) lassen sich Linux-Baselines NICHT prüfen. Also: Baseline-Änderungen auf einem Branch + **PR** pushen → PR-CI validiert die Visual-Specs gegen die Baselines, **ohne** das Prod-Deploy-Gate zu riskieren; erst nach grüner PR-CI mergen.

---

## Test-Bypass-Login

`POST /auth/test-login` ist nur aktiv wenn `NODE_ENV === 'test'`. Playwright übergibt `NODE_ENV=test` via `playwright.config.ts` an den Backend-webServer — kein manuelles Setup nötig.

E2E-Tests nutzen ausschließlich `signInRequest`/`signInBrowser` — kein UI-Login-Flow über Discord-OAuth.

Siehe `.knowledge/auth.md` für Implementierungsdetails des Bypass-Endpoints.

---

## Commands

```bash
pnpm test                                          # alle Unit-Tests (Backend + Frontend) via Turbo
pnpm -F @rizzotto/backend test                         # nur Backend-Unit-Tests
pnpm -F @rizzotto/backend test -- --reporter=verbose   # mit ausführlicher Ausgabe
pnpm -F @rizzotto/backend test -- bracket              # Pattern-Filter (z.B. bracket.test.ts)
pnpm -F @rizzotto/frontend test                        # Frontend-Unit-Tests

pnpm test:e2e                                      # alle E2E (ohne production-smoke)
pnpm -F @rizzotto/e2e test -- --grep "happy-path"      # bestimmten Test filtern
pnpm -F @rizzotto/e2e test -- --headed                 # Browser sichtbar (Debugging)
pnpm -F @rizzotto/e2e test -- --debug                  # Playwright Inspector
```

---

## Hermetic-Cleanup-Konvention

**Wichtig:** Kein globales `prisma.*.deleteMany()` ohne Where-Scope in Tests. Das würde Seed-User löschen und andere parallele Test-Runs zerstören.

Korrekte Konvention:

1. Entities mit `randomUUID()`-basierten IDs/Namen erstellen (Factories erledigen das automatisch)
2. IDs im `afterEach`/`afterAll` sammeln
3. Scoped Cleanup via `cleanupUsers(ids)` / `cleanupTournament(id)` / `cleanupTestData(userIds)`

Siehe `.knowledge/database.md` für die vollständige hermetic-Cleanup-Strategie und FK-Violation-Vermeidung.
