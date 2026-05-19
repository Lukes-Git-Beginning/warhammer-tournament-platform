> Read-when: Auth-Setup, neuer Route-Handler braucht Login/Rolle, Discord-OAuth, Frontend-Auth-State.

**TL;DR**
- Discord OAuth2 → JWT wird in einem HTTP-Only-Cookie gesetzt (Cookie-Name standardmäßig `auth_token`).
- `fastify.authenticate` als `preHandler` verifiziert das JWT und schreibt `request.user: JwtPayload`.
- `fastify.requireRole(...roles)` prüft die DB-Rolle via Redis-Cache (`user:role:<id>`, TTL 60s) mit DB-Fallback.
- **Welle 2:** Steam-OpenID-2.0-Hard-Gate nach Discord-Login. `fastify.requireSteamLink` Dekorator + Frontend-Hook `useRequireSteamLink()` zwingen User auf `/connect-steam` falls `SteamLink == null`.

---

## Discord-OAuth2-Flow

Quellen: `apps/backend/src/routes/auth.ts`, `apps/backend/src/plugins/auth.ts`

1. **Browser → `GET /auth/discord`** — `@fastify/oauth2` leitet direkt zu Discord weiter (`startRedirectPath: '/auth/discord'`). Scopes: `identify email` (konfigurierbar via `DISCORD_SCOPES`).
2. **Discord → `GET /auth/discord/callback`** — Token-Exchange via `fastify.discordOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)`. Danach `fetch('https://discord.com/api/users/@me')` mit dem Access-Token.
3. **Backend: `prisma.user.upsert({ where: { discord_id } })`** — Legt neuen User an oder aktualisiert `username`, `email`, `avatar_url`, `last_login`. Gibt `id`, `discord_id`, `username`, `role` zurück.
4. **Backend: `fastify.signAuthCookie(reply, payload)`** — Signiert JWT mit `JWT_SECRET`, setzt HTTP-Only-Cookie. Anschließend Hard-Gate-Routing: wenn `user.steam_link == null` → Redirect zu `${FRONTEND_URL}/connect-steam`, sonst zu `FRONTEND_URL`. Damit greift der Steam-Gate **vor** dem Frontend-Guard und der User landet nie auf `/` ohne Steam-Link (siehe §Steam-OpenID-2.0 Hard-Gate).

---

## JWT-Payload-Shape

Typ `JwtPayload` aus `@rizzotto/types`, befüllt in `routes/auth.ts`:

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
| `fastify.requireSteamLink` | `(request, reply) => Promise<void>` | **Welle 2** — preHandler — lädt `SteamLink` für `request.user.sub`, 403 `{ code: 'STEAM_REQUIRED' }` falls null. Whitelist: `/auth/*`, `/api/users/me`. Selektiv auf Tournament-/Match-Routes anzuwenden. |
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

`getMe` ruft `GET /api/users/me`, `logout` ruft `POST /auth/logout`. Beide laufen über `apiFetch` — dieser setzt seit 2026-05-19 den `Content-Type: application/json`-Header **nur, wenn ein Body mitgeschickt wird**, sonst wirft Fastify auf bodyless POSTs `FST_ERR_CTP_EMPTY_JSON_BODY`.

`/api/users/me` liefert `UserMe` inklusive `steam_link: SteamLink | null` — das Feld ist in `meSelect` (`apps/backend/src/routes/users.ts`) included und in `serializeMe` von Prisma-Namen (`persona`, `verified_at`) auf Zod-Schema-Namen (`steam_username`, `linked_at`) gemapped.

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

---

## Steam-OpenID-2.0 Hard-Gate (Welle 2)

Alex-Spec: jeder User muss nach Discord-Login zwingend einen Steam-Account verlinken (Anti-Ban-Evade + Vorbereitung für Arena-Queue-Skip-Verifikation).

### Flow

1. **Discord-Login** wie bisher → JWT-Cookie gesetzt, `/api/users/me` liefert `steam_link: SteamLink | null`. Der Discord-Callback **redirected schon serverseitig auf `/connect-steam`** wenn der User keinen SteamLink hat — der Frontend-Guard ist nur Fallback für Navigation innerhalb der App.
2. **Frontend** (`apps/frontend/src/routes/__root.tsx`) ruft `useRequireSteamLink()` global auf. Bei `steam_link == null` und non-whitelisted Pfad → Redirect auf `/connect-steam?return_to=<current>`.
3. **`SteamConnectPage`** zeigt CTA "Connect Steam" → `window.location = '/auth/steam/login?return_to=…'`.
4. **`GET /auth/steam/login`** (in `apps/backend/src/routes/auth.ts`) konstruiert OpenID-2.0-Redirect zu `https://steamcommunity.com/openid/login` mit `openid.mode=checkid_setup`.
5. **Steam → `GET /auth/steam/return`** mit OpenID-Params. Backend ruft `check_authentication`-Mode gegen Steam-Endpoint zur Verify-Signature-Prüfung. Extract `steamId` aus `claimed_id` (Format `https://steamcommunity.com/openid/id/76561198XXXXXXXXX`).
6. **Optional** Steam-Web-API für Persona-Daten: `api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=$STEAM_WEB_API_KEY&steamids=…`. Skipped wenn ENV-Var fehlt.
7. **Upsert `SteamLink`** mit `(user_id, steam_id, persona, avatar_url, profile_url, verified_at)`. Redirect zurück auf `return_to` oder `/`.

### Backend-Endpoints

| Endpoint | Beschreibung |
|---|---|
| `GET /auth/steam/login?return_to=…` | OpenID-2.0-Init, redirect zu Steam |
| `GET /auth/steam/return` | RP-Verify, persistiert `SteamLink`, redirect |

### Frontend-Hook

`useRequireSteamLink()` in `apps/frontend/src/lib/auth.ts`:
- Whitelist: `/`, `/connect-steam`, `/auth/*`, `/login`
- Bei `user.steam_link == null` + non-whitelisted Pfad → `navigate({ to: '/connect-steam', search: { return_to: location.href } })`
- **Wichtig:** `location.href` (string, pathname+search+hash). Niemals `location.search` direkt konkatenieren — das ist in TanStack Router ein parsed Object und triggert `TypeError: Cannot convert object to primitive value`.
- Aktiviert global in `__root.tsx`

### ENV-Vars

- `STEAM_OPENID_RETURN_URL` — Absolute URL z.B. `http://localhost:3000/auth/steam/return`
- `STEAM_WEB_API_KEY` — Optional, für Persona-Daten
