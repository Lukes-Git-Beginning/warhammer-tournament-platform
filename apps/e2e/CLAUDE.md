# TWW3 E2E (Playwright)

Chromium-only E2E-Tests gegen `baseURL: http://localhost:5173` (`apps/e2e/tests/*.spec.ts`). Login läuft via `POST /auth/test-login` (Test-Bypass, kein Discord-OAuth) — aktiv wenn `NODE_ENV=test`, das `playwright.config.ts` setzt automatisch.

---

## Commands

```bash
pnpm test:e2e                                      # alle E2E (ohne production-smoke)
pnpm -F @tww3/e2e test -- --grep "draft"           # einzelnen Test filtern
pnpm -F @tww3/e2e test -- --headed                 # Browser sichtbar (lokales Debugging)
pnpm -F @tww3/e2e test -- --debug                  # Playwright Inspector
```

---

## Test-Files

| File | Zweck |
|---|---|
| `tournament-happy-path.spec.ts` | 16-Player Single-Elim, vollständiger Turnier-Lifecycle |
| `live-draft.spec.ts` | 2 Browser-Tabs, echte WebSocket-Draft-Session (~38 s) |
| `swiss-rematch-avoidance.spec.ts` | 8 Spieler / 3 Runden Swiss, kein Rematch-Pairing |
| `leaderboard-correctness.spec.ts` | 3 Turniere, ELO + Points-Verifizierung |
| `reconnect-recovery.spec.ts` | Socket-Disconnect + Redis-Rehydrate |
| `smoke.spec.ts` | Basis-Smoke (Navigation, Health) |
| `draft.spec.ts` | Draft-Smoke (kleinerer Umfang als `live-draft`) |
| `meta.spec.ts` | Meta-Seiten-Smoke (Faction-Stats, Heatmap) |
| `production-smoke.spec.ts` | Separat — siehe Abschnitt unten |

Details zu jedem Spec: `.knowledge/testing.md`

---

## Production-Smoke

`production-smoke.spec.ts` ist **nicht** im Default-Run enthalten. Er läuft gegen `PLAYWRIGHT_BASE_URL` (Prod-URL) ohne Auth und prüft öffentliche Endpunkte. Lokal nie ausführen — nur in separatem CI-Step nach Deployment.

---

## Fixture-Helper

`tests/helpers/tournament-fixture.ts` — alle Setup-Funktionen für User, Auth und Tournament-Lifecycle:

- `createTestUsers(n, opts?)` — N User via Prisma direkt erstellen
- `signInRequest(request, userId)` / `signInBrowser(ctx, userId)` — Auth-Cookie setzen
- `ensureActiveSeason()` — idempotent, Pflicht in `beforeAll`
- `createTournament(request, opts)` → `registerUsers(slug, users)` → `generateBracket(request, slug)`
- `startMatch(request, matchId)` / `reportMatchResult(request, matchId, opts)`
- `cleanupTestData(userIds)` — cascade-geordnetes Cleanup aller Test-Entities

---

## Konventionen

- **Auth:** immer `signInRequest`/`signInBrowser` — nie UI-Login-Flow
- **Cleanup:** `cleanupTestData(userIds)` im `afterEach`/`afterAll` — kein globales `deleteMany`
- **Season:** `ensureActiveSeason()` im `beforeAll` wenn Leaderboard/Faction-Stats getestet werden
- **webServer:** lokal `pnpm dev`, CI `pnpm start`/`preview` (pre-built) — `playwright.config.ts` wählt automatisch

---

## Verweise

- `.knowledge/testing.md` — vollständige Dokumentation (Config-Details, alle Helper-Signaturen, Commands)
- `.knowledge/auth.md` — Test-Login-Bypass-Implementierung
