# TWW3 Tournament Platform

Total War: Warhammer 3 Tournament-Plattform — Discord-Login, Tournaments mit Swiss/Single-Elim/Double-Elim/Round-Robin, Live-Brackets via WebSocket, Captain's-Mode-Draft (Phase 2), Faction-Stats & Leaderboard (Phase 3).

> **Single Source of Truth:** [`ROADMAP.md`](./ROADMAP.md)

## Quickstart

```bash
# 1. Install
nvm use            # Node 22
pnpm install

# 2. Start local services
pnpm docker:up     # Postgres 16 + Redis 7

# 3. Bootstrap DB
cp .env.example .env
# Fill in DISCORD_CLIENT_ID + DISCORD_CLIENT_SECRET + JWT_SECRET
pnpm db:migrate
pnpm db:seed

# 4. Dev
pnpm dev           # Runs backend + frontend in parallel via Turbo
```

## Stack

- **Monorepo:** pnpm workspaces + Turborepo
- **Backend:** Fastify 5 + Prisma 7 + Socket.IO + Redis
- **Frontend:** Vite + React 19 + TanStack Router/Query + Tailwind 4
- **Auth:** Discord OAuth2 → JWT in HTTP-Only-Cookie
- **Pairing:** `tournament-pairings` library

## Layout

```
apps/
  backend/    # Fastify API + WebSocket server
  frontend/   # React SPA (Vite)
  e2e/        # Playwright smoke tests (M1.9)
packages/
  db/         # Prisma schema + client singleton
  types/      # Shared TypeScript types (API + Socket events)
```

## Status

**M1 — Foundation & Live-Core** (in progress). See `ROADMAP.md` for milestones.
