> Read-when: Stack-Frage, Workspace-Setup, Top-Level-Commands, Gotchas-Check.

- Monorepo mit pnpm 9 + Turborepo 2; sechs Workspaces: `backend`, `frontend`, `e2e`, `db`, `types`, `scraper`.
- Node >= 22, TypeScript 5.7, `module: NodeNext` — alle ESM-Imports müssen `.js`-Extension tragen.
- Größter Gotcha: Prisma 7 `datasource.url` gehört in `packages/db/prisma.config.ts`, NICHT in `schema.prisma`.

## Monorepo-Topologie

pnpm-Workspaces definiert in `pnpm-workspace.yaml` (`apps/*`, `packages/*`, `scraper`).
Orchestrierung via Turborepo (`turbo.json`).

| Pfad                | Package-Name      | Zweck                                             |
|---------------------|-------------------|---------------------------------------------------|
| `apps/backend`      | `@rizzotto/backend`   | Fastify 5 API-Server, Socket.IO, Auth, Draft-Logic |
| `apps/frontend`     | `@rizzotto/frontend`  | React 19 + Vite 6 SPA, TanStack Router/Query      |
| `apps/e2e`          | `@rizzotto/e2e`       | Playwright E2E-Tests (5 kritische Journeys)       |
| `packages/db`       | `@rizzotto/db`        | Prisma 7 Client + Migrations + Seed               |
| `packages/types`    | `@rizzotto/types`     | Shared Zod-Schemas + Socket-Event-Types           |
| `scraper`           | `@rizzotto/scraper`   | CLI-Scraper für totaltavern.com (CI-deaktiviert)  |

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
| `pnpm test:e2e`          | Playwright E2E nur im `@rizzotto/e2e`-Workspace                      |
| `pnpm lint`              | ESLint über alle Workspaces via Turbo                            |
| `pnpm typecheck`         | `tsc --noEmit` in allen Workspaces (nach `^build`)               |
| `pnpm db:generate`       | `prisma generate` im `@rizzotto/db`-Workspace                        |
| `pnpm db:migrate`        | `prisma migrate dev` im `@rizzotto/db`-Workspace                     |
| `pnpm db:migrate:deploy` | `prisma migrate deploy` für Production                           |
| `pnpm db:seed`           | Seed-Script (`prisma/seed.ts`) im `@rizzotto/db`-Workspace           |
| `pnpm db:studio`         | Prisma Studio öffnen                                             |
| `pnpm docker:up`         | `docker compose up -d` (Postgres + Redis lokal)                  |
| `pnpm docker:down`       | `docker compose down`                                            |
| `pnpm format`            | Prettier über alle TS/TSX/JSON/MD/YAML-Files                     |
| `pnpm clean`             | `dist/`, `.turbo/`, `node_modules/` in allen Workspaces löschen  |

Einzelne Workspaces filtern: `pnpm -F @rizzotto/backend test`, `pnpm -F @rizzotto/frontend dev`.

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

## Production-Topologie (rizzotto.gg, live seit 2026-05-19)

Single-Host-Setup auf Hetzner CX22 (`178.105.166.118`, Ubuntu 24.04):

```
Cloudflare (Proxy + SSL Strict)
        │
        ▼
   Caddy 2.11 (host-native)
   ┌─ /api,/auth,/graphql,/health,/socket.io → 127.0.0.1:3000
   └─ /, /assets/*, /icons/* → /home/deploy/rizzotto/apps/frontend/dist (file_server)
        │
        ▼
   rizzotto-backend.service (systemd)
   ExecStart=apps/backend/node_modules/.bin/tsx apps/backend/src/server.ts
   EnvironmentFile=/etc/rizzotto/env/backend.env
        │
        ▼
   docker compose -f deploy/docker-compose.production.yml
   Postgres 16-alpine + Redis 7-alpine, beide loopback only
   (Daten: /var/lib/rizzotto/postgres-data, Backup: /var/backups/rizzotto)
```

Deploy-Artefakte im Repo: `deploy/{docker-compose.production.yml,Caddyfile,systemd/*}`, `scripts/{deploy.sh,preflight.sh}`, `deploy/.env.production.example`. Backup: täglich 02:30 UTC via `rizzotto-backup.timer`, 14-Tage-Rotation.

Server-only Files (nie commited): `/etc/rizzotto/env/backend.env`, `/etc/rizzotto/secrets/{pg_password.txt,cf-origin.{pem,key}}`, `/home/deploy/rizzotto/.env` (Prisma liest hier nur `DATABASE_URL`).

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

### 4. `db:generate` script braucht `exec`-Subcommand

pnpm 9 fällt nicht von einem unbekannten Script-Namen auf einen Bin-Lookup zurück. `pnpm --filter @rizzotto/db prisma generate` failt mit `None of the selected packages has a "prisma" script`. Das root-Script in `package.json` ist deshalb `pnpm --filter @rizzotto/db exec prisma generate` (mit `exec`). Gleiches gilt für `migrate deploy`.

### 5. `@rizzotto/types` muss vor `@rizzotto/frontend` gebaut sein

`packages/types/package.json` exportiert `./dist/index.js` — wenn `dist/` fehlt (frischer Checkout, `pnpm install` produziert keinen Build), kann Vite den Workspace-Import nicht auflösen und failt mit `Cannot find module '@rizzotto/types'`. `pnpm build` über Turbo löst die Reihenfolge automatisch; bei manuellen Frontend-Builds explizit `pnpm -F @rizzotto/types build` vorschalten. `scripts/deploy.sh` macht das.

### 6. `tsx` liegt unter pnpm-Workspace-Layout nicht im Root-`node_modules/.bin`

`tsx` ist Backend-Runtime-Dependency und wird von pnpm in `apps/backend/node_modules/.bin/tsx` abgelegt, nicht im repo-root `/node_modules/.bin/tsx`. Production-systemd-Unit ExecStart muss den absoluten Pfad zum App-Workspace nutzen (siehe `deploy/systemd/rizzotto-backend.service`).

### 7. ENV-Werte mit Whitespace brauchen Quotes

`/etc/rizzotto/env/backend.env` wird sowohl von systemd's `EnvironmentFile=` als auch via `set -a; source backend.env; set +a` (Deploy-Scripts) gelesen. systemd akzeptiert beide Formen, Bash bricht aber bei unquoted Whitespace: `DISCORD_SCOPES=identify email` → `bash: email: command not found`. Immer Quotes setzen: `DISCORD_SCOPES="identify email"`.
