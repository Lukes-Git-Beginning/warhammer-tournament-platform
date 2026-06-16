> Read-when: Backend-Routing/Plugins/Architektur, neues Plugin/Route hinzufügen, ENV-Var-Check.

## TL;DR

- `buildApp()` in `src/app.ts` ist eine testfähige Factory, die Fastify 5 konfiguriert — Feature-Flags steuern welche Plugins aktiv sind.
- Plugin-Reihenfolge ist zwingend: `db → redis → auth → draft → socket → cron → routes` (jede Stufe setzt Dekoratoren, die die nächste braucht).
- Alle Plugins registrieren Fastify-Dekoratoren (`fastify.prisma`, `fastify.redis`, `fastify.io` usw.); Routes konsumieren sie via `preHandler`-Hooks.

---

## Entrypoint

**`src/server.ts`** — Production-Entrypoint.

```typescript
import { buildApp } from './app.js';
const PORT = Number(process.env.PORT ?? 3000);
const HOST = process.env.HOST ?? '0.0.0.0';
const app = await buildApp();
await app.listen({ port: PORT, host: HOST });
```

- Lädt `.env` via `dotenv/config`.
- Registriert `SIGINT`/`SIGTERM`-Handler: ruft `app.close()` auf, dann `process.exit(0)`.
- Bei Fehler beim Start: `process.exit(1)`.

### Production-Runtime: tsx via systemd

In Production läuft das Backend nicht als kompiliertes JS, sondern wird zur Laufzeit via `tsx` ausgeführt. Grund: `packages/db` exportiert TypeScript-Source direkt (`"main": "./src/index.ts"`, `noEmit: true`) und Prisma 7 generiert `.ts`-Files in `packages/db/generated/prisma/`. `tsx` löst beide Probleme ohne Build-Step.

- systemd-Unit: `deploy/systemd/rizzotto-backend.service`
- ExecStart: `/home/deploy/rizzotto/apps/backend/node_modules/.bin/tsx /home/deploy/rizzotto/apps/backend/src/server.ts`
- EnvironmentFile: `/etc/rizzotto/env/backend.env` (0640 root:deploy)
- HOST=127.0.0.1 (Caddy proxied — kein 0.0.0.0 nötig)

Cleanup-Pfad: `packages/db` zu echtem JS-Build refactoren (`noEmit: false`, Prisma-Output unter `dist/`). Eliminiert tsx-Runtime-Overhead, erlaubt `node dist/server.js`. Geplant als Post-Launch-Issue.

---

## buildApp() Factory

**`src/app.ts`** — zentrale Konfigurations- und Registrierungslogik.

### Warum Factory statt Global-Singleton?

Tests instantiieren die App frisch mit `buildApp({ withSocket: false, withRedis: false, withCron: false })`. So gibt es keine Seiteneffekte zwischen Tests, kein Redis-Adapter, keine Cron-Jobs.

### BuildAppOptions-Flags

```typescript
export interface BuildAppOptions {
  withSocket?: boolean;   // default true — Socket.IO + Redis-Adapter
  withRedis?: boolean;    // default true — ioredis (3 Connections)
  withCron?: boolean;     // default true — node-cron (täglich 00:05 UTC)
  withGraphql?: boolean;  // default true — Mercurius /graphql Endpoint
  withDraft?: boolean;    // default true — DraftService (benötigt redis)
}
```

`withDraft` wird nur registriert wenn `withDraft && withRedis` beide `true` sind.

### Middleware-Reihenfolge in buildApp()

Vor den Plugins werden diese Fastify-Plugins registriert:

1. `@fastify/helmet` (Security-Headers, CSP deaktiviert)
2. `@fastify/multipart` (max. 5 MB Datei-Upload)
3. `@fastify/cors` (Origin aus `FRONTEND_URL`)
4. `@fastify/rate-limit` (300 req / 1 Minute)

Danach folgt die Plugin-Kette (siehe nächste Sektion).

---

## Plugin-Reihenfolge

**Kritisch:** Jede Stufe setzt Dekoratoren, die nachfolgende Plugins und Routes benötigen. Falsche Reihenfolge führt zu „Decorator not found"-Fehlern zur Laufzeit.

| Stufe | Plugin | Datei | Warum hier |
|-------|--------|-------|------------|
| 1 | `db` | `plugins/db.ts` | Prisma wird von auth (requireRole), draft, cron, routes und graphql benötigt — muss zuerst verfügbar sein |
| 2 | `redis` *(opt.)* | `plugins/redis.ts` | Socket.IO-Adapter und requireRole-Cache brauchen Redis; auth liest Redis optional, draft hat Hard-Dependency |
| 3 | `auth` | `plugins/auth.ts` | Dekoratoren `authenticate`/`requireRole`/`signAuthCookie`/`clearAuthCookie` werden in Routes als `preHandler` genutzt |
| 4 | `draft` *(opt.)* | `plugins/draft.ts` | `DraftService` braucht `fastify.prisma` + `fastify.redis`; wird von `socket` aufgerufen (optional `io`) |
| 5 | `socket` *(opt.)* | `plugins/socket.ts` | Hängt von `auth` (JWT-Verify), `redis` (Adapter) und `draft` (Handler) ab; deklariert `dependencies: ['auth', 'redis', 'draft']` |
| 6 | `cron` *(opt.)* | `plugins/cron.ts` | Braucht nur `db`; läuft unabhängig von Routes, wird nach Socket registriert |
| 7 | Routes | `routes/*.ts` | Konsumieren alle Dekoratoren; `graphql` wird als letztes registriert |

**Codebeleg aus `app.ts`:**

```typescript
await app.register(dbPlugin);
if (withRedis) await app.register(redisPlugin);
await app.register(authPlugin);
if (withDraft && withRedis) await app.register(draftPlugin);
if (withSocket) await app.register(socketPlugin);
if (withCron) await app.register(cronPlugin);
// ... routes ...
if (withGraphql) await app.register(graphqlPlugin);
```

---

## Fastify-Dekoratoren

Alle Plugins erweitern das `FastifyInstance`-Interface per `declare module 'fastify'`.

| Dekorator | gesetzt von | Typ / Zweck |
|-----------|-------------|-------------|
| `fastify.prisma` | `plugins/db.ts` | `PrismaClient` — DB-Zugriff in Routes und anderen Plugins |
| `fastify.redis` | `plugins/redis.ts` | `Redis` (ioredis) — allgemeine Cache-Operationen |
| `fastify.redisPub` | `plugins/redis.ts` | `Redis` — dedizierte Pub-Connection für Socket.IO-Adapter |
| `fastify.redisSub` | `plugins/redis.ts` | `Redis` — dedizierte Sub-Connection für Socket.IO-Adapter |
| `fastify.authenticate` | `plugins/auth.ts` | `(req, reply) => Promise<void>` — JWT-Cookie verifizieren; 401 bei Fehler |
| `fastify.requireRole` | `plugins/auth.ts` | `(...roles: Role[]) => preHandler` — Rollen-Check nach `authenticate`; liest Role aus Redis-Cache (TTL 60 s) oder DB |
| `fastify.signAuthCookie` | `plugins/auth.ts` | `(reply, payload) => void` — JWT signieren und als `httpOnly`-Cookie setzen |
| `fastify.clearAuthCookie` | `plugins/auth.ts` | `(reply) => void` — Cookie bei Logout entfernen |
| `fastify.io` | `plugins/socket.ts` | `AppIOServer` — typisierter Socket.IO-Server; wird in Routes für manuelle Emits genutzt |
| `fastify.draftService` | `plugins/draft.ts` | `DraftService` — koordiniert Draft-State, Picks, Timer und Socket-Emits |
| `fastify.cronTasks` | `plugins/cron.ts` | `ScheduledTask[]` — interne Referenz, `stop()` wird bei `onClose` aufgerufen |

Für Auth-Details [siehe `.knowledge/auth.md`].

---

## Route-Map

Alle Route-Files registrieren sich direkt mit absoluten Pfaden (kein `prefix`-Option in `app.register`).

| File | Methoden & Pfade | Schutz |
|------|-----------------|--------|
| `routes/auth.ts` | `GET /auth/discord` (redirect), `GET /auth/discord/callback`, `POST /auth/logout`, `POST /auth/test-login` | `/test-login` nur wenn `NODE_ENV=test` |
| `routes/users.ts` | `GET /api/users/me`, `PATCH /api/users/me`, `PATCH /api/users/:id/role`, `GET /api/users/:id` | `me`-Endpunkte: `authenticate`; role-Patch: `ADMIN` |
| `routes/tournaments.ts` | `GET /api/tournaments`, `GET /api/tournaments/:slug`, `POST /api/tournaments`, `PATCH /api/tournaments/:slug`, `DELETE /api/tournaments/:slug` | Schreibende Ops: `authenticate` + `ORGANIZER`/`ADMIN` |
| `routes/participants.ts` | `POST /api/tournaments/:slug/register`, `POST /api/tournaments/:slug/checkin`, `POST /api/tournaments/:slug/withdraw`, `GET /api/tournaments/:slug/participants` | Register/Checkin/Withdraw: `authenticate` |
| `routes/matches.ts` | `POST /api/matches/:id/result`, `PATCH /api/matches/:id`, `GET /api/matches/:id/draft` | `authenticate` |
| `routes/bracket.ts` | `GET /api/tournaments/:slug/bracket`, `POST /api/tournaments/:slug/bracket/advance` | Advance: `authenticate` + `ORGANIZER`/`ADMIN` |
| `routes/leaderboard.ts` | `GET /api/leaderboard`, `GET /api/leaderboard/all-time` | Public |
| **`routes/rating.ts`** | **Dynamic Leaderboard (Alex-Spec):** `GET /api/matches/:id/scoring-breakdown`, `GET /api/leaderboard/anti-farming`, `GET /api/factions/matchup-matrix`, `GET /api/players/:id/faction-proficiency` | Public |
| `routes/factions.ts` | `GET /api/factions`, `GET /api/factions/:id` | Public |
| `routes/meta.ts` | `GET /api/meta/overview`, `GET /api/meta/matchups` | Public |
| `routes/drafts.ts` | `GET /api/drafts/:id`, `GET /api/drafts/:id/events`, `POST /api/drafts/:id/...` | Optional-Auth (Spectator wenn anonym) |
| `routes/draft-presets.ts` | `GET /api/draft-presets`, `GET /api/draft-presets/:id`, `POST /api/draft-presets`, `PUT /api/draft-presets/:id`, `DELETE /api/draft-presets/:id` | Schreibende Ops: `ORGANIZER`/`ADMIN` |
| `routes/admin.ts` | `GET /api/admin/audit-log`, `GET /api/admin/stats`, `POST /api/admin/users/:id/ban`, `DELETE /api/admin/users/:id/ban`, **+Welle 2:** `GET /api/admin/stats/{faction-winrates,elo-distribution,dropoff-funnel,pickban-stats}`, `CRUD /api/admin/maps[/:id]`, `POST/PATCH /api/admin/factions[/:id]`, `POST /api/admin/factions/:id/sigil` (multipart), `GET /api/admin/config/all`, `GET/PUT /api/admin/config/:key` | Alle: `authenticate` + `ADMIN` |
| `routes/army-lists.ts` | `POST /api/army-lists` (multipart), `GET /api/army-lists` | `authenticate` (scope-Hook) |
| `routes/seasons.ts` | `GET /api/seasons`, `GET /api/seasons/active`, `GET /api/seasons/:id`, `POST /api/seasons`, `PATCH /api/seasons/:id`, `DELETE /api/seasons/:id` | Schreibende Ops: `ADMIN` |
| **`routes/maps.ts`** | `GET /api/maps` (cached 5min, public) | Public; Admin-CRUD läuft über `routes/admin.ts` |
| **`routes/match-decision.ts`** | `POST /api/matches/:id/decision/{start,ban,random}`, `POST /api/matches/:id/decision/blind-pick/lock` | `authenticate` + Player-of-Match-Check |
| **`routes/tournament-army-lists.ts`** | `POST /api/tournaments/:slug/army-list` (multipart), `GET /api/tournaments/:slug/army-lists/{me,all,:opponent_user_id}` | `authenticate` + SLT-Mode + Reveal-Logic |
| `routes/auth.ts` (erweitert) | **+Welle 2:** `GET /auth/steam/login`, `GET /auth/steam/return` (OpenID 2.0) | Public (Steam-Flow), persistiert SteamLink |
| `routes/tournaments.ts` (erweitert) | **+Welle 2:** `GET /api/tournaments/:slug/maps` (cached 5min), `GET /api/tournaments/:slug/participants/me` | Public (maps) / `authenticate` (me) |
| `routes/users.ts` (erweitert) | **+Welle 2:** `GET /api/users?search=&page=&limit=` (Admin-Search-Bug-Fix), `GET /api/users/:id/stats?season=` (Personal-Stats mit TT-Seed-Fallback) | search: `ADMIN`; stats: `authenticate` |
| `routes/leaderboard.ts` (erweitert) | **+2026-06:** Default-Mode `rating_model` (derive-on-read via `leaderboard-service.ts`); Mode-Enum nach Phase-2-Cleanup auf `rating_model\|winrate` reduziert (`season_points`/`weighted_winrate` entfernt) | Public |
| `routes/rating.ts` | **Explainability (Alex-Spec):** `GET /api/matches/:id/scoring-breakdown`, `/api/leaderboard/anti-farming`, `/api/factions/matchup-matrix`, `/api/players/:id/faction-proficiency` — derive-on-read via `lib/breakdown-service.ts`, alle 4 seit Phase-2 im Frontend angebunden | Public |
| `routes/matches.ts` (erweitert) | **+Welle 2:** `GET /api/matches/:id`, Playoff-Winner-Propagation; **+2026-06:** inkrementeller MMR-Hook (`computeWinPoints` etc.) **entfernt** (Leaderboard ist jetzt derive-on-read); stempelt `season_id`/`played_at`; invalidiert zusätzlich `rating-model:*` und `h2h:*`. FactionStats/MatchupStats-Writes bleiben | `authenticate` |
| `routes/users.ts` (erweitert, M6) | **+M6:** `GET /api/users/:a/vs/:b` — Head-to-Head-Aggregation zwischen zwei Spielern (`summary` W/L/Draws, `winrate_a`, `faction_breakdown`, `recent_matches`). Gating: `fastify.authenticate` (wie `/users/:id/stats`). Zählt alle COMPLETED-Matches inkl. Draws — eigene `baseWhere` (NICHT `confirmedMatchWhere`, das ist decisive-only fürs Rating-Modell) | `authenticate` |
| `routes/tournaments.ts` (erweitert, M6) | **+M6:** `GET /api/tournaments/calendar` (JSON, `CalendarTournament[]`) + `GET /api/tournaments/calendar.ics` (iCal via `ical-generator`) — beide public, beide registriert VOR `/:slug`. `end_date`-Heuristik: `start_date + rounds_count * 2h` (kein DB-Feld). `.ics` setzt `Content-Type: text/calendar; charset=utf-8`, kein Caching. Außerdem: `GET /api/tournaments` List-Route um Filter `status`/`is_major`/`date_from`/`date_to` erweitert; `is_major` jetzt auch via `PATCH /api/tournaments/:slug` patchbar | Public (calendar); `ORGANIZER`/`ADMIN` (PATCH) |
| `routes/admin.ts` (erweitert, M6) | **+M6:** `GET /api/admin/import-log` — paginiert + `source`-Filter. Erbt das scope-weite `requireRole('ADMIN')` (Hook ~Z.92, kein per-Route-Gating nötig) | `authenticate` + `ADMIN` (scope-Hook) |
| `routes/bracket.ts` (erweitert) | **+Welle 2:** Auto-Playoff-Generation nach letzter Swiss-Runde via `generatePlayoffBracket()`; nutzt `sortSwissStandings()` für Seed-Ermittlung; emittiert `notifyRoundPairings` | `authenticate` + `ORGANIZER`/`ADMIN` |
| `routes/participants.ts` (erweitert) | **+Welle 2:** `POST /api/tournaments/:slug/checkin/self` (Player-driven, T-60min Window) · **+M7:** GET participants maskiert `faction: null` wenn `mode=SFT` und Status nicht ONGOING/COMPLETED | `authenticate` |
| `routes/bracket.ts` (erweitert, M7) | **+M7:** `POST /api/tournaments/:id/bracket/reset` — nullt `next_match_id`/`loser_next_match_id`, deleteMany Matches (cascade: MatchGame, MatchMapDecision, MatchBlindPick, Draft, DraftEvent, MatchReport), setzt Status auf `REGISTRATION_CLOSED`; emittiert `bracket_update` + `tournament_status_change` | `authenticate` + `ORGANIZER`/`ADMIN` + Organizer-Ownership-Check |
| `plugins/graphql.ts` | `GET|POST /graphql` (Mercurius), `GET /graphiql` (nur non-prod) | Optional-Auth im Context |

Zusätzlich registriert `buildApp()` direkt: `GET /health` → `{ status: 'ok', timestamp }`.

---

## lib/-Utilities

| File | Zweck |
|------|-------|
| `lib/cache.ts` | `cached(redis, key, compute, opts)` und `invalidate(redis, key)` — generisches Read-Through-Caching [siehe `.knowledge/caching.md`] |
| `lib/bracket.ts` | `generateSingleElim(participants)` — Single-Elimination-Bracket-Generierung |
| `lib/swiss.ts` | `generateSwissRound()`, `computeSwissStandings()`, `recommendNumberOfRounds()` — Swiss-Paarungslogik |
| `lib/round-robin.ts` | `generateRoundRobin(participants)` — Round-Robin-Schedule |
| `lib/elo.ts` | Multi-Player-ELO-Berechnung für TWW3-Performance-Rating |
| `lib/finalize-tournament.ts` | `finalizeTournament()` — schreibt Placements, ELO-Updates und Punkte nach Tournament-Ende |
| `lib/factions.ts` | `getFactionsWithStats()`, `asFactionDto()`, `asFactionStatsDto()` — Stats-Aggregation aus DB |
| `lib/faction-snapshot.ts` | `takeFactionsSnapshot(prisma)` — täglicher Cron-Snapshot der Fraktionsstatistiken |
| `lib/heatmap.ts` | `getMatchupMatrix()` — 24×24-Faction-Matchup-Heatmap |
| `lib/tournament-utils.ts` | `generateSlug()`, `validateStatusTransition()`, `TournamentStatus`-Enum — Status-Transitions und Slug-Generierung |
| `lib/emit.ts` | `emitMatchResult()`, `emitStatusChange()`, `emitBracketUpdate()`, `emitParticipantChange()` — typisierte Socket.IO-Emit-Wrapper |
| `lib/draft-service.ts` | `DraftService`-Klasse — koordiniert Draft-Lifecycle, Picks, Timer und Emits [siehe `.knowledge/draft-system.md`] |
| `lib/draft-state.ts` | Pure State-Machine für Draft-Züge (keine IO-Abhängigkeiten) |
| `lib/draft-emit.ts` | Draft-spezifische Socket-Emit-Helpers (`draft_state_sync`, `draft_pick`, etc.) |
| `lib/army-parser.ts` | `parseTxtArmyList()`, `isPdf()`, `isTxt()` — TXT-Army-List-Parser (PDF-Support vorbereitet) |
| **`lib/army-setup-parser.ts`** | **Welle 2** — `parseArmySetup(buffer)` / `parseArmySetupSafe()` für TWW3 `.army_setup` binary Format (ASCII Strings mit uint16 LE Length-Prefix, Faction-Slug + Unit-Keys) |
| **`lib/playoff-generator.ts`** | **Welle 2** — `generatePlayoffBracket()` für NONE/TOP4/TOP8 mit Auto-Fallback TOP8→TOP4 bei <16 checked-in |
| **`lib/mmr.ts`** | **Welle 2, DEPRECATED** — `computeWinPoints()` 3-Faktor-Formel etc.; seit 2026-06 nicht mehr im Match-Pfad aufgerufen (durch das Rating-Modell abgelöst, Funktionen bleiben importierbar) |
| **`lib/rating-model.ts`** | **Dynamic Leaderboard** — pure L2-Logistic-Regression (`fitRatingModel`, Adam, deterministisch); `PlayerFactionSkill` + antisymmetrischer `MatchupEffect`; `createRatingModel`/`logistic` |
| **`lib/rating-model-service.ts`** | async Wrapper — lädt Season-Matches, fittet, cacht (`rating-model:*`); `getRatingModel`/`invalidateRatingModelCache`/`confirmedMatchWhere`/`loadRatingModelConfig` |
| **`lib/scoring-service.ts`** | pure Punktelogik — `rawPoints`/`opponentShare`/`opponentModifier`/`finalPoints` (Alex-Spec) |
| **`lib/leaderboard-service.ts`** | `computeSeasonLeaderboard()` — Zwei-Pass-Aggregation der FinalPoints pro Spieler |
| **`lib/breakdown-service.ts`** | Explainability — `matchBreakdown`/`playerOpponentBreakdown`/`factionMatchupMatrix`/`playerFactionProficiency` |
| **`lib/discord-notify.ts`** | **Welle 2** — 4 Notification-Trigger: `notifyTournamentAnnounce()`, `notifyCheckInReminder()`, `notifyRoundPairings()`, `notifyDispute()`. Silent no-op wenn `DISCORD_BOT_TOKEN` fehlt |
| **`lib/tt-scraper.ts`** | **Welle 2** — `scrapeTotalTavernFactionStats()` Playwright-Headless-Crawler für TT-Faction-Stats-Seed (24 Factions × 576 Matchups) |

---

## ENV-Variablen

Zwei Quell-Files: `.env.example` im repo-root (Dev-Defaults) und `deploy/.env.production.example` (Production-Template, wird zu `/etc/rizzotto/env/backend.env` auf dem Server). Pflichtfelder werden im Code mit expliziten `throw new Error()`-Guards gesichert. Folgende Variablen sind relevant:

| Variable | Beispielwert | Zweck | Pflicht |
|----------|-------------|-------|---------|
| `DATABASE_URL` | `postgresql://user:pw@localhost:5432/tww3` | Prisma-Verbindungsstring | Ja |
| `REDIS_URL` | `redis://localhost:6379` | ioredis-Connection (alle 3 Instanzen) | Ja (wenn `withRedis=true`) |
| `JWT_SECRET` | `min-32-chars-random-string` | JWT-Signatur; muss ≥ 32 Zeichen sein | Ja |
| `JWT_COOKIE_NAME` | `auth_token` | Cookie-Name für JWT; default `auth_token` | Nein |
| `JWT_COOKIE_DOMAIN` | `localhost` | Cookie-Domain; default `localhost` | Nein |
| `JWT_EXPIRES_IN` | `604800` | JWT-TTL in Sekunden; default 7 Tage | Nein |
| `DISCORD_CLIENT_ID` | `123456789` | Discord OAuth2 App-ID | Ja |
| `DISCORD_CLIENT_SECRET` | `secret` | Discord OAuth2 Secret | Ja |
| `DISCORD_REDIRECT_URI` | `http://localhost:3000/auth/discord/callback` | OAuth Callback-URL | Ja |
| `DISCORD_SCOPES` | `identify email` | OAuth-Scopes; default `identify email` | Nein |
| `FRONTEND_URL` | `http://localhost:5173` | CORS-Origin + Redirect nach Login | Nein |
| `BACKEND_URL` | `http://localhost:3000` | Für interne Referenzen | Nein |
| `PORT` | `3000` | HTTP-Port; default 3000 | Nein |
| `HOST` | `0.0.0.0` | Bind-Adresse; default `0.0.0.0` | Nein |
| `NODE_ENV` | `production` | Aktiviert Proxy-Trust, pino-pretty off, test-login guard | Nein |
| `LOG_LEVEL` | `info` | Pino-Log-Level; default `info` | Nein |
| `UPLOAD_DIR` | `/app/uploads/army-lists` | Upload-Verzeichnis für Army-Lists | Nein |
| `ARMY_LIST_UPLOAD_DIR` | `apps/backend/uploads/army-lists` | **Welle 2** — Upload-Verzeichnis für SLT `.army_setup`-Files + Screenshots | Nein |
| `STEAM_OPENID_RETURN_URL` | `http://localhost:3000/auth/steam/return` | **Welle 2** — Steam-OpenID-Callback (Pflicht für Steam-Hard-Gate) | Ja (Production) |
| `STEAM_WEB_API_KEY` | `AAAAA1234...` | **Welle 2** — Optional, für Persona/Avatar-Daten aus Steam Web API | Nein |
| `DISCORD_BOT_TOKEN` | `MTAxNDY...` | **Welle 2** — Discord-Bot-Token für Notifications (Channel-Embed + DM); fehlt → no-op | Nein (Dev) / Ja (Production) |

---

## Error-Shape

Alle HTTP-Fehlerantworten folgen dieser Konvention:

```typescript
{
  error: string;      // maschinenlesbare Kurzbezeichnung, z. B. "Unauthorized", "BadRequest"
  message: string;    // menschenlesbare Beschreibung
  statusCode: number; // HTTP-Statuscode, identisch zum Response-Code
}
```

Beispiel aus `auth.ts`:

```json
{
  "error": "Unauthorized",
  "message": "Missing or invalid auth token",
  "statusCode": 401
}
```

---

## Neue Route hinzufügen

Checkliste für neue Endpunkte:

1. **File anlegen:** `apps/backend/src/routes/my-feature.ts`
2. **Default-Export:** `FastifyPluginAsync`-Funktion
   ```typescript
   import type { FastifyPluginAsync } from 'fastify';
   const myRoutes: FastifyPluginAsync = async (fastify) => {
     fastify.get('/api/my-feature', async (request, reply) => { ... });
   };
   export default myRoutes;
   ```
3. **In `app.ts` importieren und registrieren:**
   ```typescript
   import myRoutes from './routes/my-feature.js';
   // in buildApp():
   await app.register(myRoutes);
   ```
4. **Geschützte Route:** Auth-Hook als erstes setzen:
   ```typescript
   // Scope-weit (alle Routes im Plugin):
   fastify.addHook('preHandler', fastify.authenticate);
   fastify.addHook('preHandler', fastify.requireRole('ADMIN'));
   // Oder per Route:
   fastify.get('/api/foo', { preHandler: fastify.authenticate }, handler);
   ```
5. **Reihenfolge:** Immer `authenticate` vor `requireRole` — `requireRole` liest `request.user`, das erst nach JWT-Verify verfügbar ist.
6. **Validation:** Zod-Schemas aus `@rizzotto/types` verwenden; `.safeParse()` und bei Fehler 400 zurückgeben.
7. **ESM-Imports:** Alle lokalen Imports mit `.js`-Extension (`../lib/cache.js`).
8. **Caching:** Read-Through-Pattern mit `cached(fastify.redis, key, compute, { ttlSeconds })` wo sinnvoll [siehe `.knowledge/caching.md`].

## Neue Endpoints (2026-06-14)

| Endpoint | Datei | Beschreibung |
|---|---|---|
| `PATCH /api/matches/:id/void` | `matches.ts` | Match vom Leaderboard ausschließen (reversibel); Permission: ADMIN/MOD oder Tournament-Host |
| `POST /api/matches/:id/restore` | `matches.ts` | FORFEIT/CANCELLED → PENDING; löscht winner_id, result, score, played_at |
| `POST /api/matches/:id/cancel-match` | `matches.ts` | → CANCELLED; aus Swiss-Standings + round-complete-Check ausgeschlossen |
| `POST /api/tournaments/:slug/participants/:userId/undrop` | `participants.ts` | WITHDREW → CHECKED_IN; stellt FORFEIT-Matches NICHT automatisch her |
| `POST /api/admin/tournaments/:slug/add-late` | `admin.ts` | Spieler nach Turnierstart hinzufügen (bypasses OPEN_REGISTRATION-Check); CHECKED_IN sofort |
| `GET /api/admin/matches` | `admin.ts` | Paginierte Match-Liste (COMPLETED/FORFEIT/BYE/CANCELLED) mit Leaderboard-Status und Void-Toggle; Filter: voided, search, tournamentSlug |

**Permission-Pattern für Host-eigene Resourcen** (aus `matches.ts`):
```typescript
const role = request.user?.role;
const userId = request.user?.sub;  // JWT sub = user ID (nicht .id!)
const isAdminOrMod = role === 'ADMIN' || role === 'MODERATOR';
const isHost = userId && match.tournament?.organizer_id === userId;
if (!isAdminOrMod && !isHost) return reply.code(403)...
```

## Profil-Stats-Quelle umgestellt (2026-06-16)

`getUserProfile` (`routes/users.ts`) liest `current_season` **und** `all_time` jetzt **dynamisch** über die neuen Helper `getPlayerSeasonStats` / `getPlayerAllTimeStats` (`lib/leaderboard-service.ts`, derive-on-read via `computeSeasonLeaderboard`) — **nicht mehr** aus `LeaderboardEntry`. Damit sind Profil-Punkte konsistent mit dem dynamischen Leaderboard (jetzt Float, `.toFixed(1)`); `all_time` = Summe der Modell-Punkte über alle Seasons. Die `LeaderboardEntry`-**Schreibpfade bleiben** und versorgen weiterhin `/api/leaderboard/all-time` (`routes/leaderboard.ts`). `getUserStats` (Recent Form, letzte 20 Games) ist unverändert — nur das Card-Label wurde auf „Recent Win / Loss" präzisiert. Die Entfernung der redundanten `LeaderboardEntry`-Felder (`games_played/wins/losses`) bleibt post-v1-Backlog (ROADMAP §5.7).

## Game-level Stats & Open-Play-Hygiene (2026-06-16 PM)

- **Statistische Einheit = Game, nicht Match.** Admin-KPI `GET /api/admin/stats` zählt jetzt `matchGame.count({ status: COMPLETED })` und gibt `gamesPlayed` zurück (vorher `match.count()` → `matchesPlayed`). Frontend-Type `AdminStats.gamesPlayed` (`api.ts`), Label „Games Played".
- **`POST /api/admin/recompute-faction-stats`** (`routes/admin.ts`, ADMIN-scope) → ruft `recomputeFactionStats()` (`lib/recompute-faction-stats.ts`) für **jede** Season. Baut `FactionStats` + `MatchupStats` **game-level** aus den `COMPLETED` `MatchGame`-Records neu auf (delete-then-rebuild in einer Transaktion → idempotent). **Behebt den FactionStats-Drift** (Void/Cancel/Edit korrigierte die Inkrement-Zähler nie) UND garantiert Game-Granularität unabhängig vom Schreibpfad. Caveat: `matches_played`-Spalte hält jetzt den **Game**-Count (kein Rename → keine Migration); `pick_count` = Game-Count (Legacy-Konflation), `ban_count` = 0; winner-loses `MatchGame` = Draw. Invalidiert `factions:*` + `meta:*`. Dashboard-Button in `StatsDashboard.tsx`.
  - **Kontext (3 Stats-Schreibpfade):** `match-games.ts` (GameTile, **schon game-level**), `routes/matches.ts` (Legacy-Einzelergebnis, legt 1 Game an → effektiv game-level), `match-result-service.ts` (`resolveMatchResult`, Doppel-Report, **match-level**). Der Recompute aus der Wahrheitsquelle (`MatchGame`) macht diese Inkonsistenz irrelevant.
- **Stale-Open-Play-Cron** (`plugins/cron.ts`, `staleOpenPlayTask`, stündlich :15): canceled `type=OPEN_PLAY, status=ONGOING` Matches älter als `STALE_OPEN_PLAY_HOURS` (24 h) → `CANCELLED`. Behebt ewig offene Ladder-Matches (kein Timeout-Mechanismus vorher).
- **Profil-Turnierzahl** (`routes/users.ts`): `tournaments_played` = distinct Turniere mit ≥1 `COMPLETED` `MatchGame` des Spielers (statt `tournamentResult.count`). Teilnahme-basiert: unabhängig von Finalisierung/Drop; Draw zählt (gespieltes Game), reiner FORFEIT/Drop nicht.
