# Rizzotto (vormals TWW3 Tournament Platform)

## Projekt-Übersicht

**Rizzotto** — Discord-Auth-basierte Tournament-Plattform für Total War: Warhammer. Spieler authentifizieren sich per Discord-OAuth2, erstellen Turniere, spielen Swiss- oder Bracket-Runden und verfolgen Draft-Picks in Echtzeit. Branding & Design-System wurde 2026-05-13 unter `docs/design/` etabliert (15 Topic-Files, Souls-like/Grimdark-Aesthetik). Rizzotto ist die visuelle Marke (Domain: rizzotto.gg); das Khazalid-Lexikon (Karaz Ankor, Roll of Honour, Conclave) bleibt als Atmospheric-Layer im UI erhalten.
Stack: Fastify 5 + Prisma 7 (driver-adapter) + Socket.IO 4 + Vite 6 + React 19 + TanStack Router/Query + Tailwind CSS 4 + shadcn/ui + motion. Monorepo mit pnpm 9 + Turborepo 2.
Stand: Milestone 5 vollständig abgeschlossen (2026-05-13), Production-Launch-Ready. Workspace-Namen wurden auf `@rizzotto/*` umgestellt (Rename erfolgt in feat/rizzotto-rebrand).

## Monorepo-Commands

```bash
# Development
pnpm dev                                        # alle Workspaces parallel (Turbo)
pnpm docker:up                                  # Postgres + Redis lokal hochfahren

# Einzelne Workspaces
pnpm -F @rizzotto/backend dev                   # nur Backend
pnpm -F @rizzotto/frontend dev                  # nur Frontend

# Build
pnpm build                                      # alle Workspaces in Dependency-Reihenfolge
pnpm typecheck                                  # tsc --noEmit über alle Workspaces

# Tests
pnpm test                                       # Vitest (backend, frontend, scraper)
pnpm -F @rizzotto/backend test                  # nur Backend-Tests
pnpm test:e2e                                   # Playwright E2E (braucht laufende Services)

# Datenbank
pnpm db:migrate                                 # prisma migrate dev (Development)
pnpm db:migrate:deploy                          # prisma migrate deploy (Production)
pnpm db:generate                                # prisma generate (nach schema.prisma-Änderung)
pnpm db:seed                                    # Seed-Daten einspielen
pnpm db:studio                                  # Prisma Studio öffnen

# Code-Qualität
pnpm lint                                       # ESLint über alle Workspaces
pnpm format                                     # Prettier (TS, TSX, JSON, MD, YAML)
pnpm clean                                      # dist/, .turbo/, node_modules/ löschen
```

## Key Paths

| Pfad                                                    | Zweck                                                    |
|---------------------------------------------------------|----------------------------------------------------------|
| `apps/backend/src/app.ts`                               | `buildApp()` — Plugin-Registrierung, Fastify-Instanz     |
| `apps/backend/src/lib/cache.ts`                         | `cached()` / `invalidate()` / `cacheKey()` — Redis-Cache |
| `apps/backend/src/plugins/auth.ts`                      | `authenticate` / `requireRole` — JWT + Discord-Auth      |
| `apps/backend/src/plugins/socket.ts`                    | Socket.IO direkt an `fastify.server` attached            |
| `packages/db/prisma/schema.prisma`                      | DB-Models (User, Tournament, Match, Pick, …)             |
| `packages/db/prisma.config.ts`                          | Prisma 7 driver-adapter — `datasource.url` gehört hierher |
| `packages/types/src/`                                   | Shared Zod-Schemas + Socket-Event-Types                  |
| `apps/frontend/src/router.tsx`                          | Code-basierter TanStack Router (alle Routes hier)        |
| `apps/frontend/src/lib/api.ts`                          | `apiFetch<T>()` — typsicherer API-Wrapper                |
| `apps/e2e/tests/helpers/tournament-fixture.ts`          | E2E-Helper: Tournament-Setup + Teardown                  |

## Coding-Konventionen

**ESM-Imports:** `.js`-Extension auch in `.ts`-Files zwingend (`module: NodeNext`).

```typescript
import { cached } from './cache.js';       // korrekt
import { cached } from './cache';           // falsch — Runtime-Fehler
```

**Validation:** Zod am Route-Eingang via `schema`-Option oder explizites `.parse()` — kein manuelles `typeof`/`instanceof`.

**Error-Shape** (einheitlich über alle Routen):

```typescript
{ error: string; message: string; statusCode: number }
```

**Soft-Delete:** `User`, `Tournament` und `Match` haben ein `deleted_at`-Feld — nie hart löschen, immer `{ deleted_at: new Date() }` setzen.

**Auth-Reihenfolge in Routen:**

```typescript
fastify.addHook('preHandler', fastify.authenticate);  // ZUERST
fastify.addHook('preHandler', fastify.requireRole('admin'));  // danach optional
```

**Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`), imperativer Stil auf Englisch. Keine AI-Attribution in Commit-Messages.

## .knowledge/-Verweise

| Thema / Frage                                | Hub-File                              |
|----------------------------------------------|---------------------------------------|
| **Design-System, Tokens, Brand, Voice**      | **`docs/design/README.md`**           |
| Caching (Redis, `cached()`, TTL)             | `.knowledge/caching.md`               |
| Auth, JWT, Discord-OAuth2                    | `.knowledge/auth.md`                  |
| Socket.IO, Realtime, Events                  | `.knowledge/realtime.md`              |
| Draft-System, State-Machine                  | `.knowledge/draft-system.md`          |
| DB-Schema, Prisma, Migrations                | `.knowledge/database.md`              |
| Frontend-Patterns, Router, Query             | `.knowledge/frontend-patterns.md`     |
| Tests schreiben (Vitest, Playwright)         | `.knowledge/testing.md`               |
| ELO, Swiss-Pairing, Bracket-Algorithmen      | `.knowledge/algorithms.md`            |
| Shared Types, Zod-Contracts                  | `.knowledge/types-contracts.md`       |
| Backend-Architektur, Plugins, Routen         | `.knowledge/backend-architecture.md`  |
| Stack, Workspaces, Top-Level-Commands        | `.knowledge/stack.md`                 |

## Update-Trigger für den Hub

Wenn sich folgende Bereiche ändern, das entsprechende Hub-File mitpflegen:

- **Prisma-Migration (neues Model / Feld)** → `.knowledge/database.md`
- **Neuer Socket-Event in `@rizzotto/types`** → `.knowledge/realtime.md` + `.knowledge/types-contracts.md`
- **Draft-State-Machine-Änderung** → `.knowledge/draft-system.md`
- **Neue Route in `apps/frontend/src/router.tsx`** → `.knowledge/frontend-patterns.md`
- **Neuer Fastify-Plugin oder Route-Group** → `.knowledge/backend-architecture.md`

## Referenz-Docs

| Datei                                          | Inhalt                                                     |
|------------------------------------------------|------------------------------------------------------------|
| `ROADMAP.md`                                   | Zentrale SSOT — Stand, offene Items, Milestones, Out-of-Scope |
| `DEPLOYMENT.md`                                | Production-Setup, Env-Vars, Deploy-Prozess                 |
| `docs/design/README.md`                        | Design-System-Index (15 Topic-Files)                       |
| `docs/archive/`                                | Historische Plan-/Spec-Dateien (Welle-2-Pläne, alte Specs) |

## Sub-Agent-Konvention

Sub-Agent-Prompts beginnen mit `Lies zuerst .knowledge/X.md` für alle relevanten Hub-Files — das hält das Haupt-Context-Window schlank und vermeidet Halluzinationen über projektspezifische Patterns.
Sub-Agents schreiben Hub-Files nur auf expliziten Auftrag, nie autonom — der Hub ist SSOT und darf nicht unkoordiniert mutiert werden.
Pro Sub-Agent maximal 2–3 Hub-Files referenzieren, um den Context-Overhead gering zu halten.
