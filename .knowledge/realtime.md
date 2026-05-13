> Read-when: Socket.IO-Setup, neuer Realtime-Event, Frontend-Subscribe, Room-Logik.

## TL;DR

- Socket.IO wird direkt an `fastify.server` gehängt (kein `fastify-socket.io`-Plugin — Fastify-4-only!), Redis-Adapter via `redisPub`/`redisSub`.
- Auth per Middleware: JWT aus Cookie → `socket.data.userId / username`; kein Token = Verbindung abgelehnt.
- Zwei Event-Ebenen: Tournament-Rooms (`tournament_<id>`) für Bracket/Match und Draft-Rooms (`draft_<id>`, `draft_<id>:player_<userId>`, `draft_<id>:spec`) mit Hidden-Masking pro Zielgruppe.

---

## Backend-Setup

`apps/backend/src/plugins/socket.ts` — registriert als Fastify-Plugin, Dependency `['auth', 'redis', 'draft']`.

```typescript
const io: AppIOServer = new IOServer(fastify.server, {
  cors: { origin: frontendUrl, credentials: true },
  transports: ['websocket', 'polling'],
});
io.adapter(createAdapter(fastify.redisPub, fastify.redisSub));
fastify.decorate('io', io);
```

`AppIOServer` ist ein typisierter Alias über alle vier generischen Interfaces aus `@tww3/types` (`ClientToServerEvents`, `ServerToClientEvents`, `InterServerEvents`, `SocketData`). [siehe `.knowledge/caching.md`] für `redisPub`/`redisSub`.

---

## Auth-Middleware

```typescript
io.use((socket, next) => {
  const raw = socket.handshake.headers.cookie ?? '';
  const cookies = parseCookie(raw);
  const token = cookies[cookieName]; // JWT_COOKIE_NAME env, default 'auth_token'
  if (!token) return next(new Error('no auth cookie'));

  const payload = fastify.jwt.verify<JwtPayload>(token);
  socket.data.userId = payload.sub;
  socket.data.username = payload.username;
  return next();
});
```

Fehlschlag = `next(new Error(...))` → Verbindung wird vom Client abgelehnt. [siehe `.knowledge/auth.md`] für Cookie-Setup.

---

## Rooms

| Room                           | Beitreten via       | Wer                          | Sieht Hidden-Daten? |
|-------------------------------|---------------------|------------------------------|---------------------|
| `tournament_<id>`             | `join_tournament`   | Alle eingeloggten User       | —                   |
| `draft_<id>`                  | `join_draft`        | Host, Guest, Admin           | Ja (eigene Seite)   |
| `draft_<id>:player_<userId>`  | auto via `join_draft` | Nur dieser Player           | Nur eigene          |
| `draft_<id>:spec`             | `watch_draft` oder automatisch bei unbekannter Rolle | Zuschauer | Nein (alles maskiert) |

Room-Hilfsfunktionen in `apps/backend/src/lib/draft-emit.ts`: `draftRoom()`, `draftPlayerRoom()`, `draftSpectatorRoom()`.

---

## Client→Server Events

Definiert in `packages/types/src/socket-events.ts` — Interface `ClientToServerEvents`.

| Event            | Payload                              | Effekt                                      |
|-----------------|--------------------------------------|---------------------------------------------|
| `join_tournament` | `tournamentId: string`             | Socket joinet `tournament_<id>`             |
| `leave_tournament` | `tournamentId: string`            | Socket leavet `tournament_<id>`             |
| `join_draft`     | `draftId: string`                    | Joinet Player-Room (oder Spec-Room bei unbekannter Rolle), sendet `draft_state_sync` zurück |
| `leave_draft`    | `draftId: string`                    | Leavet alle drei Draft-Rooms dieses Drafts  |
| `watch_draft`    | `draftId: string`                    | Joinet `draft_<id>:spec`, sendet `draft_state_sync` (maskiert) |
| `draft_action`   | `{ draftId: string; factionId: string }` | Ruft `draftService.handleAction()` auf  |

---

## Server→Client Events

Definiert in `packages/types/src/socket-events.ts` — Interface `ServerToClientEvents`. Payload-Details: [siehe `.knowledge/types-contracts.md`].

| Event                      | Room(s)                                    | Beschreibung                          |
|---------------------------|---------------------------------------------|---------------------------------------|
| `bracket_update`          | `tournament_<id>`                           | Bracket hat sich geändert (refetch)   |
| `match_result`            | `tournament_<id>`                           | Match-Ergebnis mit Score & nextMatchId |
| `tournament_status_change` | `tournament_<id>`                          | Status-Transition des Turniers        |
| `participant_change`      | `tournament_<id>`                           | Anmeldung/Rückzug/Check-in/DQ        |
| `draft_started`           | alle Draft-Rooms                            | Draft beginnt, enthält Timer-Sekunden |
| `turn_started`            | `draft_<id>`                                | Neuer Zug, enthält `availableFactions` |
| `action_committed`        | Player-Rooms (Hidden-Masking) + Spec-Room   | Aktion committed; `factionId: null` wenn versteckt |
| `draft_state_sync`        | per Socket (on-connect) oder gezielt        | Vollständiger Snapshot des Draft-State |
| `draft_complete`          | `draft_<id>` + `draft_<id>:spec`            | Draft beendet, `finalFactions`        |

---

## Emit-Helpers (Backend)

### `apps/backend/src/lib/emit.ts` — Tournament-Events

```typescript
emitBracketUpdate(io, tournamentId)
emitMatchResult(io, payload)          // payload enthält tournamentId
emitStatusChange(io, payload)
emitParticipantChange(io, payload)
tournamentRoom(tournamentId)          // → 'tournament_<id>'
```

### `apps/backend/src/lib/draft-emit.ts` — Draft-Events

```typescript
emitDraftStarted(io, draftId, hostUserId, guestUserId, payload)
emitTurnStarted(io, draftId, payload)
emitActionCommitted(io, draftId, hostUserId, guestUserId, payloadBase, factionId, isHidden, actorRole)
emitDraftStateSync(io, target, payload)   // target = Room-Name oder socket.id
emitDraftComplete(io, draftId, payload)
maskStateForViewer(state, viewer)         // 'host' | 'guest' | 'spectator'
```

`emitActionCommitted` übernimmt das Hidden-Masking: Der Aktor sieht seine `factionId`, der Gegner und Zuschauer sehen `null`.

---

## Frontend-Client

`apps/frontend/src/lib/socket.ts` — Singleton-Pattern:

```typescript
export function getSocket(): AppSocket {
  if (!socketInstance) {
    socketInstance = io({
      path: '/socket.io',
      withCredentials: true, // Cookie wird mitgeschickt
      autoConnect: false,    // explizit verbinden per socket.connect()
    });
  }
  return socketInstance;
}
```

Cookie (`auth_token`) wird via `withCredentials: true` automatisch gesendet. Auto-Reconnect ist aktiv (Socket.IO-Default).

---

## Frontend-Hooks

### `useDraftSocket({ draftId, viewer })` — `apps/frontend/src/hooks/useDraftSocket.ts`

- `viewer === 'spectator'` → emittiert `watch_draft`; sonst `join_draft`.
- Abonniert: `draft_state_sync` (setzt TanStack-Query-Cache direkt), `turn_started` (setzt Cache), `action_committed` (invalidiert Query), `draft_complete` (invalidiert Query).
- Cleanup: `leave_draft` + `socket.off(...)`.
- Hilfsfunktion `sendDraftAction(draftId, factionId)` — Fire-and-forget für Button-Handler.

### `useLiveBracket(tournamentId)` — `apps/frontend/src/hooks/useLiveBracket.ts`

- Emittiert `join_tournament`, subscribed `match_result` und `bracket_update`.
- Beide Events invalidieren `['bracket']` in TanStack Query (Server ist Source of Truth).
- Cleanup: `leave_tournament` + `socket.off(...)`.

---

## Neuen Event hinzufügen — Checkliste

1. **`packages/types/src/socket-events.ts`** — Event zur `ServerToClientEvents`- oder `ClientToServerEvents`-Interface hinzufügen.
2. **`apps/backend/src/lib/emit.ts`** (oder `draft-emit.ts`) — typierten Emit-Helper schreiben.
3. **Backend-Producer** — Helper aufrufen (z.B. in Route-Handler oder Service nach DB-Write).
4. **Frontend-Hook** — im `useEffect` mit `socket.on('event_name', handler)` subscriben, im Cleanup `socket.off(...)` aufrufen.

---

## Gotcha — kein `fastify-socket.io`-Plugin

`fastify-socket.io` unterstützt nur Fastify 4 — **nicht** Fastify 5. Deshalb wird Socket.IO direkt an `fastify.server` (den nativen Node.js-`http.Server`) gehängt. Das ist kein Workaround, sondern die korrekte Vorgehensweise für Fastify 5. [siehe Memory-Eintrag `reference_fastify_socketio.md`]
