# TWW3 Frontend

Vite 6 + React 19 + TanStack Router (code-based) + TanStack Query 5 + Tailwind 4 CSS-first.
Entry-Point `src/main.tsx`, Router-Definition in `src/router.tsx`, CSS-Einstieg in `src/app.css`.

## Commands

```bash
pnpm -F @rizzotto/frontend dev          # Dev-Server auf Port 5173
pnpm -F @rizzotto/frontend build        # tsc -b && vite build
pnpm -F @rizzotto/frontend test         # vitest run
pnpm -F @rizzotto/frontend typecheck    # tsc -b --noEmit
```

## Vite-Proxy

Alle Requests → `http://localhost:3000` (Fastify-Backend):

| Pfad | WebSocket |
|------|-----------|
| `/api` | nein |
| `/auth` | nein |
| `/socket.io` | ja |

`@`-Alias → `src/`. Dev-Port: **5173**.

## Konventionen

- **API-Calls** ausschließlich über `apiFetch<T>()` aus `src/lib/api.ts` — fügt `credentials: 'include'` hinzu, wirft `ApiError` auf Non-2xx.
- **Query-Keys** nach Schema `[domain, ...params]`, z. B. `['tournament', slug]`, `['leaderboard', seasonId, page]`. Vollständige Tabelle in `.knowledge/frontend-patterns.md`.
- **Tailwind 4 CSS-first** — kein `tailwind.config.js`. Konfiguration direkt in `src/app.css`.
- **Code-based Router** — neue Routes in `src/router.tsx` mit `createRoute()` registrieren und dem `routeTree` hinzufügen. Keine automatische File-Konvention.
- **Auth-Guard** via `useRequireAuth()` aus `src/lib/auth.ts` — leitet bei 401 automatisch auf `/login`.
- **Socket-Hooks** (`useDraftSocket`, `useLiveBracket`) aus `src/hooks/` — nie `getSocket()` direkt in Komponenten.

## Verweise

- `.knowledge/frontend-patterns.md` — vollständige Route-Tabelle, Query-Key-Konventionen, Component-Struktur, API-Layer
- `.knowledge/realtime.md` — Socket.IO-Hooks und Server-Events
- `.knowledge/auth.md` — Discord-OAuth-Flow, Frontend-Auth-Hooks (`useAuthQuery`, `useLogout`, `useRequireAuth`)
- `.knowledge/types-contracts.md` — `@rizzotto/types`-DTOs und Shared-Typen
