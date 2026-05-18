# TWW3 Backend

Fastify 5 API-Server mit Prisma 7 (DB), Socket.IO (Realtime), Redis (Cache + Pub/Sub) und Mercurius (GraphQL). Einstiegspunkt ist `src/app.ts` (`buildApp()`-Factory) — `src/server.ts` ruft sie auf und lauscht auf `PORT` (default 3000).

## Commands

```bash
pnpm -F @rizzotto/backend dev
pnpm -F @rizzotto/backend test
pnpm -F @rizzotto/backend test -- <pattern>
pnpm -F @rizzotto/backend typecheck
pnpm -F @rizzotto/backend lint
```

## Plugin-Reihenfolge

```
db → redis → auth → draft → socket → cron → routes → graphql
```

Reihenfolge ist zwingend — jede Stufe setzt Dekoratoren, die die nächste braucht. Details: [`.knowledge/backend-architecture.md`]

## Dekoratoren-Quick-Ref

| Dekorator | gesetzt von | Verwendung |
|-----------|-------------|-----------|
| `fastify.prisma` | `plugins/db.ts` | DB-Zugriff überall |
| `fastify.redis` | `plugins/redis.ts` | Cache, allgemeine Ops |
| `fastify.redisPub` / `fastify.redisSub` | `plugins/redis.ts` | Socket.IO-Adapter |
| `fastify.authenticate` | `plugins/auth.ts` | `preHandler` für geschützte Routes |
| `fastify.requireRole` | `plugins/auth.ts` | `preHandler` nach `authenticate` |
| `fastify.signAuthCookie` | `plugins/auth.ts` | JWT-Cookie bei Login setzen |
| `fastify.clearAuthCookie` | `plugins/auth.ts` | Cookie bei Logout entfernen |
| `fastify.io` | `plugins/socket.ts` | Typisierter Socket.IO-Server |
| `fastify.draftService` | `plugins/draft.ts` | Draft-Lifecycle, Picks, Timer |

## Test-Isolation

Tests instantiieren die App ohne IO-Abhängigkeiten:

```typescript
import { buildApp } from '../src/app.js';
const app = await buildApp({ withSocket: false, withRedis: false, withCron: false });
```

`withDraft` wird automatisch deaktiviert wenn `withRedis: false`. `withGraphql` kann separat gesteuert werden.

## Konventionen

- **ESM-Imports:** Alle lokalen Imports mit `.js`-Extension (`../lib/cache.js`, nicht `../lib/cache`)
- **Auth-Hook-Reihenfolge:** `authenticate` vor `requireRole` — `requireRole` liest `request.user`, das erst nach JWT-Verify gesetzt ist
- **Zod-Validation:** Schemas aus `@rizzotto/types` oder lokal definiert; immer `.safeParse()` → bei Fehler `reply.code(400).send({ error: 'BadRequest', message: ..., statusCode: 400 })`
- **Error-Shape:** `{ error: string, message: string, statusCode: number }` — konsistent in allen Handlers
- **Caching:** `cached(fastify.redis, key, compute, { ttlSeconds })` für Read-Through; `invalidate(fastify.redis, key)` nach Schreiboperationen

## Verweise

| Thema | Datei |
|-------|-------|
| Architektur, Plugins, Routes im Detail | [`.knowledge/backend-architecture.md`] |
| Auth-Flow, JWT, Discord-OAuth | [`.knowledge/auth.md`] |
| Caching (`cached`/`invalidate`) | [`.knowledge/caching.md`] |
| Socket.IO Realtime-Events | [`.knowledge/realtime.md`] |
| Prisma 7, Models, driver-adapter | [`.knowledge/database.md`] |
