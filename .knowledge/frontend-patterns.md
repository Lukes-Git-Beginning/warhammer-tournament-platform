> Read-when: neue Route hinzufügen, API-Hook erstellen, Component-Pfad finden, Vite-Proxy-Config-Check.

**TL;DR:**

- Vite 6 + React 19 + TanStack Router (code-based) + TanStack Query 5 + Tailwind 4 CSS-first.
- Alle API-Calls laufen über `apiFetch<T>()` aus `src/lib/api.ts` — kein direktes `fetch()` in Komponenten.
- Routes werden manuell in `src/router.tsx` registriert; kein File-based Routing.

---

## Vite-Config

Datei: `apps/frontend/vite.config.ts`

```typescript
plugins: [react(), tailwindcss()]   // @tailwindcss/vite ^4.0.0
resolve.alias: { '@': path.resolve(__dirname, './src') }
server.port: 5173
```

**Proxy-Regeln** (alle mit `changeOrigin: true` → `http://localhost:3000`):

| Pfad         | WebSocket       |
| ------------ | --------------- |
| `/api`       | nein            |
| `/auth`      | nein            |
| `/socket.io` | ja (`ws: true`) |

---

## Provider-Setup

Datei: `apps/frontend/src/main.tsx`

```tsx
<StrictMode>
  <QueryClientProvider client={queryClient}>
    {' '}
    // retry: false als default
    <RouterProvider router={router} />
  </QueryClientProvider>
</StrictMode>
```

CSS-Import: `import './app.css'` (Tailwind-Einstiegspunkt, kein `tailwind.config.js`).

---

## TanStack Router (code-based)

Datei: `apps/frontend/src/router.tsx`

Root-Route: `rootRoute` aus `src/routes/__root.tsx` (enthält `<Header>` + `<Outlet>`).

```typescript
const fooRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/foo',
  component: FooPage,
});
// → routeTree = rootRoute.addChildren([..., fooRoute])
export const router = createRouter({ routeTree });
```

**Alle registrierten Routes:**

| Pfad                         | Component              | Datei                             |
| ---------------------------- | ---------------------- | --------------------------------- |
| `/`                          | `IndexPage`            | `routes/IndexPage.tsx`            |
| `/login`                     | `LoginPage`            | `routes/LoginPage.tsx`            |
| `/tournaments/create`        | `CreateTournamentPage` | `routes/CreateTournamentPage.tsx` |
| `/tournaments/$slug`         | `TournamentDetail`     | `routes/TournamentDetail.tsx`     |
| `/leaderboard`               | `LeaderboardPage`      | `routes/LeaderboardPage.tsx`      |
| `/users/$id`                 | `UserProfilePage`      | `routes/UserProfilePage.tsx`      |
| `/meta`                      | `MetaDashboard`        | `routes/MetaDashboard.tsx`        |
| `/factions`                  | `FactionListPage`      | `routes/FactionListPage.tsx`      |
| `/factions/$id`              | `FactionDetailPage`    | `routes/FactionDetailPage.tsx`    |
| `/drafts/$id`                | `DraftLobbyPage`       | `routes/DraftLobbyPage.tsx`       |
| `/drafts/$id/spectate`       | `DraftSpectatorPage`   | `routes/DraftSpectatorPage.tsx`   |
| `/presets`                   | `PresetListPage`       | `routes/PresetListPage.tsx`       |
| `/presets/new`               | `PresetEditorPage`     | `routes/PresetEditorPage.tsx`     |
| `/presets/$id/edit`          | `PresetEditorPage`     | `routes/PresetEditorPage.tsx`     |
| `/admin`                     | `AdminPage`            | `routes/AdminPage.tsx`            |
| `/connect-steam`             | `SteamConnectPage`     | `routes/SteamConnectPage.tsx`     |
| `/matches/$matchId`          | `MatchDetailPage`      | `routes/MatchDetailPage.tsx`      |
| `/matches/$matchId/decision` | `MatchDecisionPage`    | `routes/MatchDecisionPage.tsx`    |

---

## API-Layer

Datei: `apps/frontend/src/lib/api.ts`

```typescript
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: HeadersInit = { ...(init?.headers ?? {}) };
  // Only declare a JSON content-type when we actually send a body — Fastify
  // rejects bodyless POSTs with Content-Type: application/json (FST_ERR_CTP_EMPTY_JSON_BODY).
  if (init?.body != null && !(headers as Record<string, string>)['Content-Type']) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { credentials: 'include', ...init, headers });
  if (!res.ok) {
    /* wirft ApiError mit .status */
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
```

- Fügt automatisch `credentials: 'include'` hinzu (Cookie-Auth).
- Wirft `ApiError` (extends `Error`) mit `.status: number` auf Non-2xx.
- HTTP 204 → gibt `undefined` zurück (kein JSON-Parse-Fehler).
- **Content-Type-Header wird nur gesetzt, wenn `init.body` existiert.** Vor 2026-05-19 war der Header unconditionally gesetzt; das brach `POST /auth/logout` und alle anderen bodyless POSTs mit HTTP 400.

**Beispiel in einer Route:**

```typescript
useQuery({
  queryKey: ['leaderboard', seasonId, page],
  queryFn: () =>
    apiFetch<LeaderboardResponse>(`/api/leaderboard?seasonId=${seasonId}&page=${page}`),
});
```

Typen kommen aus `@rizzotto/types` [siehe `.knowledge/types-contracts.md`].

### Datetime-Felder an das Backend senden

HTML `<input type="datetime-local">` emits `"YYYY-MM-DDTHH:mm"` ohne Sekunden und ohne Timezone — `z.string().datetime()` im Backend rejected das mit `invalid_string/datetime`. Pre-Submit konvertieren:

```typescript
const toIsoOrInvalid = (local: string) => {
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? local : d.toISOString();
};

mutation.mutate({
  ...data,
  start_date: toIsoOrInvalid(data.start_date),
  ...(data.registration_deadline
    ? { registration_deadline: toIsoOrInvalid(data.registration_deadline) }
    : {}),
});
```

`new Date(local)` interpretiert den Wert in der Browser-Zeitzone (= dem default-gewählten `timezone` im Form). Wenn Tournament-spezifische Zeitzone vom Browser abweicht, gehört das semantisch in einen separaten Konvertierungs-Schritt — ist heute kein realer Fall.

---

## TanStack Query-Key-Konventionen

Verifiziert gegen `src/routes/*.tsx` und `src/hooks/*.ts`:

| Query-Key                           | Daten                                   |
| ----------------------------------- | --------------------------------------- |
| `['me']`                            | current user (`UserMe`) — Auth-Hook     |
| `['tournaments', page, pageSize]`   | paginierte Tournament-Liste             |
| `['tournament', slug]`              | einzelnes Tournament                    |
| `['bracket', slug]`                 | Bracket-Daten (invalidiert per Socket)  |
| `['leaderboard', seasonId, page]`   | saisonale Leaderboard-Seite             |
| `['leaderboard-all-time', page]`    | saisonübergreifend                      |
| `['seasons']`                       | alle Seasons                            |
| `['factions']`                      | Fraktionsliste                          |
| `['faction', id]`                   | einzelne Fraktion                       |
| `['meta-overview']`                 | Meta-Übersicht                          |
| `['meta-matchups']`                 | Matchup-Heatmap                         |
| `['draft', draftId]`                | Draft-State (`DraftView`)               |
| `['draft', draftId, 'events']`      | Draft-Eventlog                          |
| `['draft', draftId, 'available']`   | verfügbare Fraktionen im laufenden Turn |
| `['draft-presets']`                 | Preset-Liste                            |
| `['draft-preset', id]`              | einzelnes Preset                        |
| `['user-profile', id]`              | User-Profil-Seite                       |
| `['maps']`                          | alle Maps (`MapDto[]`)                  |
| `['match-decision', matchId]`       | Match-Decision-State                    |
| `['army-list-me', slug]`            | eigene Army-Liste im Tournament         |
| `['army-list', slug, userId]`       | Gegner-Army-Liste                       |
| `['army-lists-all', slug]`          | alle Listen (nach Tournament complete)  |
| `['tournament-participants', slug]` | Teilnehmer-Liste inkl. Status           |

---

## Component-Struktur

Verzeichnis: `apps/frontend/src/components/`

**`admin/`**

- `AuditLogTable.tsx` — paginierte Audit-Log-Tabelle
- `StatsDashboard.tsx` — Admin-Statistiken
- `UserBanModal.tsx` / `UserBanTab.tsx` — Ban/Unban-Workflow
- `PresetLibraryAdmin.tsx` — Preset-Verwaltung (promote, delete)

**`bracket/`**

- `BracketView.tsx` — Container mit Zoom via `react-zoom-pan-pinch`
- `SVGBracket.tsx` — SVG-Bracket-Rendering
- `MatchNode.tsx` — einzelner Match im Bracket
- `MatchScoreModal.tsx` — Ergebnis-Eingabe-Modal
- `SwissStandings.tsx` — Swiss-Rangliste
- `computeBracketLayout.ts` — pure Layout-Berechnung (kein React)

**`draft/`**

- `DraftLobby.tsx` — Haupt-Draft-UI
- `DraftTimer.tsx` — Countdown-Anzeige
- `DraftStatusBanner.tsx` — Status-/Phasen-Banner
- `DraftHistory.tsx` — Verlaufsanzeige
- `DraftSequenceTimeline.tsx` — Turn-Sequenz-Visualisierung
- `FactionGrid.tsx` — Fraktions-Auswahlgitter
- `PresetEditor.tsx` — Preset-Formular
- `TurnEditor.tsx` — einzelne Turn-Konfiguration
- `CategoryLimitsEditor.tsx` — Kategorie-Limits-Formular

**`meta/`**

- `EloRatingDisplay.tsx` — Elo-Wert mit Trend
- `FactionBadge.tsx` — Fraktions-Icon + Name
- `MatchupHeatmap.tsx` — Win-Rate-Heatmap

**`tournament/`**

- `TournamentCard.tsx` — Karten-Darstellung in Listen
- `TournamentCreateForm.tsx` — Erstellungsformular (Welle 2: Mode, Rounds, Playoff, MapPool, MatchFormat)
- `ArmyListUpload.tsx` — TXT-Upload-Component (Legacy)
- `ArmyListUploader.tsx` — Drag-Drop SLT-Army-List-Upload (Welle 2: Screenshot + .army_setup)
- `ArmyListList.tsx` — Liste hochgeladener Army-Lists
- `CheckInButton.tsx` — Self-Service Check-in mit Live-Countdown (Welle 2)

**`layout/`**

- `Header.tsx` — globale Navigation

**`auth/`**

- `DiscordLoginButton.tsx` — Discord-OAuth-Button

---

## Hooks

Verzeichnis: `apps/frontend/src/hooks/`

### `useDraftSocket(options)`

```typescript
useDraftSocket({ draftId: string, viewer: 'player' | 'spectator' }): void
```

Joined den Draft-Room via Socket.IO (`join_draft` | `watch_draft`) und hält den
`['draft', draftId]`-Cache in Echtzeit aktuell. Beim Unmount: `leave_draft`.
Details [siehe `.knowledge/realtime.md`].

### `useLiveBracket(tournamentId)`

```typescript
useLiveBracket(tournamentId: string): void
```

Joined `join_tournament`-Room, invalidiert `['bracket']` bei `match_result`-
und `bracket_update`-Events. Beim Unmount: `leave_tournament`.

### `useLiveMatch(matchId, tournamentId?)`

```typescript
useLiveMatch(matchId: string, tournamentId?: string): void
```

Joined `join_tournament`-Room (sobald `tournamentId` bekannt), invalidiert
`['match', matchId]` bei `match_result`/`bracket_update` und zusätzlich
`['match-scoring-breakdown', matchId]` wenn das Event dieses Match betrifft.
Beim Unmount: `leave_tournament`. Genutzt von der `MatchDetailPage` (P1a, 2026-06).

---

## Auth-State

[Siehe `.knowledge/auth.md`] — alle drei Hooks aus `apps/frontend/src/lib/auth.ts`:

- `useAuthQuery()` — lädt `UserMe` (queryKey `['me']`, staleTime 5 min)
- `useLogout()` — POST `/auth/logout`, setzt Cache auf `null`, navigiert zu `/login`
- `useRequireAuth()` — wie `useAuthQuery()`, leitet bei 401 automatisch auf `/login`

---

## Tailwind 4

- Plugin: `@tailwindcss/vite` in `vite.config.ts` — kein `tailwind.config.js`.
- Konfiguration CSS-first in `apps/frontend/src/app.css`.
- `@import "tailwindcss"` direkt im CSS, Utilities inline via `@layer`.

---

## Neue Route hinzufügen — Checkliste

1. Component-Datei anlegen: `apps/frontend/src/routes/FooPage.tsx`
2. In `apps/frontend/src/router.tsx` registrieren:

   ```typescript
   import { FooPage } from './routes/FooPage';

   const fooRoute = createRoute({
     getParentRoute: () => rootRoute,
     path: '/foo',
     component: FooPage,
   });
   ```

3. Route dem `routeTree` hinzufügen:
   ```typescript
   const routeTree = rootRoute.addChildren([
     // ...bestehende Routes...
     fooRoute,
   ]);
   ```
4. Falls API-Daten nötig:
   - Fetch-Funktion in `apps/frontend/src/lib/api.ts` ergänzen (via `apiFetch<T>`)
   - In der Route mit `useQuery({ queryKey: ['foo', id], queryFn: ... })` konsumieren
   - Query-Key-Konvention: `[domain, ...params]`
