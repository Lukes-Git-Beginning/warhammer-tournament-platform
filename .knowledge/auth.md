> Read-when: Auth-Setup, neuer Route-Handler braucht Login/Rolle, Discord-OAuth, Frontend-Auth-State.

**TL;DR**
- Discord OAuth2 → JWT wird in einem HTTP-Only-Cookie gesetzt (Cookie-Name standardmäßig `auth_token`).
- `fastify.authenticate` als `preHandler` verifiziert das JWT und schreibt `request.user: JwtPayload`.
- `fastify.requireRole(...roles)` prüft die DB-Rolle via Redis-Cache (`user:role:<id>`, TTL 60s) mit DB-Fallback.

---

## Discord-OAuth2-Flow

Quellen: `apps/backend/src/routes/auth.ts`, `apps/backend/src/plugins/auth.ts`

1. **Browser → `GET /auth/discord`** — `@fastify/oauth2` leitet direkt zu Discord weiter (`startRedirectPath: '/auth/discord'`). Scopes: `identify email` (konfigurierbar via `DISCORD_SCOPES`).
2. **Discord → `GET /auth/discord/callback`** — Token-Exchange via `fastify.discordOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)`. Danach `fetch('https://discord.com/api/users/@me')` mit dem Access-Token.
3. **Backend: `prisma.user.upsert({ where: { discord_id } })`** — Legt neuen User an oder aktualisiert `username`, `email`, `avatar_url`, `last_login`. Gibt `id`, `discord_id`, `username`, `role` zurück.
4. **Backend: `fastify.signAuthCookie(reply, payload)`** — Signiert JWT mit `JWT_SECRET`, setzt HTTP-Only-Cookie, leitet dann zu `FRONTEND_URL` weiter.

---

## JWT-Payload-Shape

Typ `JwtPayload` aus `@tww3/types`, befüllt in `routes/auth.ts`:

```typescript
const payload: JwtPayload = {
  sub:        user.id,          // UUID des DB-Users
  discord_id: user.discord_id,  // Discord Snowflake (string)
  username:   user.username,    // global_name ?? username von Discord
  role:       user.role as Role,
};
```

`request.user` nach `fastify.authenticate` enthält genau diese Felder.

---

## Cookie-Config

Gesetzt in `plugins/auth.ts` → `signAuthCookie`:

| Feld | Wert |
|---|---|
| Name | `process.env.JWT_COOKIE_NAME ?? 'auth_token'` |
| `httpOnly` | `true` |
| `sameSite` | `'lax'` |
| `secure` | `true` in Production, `false` sonst |
| `domain` | `process.env.JWT_COOKIE_DOMAIN ?? 'localhost'` |
| `maxAge` | `process.env.JWT_EXPIRES_IN ?? 604800` (Sekunden, default 7 Tage) |
| `path` | `'/'` |

`clearAuthCookie` löscht den Cookie mit gleichem `path` und `domain`.

---

## Backend-Dekoratoren

Alle registriert in `apps/backend/src/plugins/auth.ts` via `fastify.decorate(...)`:

| Dekorator | Signatur | Zweck |
|---|---|---|
| `fastify.authenticate` | `(request, reply) => Promise<void>` | preHandler — verifiziert JWT via `request.jwtVerify()`, schreibt `request.user`. 401 bei ungültigem/fehlendem Token. |
| `fastify.requireRole(...roles)` | `(...roles: Role[]) => (request, reply) => Promise<void>` | preHandler-Factory — prüft `request.user.sub` gegen Redis-Cache (`user:role:<id>`, TTL 60s), DB-Fallback. 403 bei falscher Rolle. |
| `fastify.signAuthCookie` | `(reply, payload: JwtPayload) => void` | JWT signieren + Cookie setzen. |
| `fastify.clearAuthCookie` | `(reply) => void` | Cookie löschen (Logout). |

---

## Hook-Pattern für geschützte Routes

```typescript
// Authentifizierung (JWT prüfen):
fastify.addHook('preHandler', fastify.authenticate);

// Rollenprüfung (immer NACH authenticate, weil request.user sonst nicht gesetzt):
fastify.addHook('preHandler', fastify.requireRole('ADMIN'));
```

Reihenfolge ist kritisch: `authenticate` muss zuerst laufen, damit `request.user` für `requireRole` verfügbar ist.

Alternativ auf einzelne Routen:

```typescript
fastify.get('/admin/stats', {
  preHandler: [fastify.authenticate, fastify.requireRole('ADMIN', 'MODERATOR')],
}, handler);
```

---

## Test-Bypass

`POST /auth/test-login` ist nur aktiv wenn `NODE_ENV === 'test'`. In dev/prod gibt es 403 zurück.

Body: `{ userId: string }` — sucht User in DB, signiert Cookie, antwortet mit `{ ok: true, user }`.

Genutzt von E2E-Test-Helpers (`signInRequest` / `signInBrowser`) im E2E-Paket.

---

## Frontend-Auth-State

Quelle: `apps/frontend/src/lib/auth.ts`

| Hook | Verhalten |
|---|---|
| `useAuthQuery()` | `useQuery({ queryKey: ['me'], queryFn: getMe, retry: false, staleTime: 5 * 60 * 1000 })` — 5 Minuten stale, kein Retry bei Fehler. |
| `useLogout()` | Mutation → `logout()` → `queryClient.setQueryData(['me'], null)` → Navigate zu `/login`. |
| `useRequireAuth()` | Ruft `useAuthQuery()` auf, navigiert bei `error.status === 401` zu `/login`. Gibt die Query zurück. |

`getMe` und `logout` kommen aus `./api` und sprechen den Backend-Endpunkt `/auth/me` bzw. `POST /auth/logout` an.

---

## Rollen-System

Enum `Role` in `packages/db/prisma/schema.prisma`:

```
enum Role {
  USER
  ORGANIZER
  MODERATOR
  ADMIN
}
```

`requireRole('ADMIN', 'MODERATOR')` akzeptiert mehrere Rollen — der User muss eine davon haben.

**Rollen-Cache-Invalidierung:** Nach einer Rollen-Änderung (z.B. `PATCH /api/users/:id/role`) oder einem Ban muss der Cache-Eintrag explizit gelöscht werden:

```typescript
await invalidate(fastify.redis, `user:role:${userId}`);
```

Da der Key kein Wildcard enthält, ist hier auch `fastify.redis.del(`user:role:${userId}`)` direkt akzeptabel. Wichtig ist, dass es passiert — sonst sieht der User bis zu 60s lang seine alte Rolle.
