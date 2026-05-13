> Read-when: Stack-Frage, Workspace-Setup, Top-Level-Commands, Gotchas-Check.

- Monorepo mit pnpm 9 + Turborepo 2; sechs Workspaces: `backend`, `frontend`, `e2e`, `db`, `types`, `scraper`.
- Node >= 22, TypeScript 5.7, `module: NodeNext` — alle ESM-Imports müssen `.js`-Extension tragen.
- Größter Gotcha: Prisma 7 `datasource.url` gehört in `packages/db/prisma.config.ts`, NICHT in `schema.prisma`.

## Monorepo-Topologie

pnpm-Workspaces definiert in `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `scraper`).
Orchestrierung via Turborepo (`turbo.json`).

| Pfad                | Package-Name      | Zweck                                             |
|---------------------|-------------------|---------------------------------------------------|
| `apps/backend`      | `@tww3/backend`   | Fastify 5 API-Server, Socket.IO, Auth, Draft-Logic |
| `apps/frontend`     | `@tww3/frontend`  | React 19 + Vite 6 SPA, TanStack Router/Query      |
| `apps/e2e`          | `@tww3/e2e`       | Playwright E2E-Tests (5 kritische Journeys)       |
| `packages/db`       | `@tww3/db`        | Prisma 7 Client + Migrations + Seed               |
| `packages/types`    | `@tww3/types`     | Shared Zod-Schemas + Socket-Event-Types           |
| `scraper`           | `@tww3/scraper`   | CLI-Scraper für totaltavern.com (CI-deaktiviert)  |

## Versionen

| Tool / Library       | Version (aus package.json) |
|----------------------|----------------------------|
| Node.js              | `>=22.0.0`                 |
| pnpm                 | `9.15.0`                   |
| TypeScript           | `^5.7.3`                   |
| Turborepo            | `^2.9.0`                   |
| Fastify              | `^5.8.0`                   |
| Prisma               | `^7.8.0` (Client + CLI)    |
| `@prisma/adapter-pg` | `^7.8.0`                   |
| Socket.IO (server)   | `^4.8.1`                   |
| Socket.IO (client)   | `^4.8.1`                   |
| React                | `^19.0.0`                  |
| Vite                 | `^6.0.7`                   |
| TanStack Router      | `^1.95.0`                  |
| TanStack Query       | `^5.62.16`                 |
| Tailwind CSS         | `^4.0.0`                   |
| Vitest               | `^2.1.8`                   |
| Playwright           | `^1.49.0`                  |
| Zod                  | `^3.24.1`                  |

TypeScript-Basis-Config: `tsconfig.base.json` — `target: ES2023`, `module: NodeNext`, `moduleResolution: NodeNext`, `strict: true`, `noUncheckedIndexedAccess: true`.

## Top-Level-Commands

Alle Commands werden im Repo-Root ausgeführt (pnpm delegiert via Turborepo).

| Command                  | Was es macht                                                      |
|--------------------------|-------------------------------------------------------------------|
| `pnpm dev`               | Startet alle Workspaces parallel im Watch-Modus (via Turbo)      |
| `pnpm build`             | Baut alle Workspaces in Dependency-Reihenfolge (`^build`)        |
| `pnpm test`              | Führt Vitest in `backend`, `frontend`, `scraper` aus             |
| `pnpm test:e2e`          | Playwright E2E nur im `@tww3/e2e`-Workspace                      |
| `pnpm lint`              | ESLint über alle Workspaces via Turbo                            |
| `pnpm typecheck`         | `tsc --noEmit` in allen Workspaces (nach `^build`)               |
| `pnpm db:generate`       | `prisma generate` im `@tww3/db`-Workspace                        |
| `pnpm db:migrate`        | `prisma migrate dev` im `@tww3/db`-Workspace                     |
| `pnpm db:migrate:deploy` | `prisma migrate deploy` für Production                           |
| `pnpm db:seed`           | Seed-Script (`prisma/seed.ts`) im `@tww3/db`-Workspace           |
| `pnpm db:studio`         | Prisma Studio öffnen                                             |
| `pnpm docker:up`         | `docker compose up -d` (Postgres + Redis lokal)                  |
| `pnpm docker:down`       | `docker compose down`                                            |
| `pnpm format`            | Prettier über alle TS/TSX/JSON/MD/YAML-Files                     |
| `pnpm clean`             | `dist/`, `.turbo/`, `node_modules/` in allen Workspaces löschen  |

Einzelne Workspaces filtern: `pnpm -F @tww3/backend test`, `pnpm -F @tww3/frontend dev`.

## Turborepo-Pipeline

Definiert in `turbo.json`. Tasks mit `^build`-Dependency warten auf Build aller Upstream-Workspaces.

| Task        | `dependsOn`  | Cache  | Persistent | Hinweis                              |
|-------------|--------------|--------|------------|--------------------------------------|
| `build`     | `^build`     | ja     | nein       | Outputs: `dist/**`, `build/**`       |
| `dev`       | —            | nein   | ja         | Watch-Modus, kein Cache              |
| `lint`      | —            | ja     | nein       | Kein Output                          |
| `typecheck` | `^build`     | ja     | nein       | Braucht generierte Types aus `build` |
| `test`      | `^build`     | ja     | nein       | Coverage-Outputs                     |
| `test:e2e`  | `^build`     | nein   | nein       | Playwright, kein Cache               |
| `clean`     | —            | nein   | nein       | Löscht Artefakte                     |

Global-Dependencies: `.env`, `.env.local`, `tsconfig.base.json` — Änderung daran invalidiert alle Caches.

## Gotchas

### 1. Prisma 7 driver-adapter: `datasource.url` in `prisma.config.ts`

Prisma 7 verwendet einen driver-adapter (`@prisma/adapter-pg`). Die `datasource.url` darf deshalb NICHT
in `packages/db/prisma/schema.prisma` stehen (wird dort ignoriert). Sie MUSS in
`packages/db/prisma.config.ts` konfiguriert sein — sonst silent fail, kein Fehler, aber falsche DB-Verbindung.

```typescript
// packages/db/prisma.config.ts  (korrekt)
import { defineConfig } from 'prisma/config';
export default defineConfig({
  datasource: { url: process.env.DATABASE_URL },
});
```

### 2. fastify-socket.io ist Fastify-4-only

Das npm-Paket `fastify-socket.io` unterstützt Fastify 5 nicht. Im Backend wird Socket.IO deshalb direkt
an den Node-HTTP-Server attached — NICHT über ein Fastify-Plugin:

```typescript
// apps/backend/src/plugins/socket.ts
import { Server as IOServer } from 'socket.io';
const io = new IOServer(fastify.server, { /* options */ });
```

Das npm-Paket `fastify-socket.io` darf nicht installiert/verwendet werden.

### 3. ESM-Imports brauchen `.js`-Extension auch in TypeScript-Files

`module: NodeNext` in `tsconfig.base.json` verlangt explizite Datei-Extensions im Import-Pfad.
TypeScript löst `.js`-Imports zur Laufzeit auf die entsprechende `.ts`-Datei auf.

```typescript
// korrekt
import { cached } from './cache.js';
import type { User } from '../types/user.js';

// falsch — führt zu Runtime-Fehler
import { cached } from './cache';
```
