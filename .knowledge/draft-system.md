> Read-when: Draft-State-Logik anfassen, neuer Action-Type, Timer-Verhalten, Redis-Lock-Frage, Spectator-Maskierung.

## TL;DR

- Die State-Machine ist **pure** in `lib/draft-state.ts` (kein I/O, keine Infrastruktur-Imports); der `DraftService` in `lib/draft-service.ts` ist der I/O-Wrapper (Prisma + Redis + Socket).
- **Hybrid-State-Store**: Redis-Hash `draft:<id>:state` als hot state für aktive Drafts, `Draft.state` (Prisma JSON) als persistente Source-of-Truth; jede `commitAndAdvance`-Transaktion schreibt beide.
- Spectators erhalten in `draft_<id>:spec` nur maskierte Picks — `hidden_picks`/`hidden_bans` des Gegners werden bis zur Reveal-Phase als `'?'`-Platzhalter geliefert.

---

## Architektur — Trennung pure/IO

### `lib/draft-state.ts` — Pure State-Machine

Kein einziger `prisma`/`redis`/`io`-Import. Alle Funktionen sind rein und testbar ohne laufende Infrastruktur.

```typescript
// Hauptfunktionen (keine I/O-Side-Effects)
emptyState(): DraftState
getAvailableFactions(state, turn, ctx, perspective): string[]
validateAction(state, turn, factionId, actor, ctx): { ok: true } | { ok: false; reason: string }
applyAction(state, turn, factionId, actor): DraftState
submitParallel(state, actor, factionId): DraftState
isParallelComplete(state): boolean
commitParallel(state, turn): DraftState
isDraftComplete(state, turns, currentTurn): boolean
computeFinalFactions(state): { host: string[]; guest: string[] }
generateSnipeReplacementTurn(snipedActor, orderHint): DraftTurn
```

`ApplyContext` entkoppelt die Engine von DB/Redis — der Aufrufer liefert `allFactions` und `categoryLimits`.

### `lib/draft-service.ts` — I/O-Layer

`DraftService`-Klasse hält `prisma`, `redis`, `io`. Ruft `draft-state.ts`-Funktionen auf und orchestriert danach Persistence, Timer und Socket-Emit.

### `plugins/draft.ts` — Fastify-Integration

Erzeugt den `DraftService`-Singleton, dekoriert `fastify.draftService`. Im `onReady`-Hook wird `initActiveDrafts()` aufgerufen (Rehydrierung aktiver Drafts nach Server-Restart). Im `onClose`-Hook wird `shutdown()` gerufen (Timer-Cleanup).

```typescript
// plugins/draft.ts
fastify.decorate('draftService', service);
fastify.addHook('onReady', async () => { await service.initActiveDrafts(); });
fastify.addHook('onClose', async () => { service.shutdown(); });
```

---

## DraftService — Public API

| Methode | Beschreibung |
|---------|-------------|
| `startDraft(p: StartDraftParams)` | Erstellt `Draft`-Row + erstes `DraftEvent`, schreibt Redis, startet ersten Turn-Timer, emittet `draft_started` + `turn_started`. |
| `handleAction(draftId, userId, factionId)` | Haupt-Einstiegspunkt für Player-Picks/Bans. Acquiret Lock, lädt Snapshot, resolved Actor, validiert + applyed Action, ruft `commitAndAdvance`. |
| `forceAutoSelect(draftId)` | Automatischer Zufalls-Pick bei Timer-Ablauf. Acquiret Lock, wählt zufällige verfügbare Fraktion, ruft `commitAndAdvance` mit `isAutoSelected = true`. |
| `getDraftView(draftId, viewerUserId)` | Gibt maskierten `DraftView` zurück. Viewer-Rolle wird aus `hostUserId`/`guestUserId` abgeleitet; anonyme Viewer sind `spectator`. |
| `cancelDraft(draftId, actorUserId)` | Setzt Status auf `CANCELLED`, schreibt `DraftEvent`, räumt Timer und Redis-Active-Set auf. |
| `initActiveDrafts()` | `onReady`-Aufruf. Lädt alle `ONGOING`-Drafts aus DB, schreibt Redis falls nötig, plant Timer (oder triggert sofort `forceAutoSelect` wenn bereits abgelaufen). |
| `shutdown()` | Räumt alle in-memory `setTimeout`-Handles auf (für graceful shutdown). |

---

## Error-Typen

Alle drei exportierten Custom-Error-Klassen aus `lib/draft-service.ts`:

```typescript
export class BusyError extends Error       // Redis-Lock-Conflict — paralleler commit in progress
export class DraftNotFoundError extends Error  // Draft-ID nicht in Redis/DB
export class InvalidActionError extends Error  // Action gegen aktuelle Phase/Zustand ungültig
```

`BusyError` → HTTP 409 (Client soll retry). `DraftNotFoundError` → 404. `InvalidActionError` → 422/400.

---

## Redis-Lock-Mechanismus

Pro `draftId` ein dedizierter Lock-Key `draft:<id>:lock`:

```typescript
const REDIS_LOCK_KEY = (id: string) => `draft:${id}:lock`;

// Acquire (in handleAction / forceAutoSelect)
const lockAcquired = await this.redis.set(lockKey, '1', 'PX', 5000, 'NX');
if (lockAcquired === null) throw new BusyError(draftId);

try {
  // ... critical section ...
} finally {
  await this.redis.del(lockKey);  // immer freigeben
}
```

Lock-TTL: **5000 ms** (`PX 5000`). Bei Conflict wirft `handleAction` sofort `BusyError` — kein internes Retry. `forceAutoSelect` gibt bei Lock-Conflict still auf (ein anderer Handler erledigt den Turn).

---

## Timer

- **Per-Turn Timer**: Default 30 Sekunden, konfigurierbar als `turn_seconds` im `DraftPreset` (min 5s, max 600s).
- `timer_expires_at` wird bei jedem `commitAndAdvance` neu berechnet und sowohl in `Draft` (Prisma) als auch im Redis-Hash geschrieben.
- Timer laufen als `setTimeout` in `DraftService.timers: Map<string, NodeJS.Timeout>`.
- **Nach Server-Restart**: `initActiveDrafts()` vergleicht `timerExpires` mit `clock()`. Bereits abgelaufene Timer triggern sofort `forceAutoSelect()`; noch laufende Timer werden mit korrekter verbleibender Verzögerung neu geplant.
- Bei Ablauf: `forceAutoSelect(draftId)` → Zufalls-Pick → `commitAndAdvance` → `isAutoSelected: true` in `DraftEvent`.

---

## Hybrid State-Store

```
Redis Hash  draft:<id>:state    ← hot state, schnelle Reads während aktivem Draft
Prisma      Draft.state (JSON)  ← persistente Source-of-Truth, geschrieben bei jedem commitAndAdvance
Prisma      DraftEvent[]        ← append-only Audit-Log aller Actions (Replay/Debug)
```

**Redis-Keys:**

| Key | Inhalt |
|-----|--------|
| `draft:<id>:state` | HSET mit `status`, `current_turn`, `state` (JSON), `timer_expires`, `preset_turns` (JSON), `category_limits` (JSON), `extra_turns` (JSON), `host_user_id`, `guest_user_id`, `turn_seconds` |
| `draft:<id>:lock` | Concurrency-Lock (SET NX PX 5000) |
| `draft:active` | Redis-Set aller aktiven Draft-IDs |

Nach Draft-Abschluss: `draft:active` SREM + `EXPIRE draft:<id>:state 86400` (1 Tag TTL für Nachschau).

Load-Reihenfolge in `loadDraftSnapshot`: Redis zuerst → bei Cache-Miss Fallback auf DB + Write-back zu Redis.

---

## DraftState Shape

Top-Level-Keys des `DraftState` (Details in [`.knowledge/types-contracts.md`]):

```typescript
interface DraftState {
  picks:               { host: string[]; guest: string[] }  // revealed picks
  bans:                string[]                             // global bans (beide Seiten betroffen)
  exclusive_bans:      { host: string[]; guest: string[] }  // nur eine Seite gesperrt
  hidden_picks:        { host: string[]; guest: string[] }  // noch nicht revealt
  hidden_bans:         { host: string[]; guest: string[] }  // noch nicht revealt
  parallel_pending:    { host: string | null; guest: string | null }  // Parallel-Zwischenspeicher
  hidden_pick_variants:{ host: string[]; guest: string[] }  // Variant-Index parallel zu hidden_picks
  hidden_ban_variants: { host: string[]; guest: string[] }  // Variant-Index parallel zu hidden_bans
}
```

---

## DraftPreset Shape

```typescript
interface DraftPreset {
  id:              string          // UUID
  name:            string          // max 120 Zeichen
  description:     string | null
  created_by:      string          // User-UUID
  is_public:       boolean         // false = nur Creator/Admin sichtbar
  turns:           DraftTurn[]     // min 1, max 100
  category_limits: CategoryLimit[] // pro-Kategorie Limits
  turn_seconds:    number          // Default 30, min 5, max 600
}

interface DraftTurn {
  order:       number              // unique integer, bestimmt Reihenfolge
  actor:       'host' | 'guest' | 'admin'
  action:      'pick' | 'ban' | 'snipe' | 'steal' | 'reveal_picks' | 'reveal_bans' | 'reveal_all'
  variant:     'global' | 'exclusive' | 'nonexclusive' | null
  is_hidden:   boolean             // Pick/Ban erst nach Reveal sichtbar
  is_parallel: boolean             // beide Seiten submitten gleichzeitig
  as_opponent: boolean             // Actor wählt für Gegner
  category:    string              // 'default' oder Name aus category_limits
}
```

**Preset-Visibility** erfolgt über `is_public: boolean` — kein separates Visibility-Enum im Datenbankschema. Admin kann via `PATCH /api/draft-presets/:id/promote` auf `is_public: true` setzen.

---

## Viewer-Roles und Maskierung

Maskierungs-Logik in `maskStateForViewer()` in `lib/draft-emit.ts`:

| Viewer | hidden_picks[eigene Seite] | hidden_picks[Gegner] | hidden_bans |
|--------|--------------------------|----------------------|-------------|
| `host` | vollständig sichtbar | `['?', '?', ...]` (Anzahl erhalten) | analog |
| `guest` | vollständig sichtbar | `['?', '?', ...]` | analog |
| `spectator` | `[]` (komplett leer) | `[]` | `[]` |

`admin`-Role in `getDraftView` fällt auf `spectator`-Masking zurück (kein Sonder-Pfad im Code — Admins nutzen die Cancel-API, nicht die Live-View).

---

## Socket-Integration

[siehe `.knowledge/realtime.md`] für vollständige Event-Payloads.

**Rooms:**

| Room | Mitglieder | Inhalt |
|------|-----------|--------|
| `draft_<id>` | alle Players + Admin | `draft_started`, `turn_started`, `draft_complete` |
| `draft_<id>:player_<userId>` | genau ein Player | per-Player maskierte `action_committed` + `draft_state_sync` |
| `draft_<id>:spec` | Spectators | Spectator-maskierte Events |

**Emit-Events:** `draft_started`, `turn_started`, `action_committed`, `draft_state_sync` (nach Reveal-Actions), `draft_complete`.

---

## Lifecycle

1. Organizer ruft `POST /api/matches/:id/start` → Route ruft `draftService.startDraft(...)`.
2. `startDraft` erstellt `Draft`-Row (Status `ONGOING`), schreibt Redis, emittet `draft_started` + erstes `turn_started`.
3. Players joinen Socket-Rooms (via Socket-Auth-Flow — [siehe `.knowledge/realtime.md`]).
4. Player ruft `POST /api/drafts/:id/action` → `draftService.handleAction(draftId, userId, factionId)`.
5. Turn-Zyklus mit Timer; bei Ablauf `forceAutoSelect`.
6. Wenn `isDraftComplete()` wahr: `Draft.status = 'COMPLETED'`, `final_host_factions`/`final_guest_factions` auf `Draft`-Row geschrieben, `draft_complete` emittet.
7. Draft-Ergebnis wird über `final_host_factions` / `final_guest_factions` auf dem `Draft`-Record persistiert (kein separates `Match`-Result-Feld).

---

## Tests

| Datei | Scope |
|-------|-------|
| `apps/backend/test/draft-state.test.ts` | Pure State-Machine — keine Infrastruktur, schnell |
| `apps/backend/test/draft-service.test.ts` | DraftService mit Mocks (Prisma/Redis/IO) |
| `apps/backend/test/draft-socket.test.ts` | Socket-Emit-Verhalten |
| `apps/backend/test/drafts-routes.test.ts` | REST-Endpoints (GET /api/drafts/:id, events, cancel) |
| `apps/backend/test/draft-presets.test.ts` | Preset CRUD-Routes |
| `apps/backend/test/draft-reconnect.test.ts` | Rehydrierung nach Disconnect |
| `apps/backend/test/tournament-with-draft.test.ts` | Integration Match→Draft |
| `apps/e2e/tests/live-draft.spec.ts` | E2E mit echtem WebSocket, 2 Browser-Tabs (~38 s) |

---

## Neue Action hinzufügen — Checkliste

1. **Type** in `packages/types/src/draft.ts` ergänzen: `DraftActionSchema` (Zod-Enum), ggf. `DraftActionExtendedSchema`.
2. **Reducer** in `lib/draft-state.ts`: neuen Branch in `applyAction()` (und ggf. `validateAction()`, `getAvailableFactions()`).
3. **Side-Effects** in `lib/draft-service.ts`: falls nötig in `commitAndAdvance` oder `handleSingleAction` orchestrieren.
4. **Socket-Event** (falls neu): Emit-Funktion in `lib/draft-emit.ts` ergänzen; Event-Name in [`.knowledge/realtime.md`] dokumentieren.
5. **Tests**: Unit-Tests für `draft-state.test.ts` (pure Logic), Integrations-Test für `draft-service.test.ts`.
6. **Preset-Seed** ggf. anpassen falls die neue Action in Standard-Presets vorkommt.
