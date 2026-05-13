> Read-when: Caching-Implementierung, Redis-Keys, Cache-Invalidierung, neue Cached-Route.

**TL;DR**
- Read-through-Cache via `cached(redis, key, compute, opts)` — bei Miss wird `compute()` aufgerufen und das Ergebnis in Redis gesetzt.
- Pattern-Invalidierung via `invalidate(redis, pattern)` nutzt SCAN+DEL (nicht KEYS) um den Redis-Event-Loop nicht zu blockieren.
- Drei Redis-Instanzen dekoriert auf `fastify`: `redis` (Read/Write), `redisPub`/`redisSub` (Socket.IO-Pub/Sub-Adapter).

---

## API

Quellen: `apps/backend/src/lib/cache.ts`, `apps/backend/src/plugins/redis.ts`

### `cached<T>`

```typescript
export async function cached<T>(
  redis: Redis | undefined,
  key: string,
  compute: () => Promise<T>,
  opts: CacheOptions,           // { ttlSeconds: number }
): Promise<T>
```

Versucht `GET key`. Bei Hit: JSON-parse und zurückgeben. Bei Miss: `compute()` ausführen, Ergebnis mit `SET key ... EX ttlSeconds` speichern. Fehler bei GET oder SET sind nicht-fatal — bei GET-Fehler wird `compute()` direkt aufgerufen.

### `invalidate`

```typescript
export async function invalidate(
  redis: Redis | undefined,
  pattern: string,
): Promise<number>   // Anzahl gelöschter Keys
```

Iteriert via `SCAN cursor MATCH pattern COUNT 100` in einer do-while-Schleife bis `cursor === '0'`. Gefundene Keys werden per `DEL` entfernt. Kein blockierendes `KEYS`-Kommando.

### `cacheKey`

```typescript
export function cacheKey(
  prefix: string,
  params: Record<string, string | number | boolean | null | undefined>,
): string
```

Sortiert die Einträge alphabetisch nach Key, filtert `undefined`-Werte heraus, und konkateniert als `prefix:k1=v1&k2=v2`. Deterministisch — Reihenfolge der `params`-Übergabe ist egal.

Beispiel: `cacheKey('leaderboard:season', { seasonId: 'x', page: 1 })` → `'leaderboard:season:page=1&seasonId=x'`

---

## Snippet — typische Nutzung

Aus `apps/backend/src/routes/leaderboard.ts` (gekürzt):

```typescript
return cached(
  fastify.redis,
  cacheKey('leaderboard:season', { seasonId: resolvedSeasonId, page, pageSize }),
  async () => {
    // ... DB-Abfragen ...
    return { entries, total, page, pageSize };
  },
  { ttlSeconds: 60 },
);
```

---

## Redis-Key-Konventionen

| Key-Pattern | TTL | Gesetzt in |
|---|---|---|
| `user:role:<userId>` | 60s | `plugins/auth.ts` → `requireRole()` |
| `leaderboard:season:page=<n>&pageSize=<n>&seasonId=<uuid>` | 60s | `routes/leaderboard.ts` |
| `leaderboard:all-time:page=<n>&pageSize=<n>` | 120s | `routes/leaderboard.ts` |
| `factions:list:seasonId=<uuid>` | 60s | `routes/factions.ts` |
| `factions:detail:id=<id>&seasonId=<uuid>` | (Route-TTL) | `routes/factions.ts` |

---

## Drei Redis-Instanzen

Quelle: `apps/backend/src/plugins/redis.ts`

`main.duplicate()` erstellt zwei Kopien derselben Verbindungskonfiguration:

```typescript
const main = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: 3 });
const pub  = main.duplicate();
const sub  = main.duplicate();
```

Alle drei werden per `fastify.decorate(...)` registriert:

| Dekorator | Zweck |
|---|---|
| `fastify.redis` | Standard Read/Write (GET, SET, SCAN, DEL) |
| `fastify.redisPub` | Socket.IO-Adapter — Publish-Kanal |
| `fastify.redisSub` | Socket.IO-Adapter — Subscribe-Kanal |

`pub` und `sub` dürfen nicht für normale Cache-Operationen verwendet werden, weil eine subscribte Verbindung keine anderen Kommandos annimmt.

---

## Testmode ohne Redis

Wenn `buildApp({ withRedis: false })` (siehe `apps/backend/src/app.ts`), wird das Redis-Plugin nicht registriert. `fastify.redis` ist dann `undefined`.

`cached(undefined, ...)` fällt gracefully durch:

```typescript
if (!redis) {
  return compute();   // direkt, kein Cache
}
```

`invalidate(undefined, ...)` gibt `0` zurück. Kein Test-Code muss Redis mocken.

---

## Invalidierungs-Best-Practice

Bei einer Mutation (z.B. Punktestand-Update, Rollen-Änderung) immer das **breiteste sinnvolle Pattern** invalidieren:

```typescript
// Nach einem Match-Ergebnis-Update:
await invalidate(fastify.redis, 'leaderboard:*');

// Nach Rollen-Änderung eines Users:
await invalidate(fastify.redis, `user:role:${userId}`);
```

Einzelne Keys per `DEL` zu löschen ist fehleranfällig, wenn `cacheKey()` mehrere Paramter-Kombinationen gecacht hat. Pattern-Invalidierung ist sicherer.
