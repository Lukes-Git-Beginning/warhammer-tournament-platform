> Read-when: Auth-Setup, neuer Route-Handler braucht Login/Rolle, Discord-OAuth, Frontend-Auth-State.

**TL;DR**

- Discord OAuth2 → JWT wird in einem HTTP-Only-Cookie gesetzt (Cookie-Name standardmäßig `auth_token`).
- `fastify.authenticate` als `preHandler` verifiziert das JWT und schreibt `request.user: JwtPayload`.
- `fastify.requireRole(...roles)` prüft die DB-Rolle via Redis-Cache (`user:role:<id>`, TTL 60s) mit DB-Fallback.
- **Welle 2:** Steam-OpenID-2.0-Hard-Gate nach Discord-Login. `fastify.requireSteamLink` Dekorator + Frontend-Hook `useRequireSteamLink()` zwingen User auf `/connect-steam` falls `SteamLink == null`.

---

## Discord-OAuth2-Flow

Quellen: `apps/backend/src/routes/auth.ts`, `apps/backend/src/plugins/auth.ts`

1. **Browser → `GET /auth/discord`** — `@fastify/oauth2` leitet direkt zu Discord weiter (`startRedirectPath: '/auth/discord'`). Scopes: `identify email guilds.join` (konfigurierbar via `DISCORD_SCOPES`; `guilds.join` seit 2026-06-19 ergänzt).
2. **Discord → `GET /auth/discord/callback`** — Token-Exchange via `fastify.discordOAuth2.getAccessTokenFromAuthorizationCodeFlow(request)`. Danach `fetch('https://discord.com/api/users/@me')` mit dem Access-Token.
3. **Backend: `prisma.user.upsert({ where: { discord_id } })`** — Legt neuen User an oder aktualisiert `username`, `email`, `avatar_url`, `last_login`. Gibt `id`, `discord_id`, `username`, `role` zurück.
4. **Discord Guild Auto-Join (2026-06-19):** Fire-and-forget nach dem `upsert`. Prüft via `GET /guilds/{DISCORD_GUILD_ID}/members/{discord_id}` (Bot-Token) ob User Mitglied ist. Wenn 404 → `PUT /guilds/{id}/members/{discord_id}` mit `access_token` des Users (`guilds.join`-Scope). Braucht `DISCORD_GUILD_ID` in ENV. Non-fatal: Fehler werden nur geloggt. Bot braucht Manage-Members-Permission im Server.
5. **Backend: `fastify.signAuthCookie(reply, payload)`** — Signiert JWT mit `JWT_SECRET`, setzt HTTP-Only-Cookie. Anschließend Hard-Gate-Routing: wenn `user.steam_link == null` → Redirect zu `${FRONTEND_URL}/connect-steam`, sonst zu `FRONTEND_URL`. Damit greift der Steam-Gate **vor** dem Frontend-Guard und der User landet nie auf `/` ohne Steam-Link (siehe §Steam-OpenID-2.0 Hard-Gate).

---

## JWT-Payload-Shape

Typ `JwtPayload` aus `@rizzotto/types`, befüllt in `routes/auth.ts`:

```typescript
const payload: JwtPayload = {
  sub: user.id, // UUID des DB-Users
  discord_id: user.discord_id, // Discord Snowflake (string)
  username: user.username, // global_name ?? username von Discord
  role: user.role as Role,
};
```

`request.user` nach `fastify.authenticate` enthält genau diese Felder.

---

## Cookie-Config

Gesetzt in `plugins/auth.ts` → `signAuthCookie`:

| Feld       | Wert                                                              |
| ---------- | ----------------------------------------------------------------- |
| Name       | `process.env.JWT_COOKIE_NAME ?? 'auth_token'`                     |
| `httpOnly` | `true`                                                            |
| `sameSite` | `'lax'`                                                           |
| `secure`   | `true` in Production, `false` sonst                               |
| `domain`   | `process.env.JWT_COOKIE_DOMAIN ?? 'localhost'`                    |
| `maxAge`   | `process.env.JWT_EXPIRES_IN ?? 604800` (Sekunden, default 7 Tage) |
| `path`     | `'/'`                                                             |

`clearAuthCookie` löscht den Cookie mit gleichem `path` und `domain`.

---

## Backend-Dekoratoren

Alle registriert in `apps/backend/src/plugins/auth.ts` via `fastify.decorate(...)`:

| Dekorator                       | Signatur                                                  | Zweck                                                                                                                                                                                                     |
| ------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fastify.authenticate`          | `(request, reply) => Promise<void>`                       | preHandler — verifiziert JWT via `request.jwtVerify()`, schreibt `request.user`. 401 bei ungültigem/fehlendem Token.                                                                                      |
| `fastify.requireRole(...roles)` | `(...roles: Role[]) => (request, reply) => Promise<void>` | preHandler-Factory — prüft `request.user.sub` gegen Redis-Cache (`user:role:<id>`, TTL 60s), DB-Fallback. 403 bei falscher Rolle.                                                                         |
| `fastify.requireSteamLink`      | `(request, reply) => Promise<void>`                       | **Welle 2** — preHandler — lädt `SteamLink` für `request.user.sub`, 403 `{ code: 'STEAM_REQUIRED' }` falls null. Whitelist: `/auth/*`, `/api/users/me`. Selektiv auf Tournament-/Match-Routes anzuwenden. |
| `fastify.signAuthCookie`        | `(reply, payload: JwtPayload) => void`                    | JWT signieren + Cookie setzen.                                                                                                                                                                            |
| `fastify.clearAuthCookie`       | `(reply) => void`                                         | Cookie löschen (Logout).                                                                                                                                                                                  |

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
fastify.get(
  '/admin/stats',
  {
    preHandler: [fastify.authenticate, fastify.requireRole('ADMIN', 'MODERATOR')],
  },
  handler,
);
```

---

## Test-Bypass

`POST /auth/test-login` ist nur aktiv wenn `NODE_ENV === 'test'`. In dev/prod gibt es 403 zurück.

Body: `{ userId: string }` — sucht User in DB, signiert Cookie, antwortet mit `{ ok: true, user }`.

Genutzt von E2E-Test-Helpers (`signInRequest` / `signInBrowser`) im E2E-Paket.

---

## Frontend-Auth-State

Quelle: `apps/frontend/src/lib/auth.ts`

| Hook               | Verhalten                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `useAuthQuery()`   | `useQuery({ queryKey: ['me'], queryFn: getMe, retry: false, staleTime: 5 * 60 * 1000 })` — 5 Minuten stale, kein Retry bei Fehler. |
| `useLogout()`      | Mutation → `logout()` → `queryClient.setQueryData(['me'], null)` → Navigate zu `/login`.                                           |
| `useRequireAuth()` | Ruft `useAuthQuery()` auf, navigiert bei `error.status === 401` zu `/login`. Gibt die Query zurück.                                |

`getMe` ruft `GET /api/users/me`, `logout` ruft `POST /auth/logout`. Beide laufen über `apiFetch` — dieser setzt seit 2026-05-19 den `Content-Type: application/json`-Header **nur, wenn ein Body mitgeschickt wird**, sonst wirft Fastify auf bodyless POSTs `FST_ERR_CTP_EMPTY_JSON_BODY`.

`/api/users/me` liefert `UserMe` inklusive `steam_link: SteamLink | null` — das Feld ist in `meSelect` (`apps/backend/src/routes/users.ts`) included und in `serializeMe` von Prisma-Namen (`persona`, `verified_at`) auf Zod-Schema-Namen (`steam_username`, `linked_at`) gemapped.

---

## Rollen-System

Enum `Role` in `packages/db/prisma/schema.prisma`:

```
enum Role {
  USER
  HOST
  MODERATOR
  ADMIN
}
```

**2026-06-21:** `ORGANIZER`-Rolle vollständig entfernt. Migration `20260621000000_remove_organizer_role` entfernt den Enum-Wert aus Postgres (alle ORGANIZER-Accounts waren bereits per Migration `20260612120000` zu HOST konvertiert). `HOST` ist der Ersatz für ORGANIZER — Rolle für Turnier-Ersteller.

**canManage-Muster** (Frontend + Backend, überall konsistent):
```typescript
const isOwner = tournament.organizer_id === userId;
const isModOrAdmin = role === 'MODERATOR' || role === 'ADMIN';
const canManage = isOwner || isModOrAdmin;
```
`HOST` bekommt canManage nur für Turniere die sie selbst erstellt haben (`organizer_id`-Check). MODERATOR + ADMIN haben immer canManage.

`requireRole('ADMIN', 'MODERATOR')` akzeptiert mehrere Rollen — der User muss eine davon haben.

**Rollen-Cache-Invalidierung:** Nach einer Rollen-Änderung (z.B. `PATCH /api/users/:id/role`) oder einem Ban muss der Cache-Eintrag explizit gelöscht werden:

```typescript
await invalidate(fastify.redis, `user:role:${userId}`);
```

Da der Key kein Wildcard enthält, ist hier auch `fastify.redis.del(`user:role:${userId}`)` direkt akzeptabel. Wichtig ist, dass es passiert — sonst sieht der User bis zu 60s lang seine alte Rolle.

---

## Admin-Promotion (Operations, kein UI)

Es gibt **keine** Frontend-UI zum Setzen von Rollen und **kein** CLI-Script im Repo. `PATCH /api/users/:id/role` ist Admin-only, eignet sich also nicht für den Bootstrap des ersten Admins.

**Workflow auf Production** (Hetzner-Host via SSH, Postgres + Redis als Docker-Container):

```bash
# 1. Lookup — User-UUID + aktuelle Role finden
ssh deploy@<DEPLOY_HOST> "docker exec -i rizzotto-postgres psql -U rizzotto -d rizzotto -P pager=off <<'SQL'
SELECT id, discord_id, username, role FROM \"User\"
WHERE username ILIKE '%<suchbegriff>%' AND deleted_at IS NULL;
SQL"

# 2. UPDATE + AuditLog + Redis-DEL (atomisch in einer SSH-Session)
ssh deploy@<DEPLOY_HOST> "docker exec -i rizzotto-postgres psql -U rizzotto -d rizzotto -P pager=off <<'SQL'
BEGIN;
UPDATE \"User\" SET role = 'ADMIN' WHERE id = '<user-uuid>' AND role = 'USER';
INSERT INTO \"AuditLog\" (id, entity_type, entity_id, action, actor_id, new_value)
VALUES (gen_random_uuid(), 'User', '<user-uuid>', 'role_update',
        '<actor-uuid-or-NULL>', '{\"role\":\"ADMIN\"}'::jsonb);
COMMIT;
SQL
docker exec rizzotto-redis redis-cli DEL 'user:role:<user-uuid>'"
```

Notes:

- `username` in der DB ist `profile.global_name ?? profile.username` (auth.ts) — Discord-Handle und gespeicherter Name können abweichen, also breit per `ILIKE` suchen, nicht exakt.
- `WHERE role = 'USER'` in Schritt 1 ist eine Schutz-Bremse — bei unerwartetem Ausgangszustand kommt `UPDATE 0` zurück, statt blind zu überschreiben.
- `actor_id` kann `NULL` sein (Schema erlaubt das für System-Aktionen), schöner ist aber die UUID des promotenden Admins.
- Redis-DEL gibt `0` zurück wenn der Key gar nicht existiert (User hat keine aktive Session) — kein Fehler.

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

| Endpoint                            | Beschreibung                                 |
| ----------------------------------- | -------------------------------------------- |
| `GET /auth/steam/login?return_to=…` | OpenID-2.0-Init, redirect zu Steam           |
| `GET /auth/steam/return`            | RP-Verify, persistiert `SteamLink`, redirect |

### Frontend-Hook

`useRequireSteamLink()` in `apps/frontend/src/lib/auth.ts`:

- Whitelist: `/`, `/connect-steam`, `/auth/*`, `/login`
- Bei `user.steam_link == null` + non-whitelisted Pfad → `navigate({ to: '/connect-steam', search: { return_to: location.href } })`
- **Wichtig:** `location.href` (string, pathname+search+hash). Niemals `location.search` direkt konkatenieren — das ist in TanStack Router ein parsed Object und triggert `TypeError: Cannot convert object to primitive value`.
- Aktiviert global in `__root.tsx`

### ENV-Vars

- `STEAM_OPENID_RETURN_URL` — Absolute URL z.B. `http://localhost:3000/auth/steam/return`
- `STEAM_WEB_API_KEY` — Optional, für Persona-Daten
