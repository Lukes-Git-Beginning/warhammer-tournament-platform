# Deployment — TWW3 Tournament Platform

Production-Deployment-Anleitung. Setup: Docker-Compose oder Standalone-Container.

## Vorab-Voraussetzungen

- Docker + Docker-Compose
- PostgreSQL 16 (managed oder Self-Hosted)
- Redis 7 (managed oder Self-Hosted)
- Discord-Application für OAuth (Client-ID + Secret + Redirect-URI)
- Domain mit TLS-Termination (z.B. via Nginx-Reverse-Proxy oder Cloud-Provider)

## Environment-Variablen

Beispiel `.env.production`:

```
DATABASE_URL=postgresql://user:pass@db-host:5432/tww3?schema=public
REDIS_URL=redis://redis-host:6379

JWT_SECRET=<32+ char random string>
JWT_COOKIE_NAME=auth_token
JWT_COOKIE_DOMAIN=rizzotto.gg
JWT_EXPIRES_IN=604800

DISCORD_CLIENT_ID=<id>
DISCORD_CLIENT_SECRET=<secret>
DISCORD_REDIRECT_URI=https://rizzotto.gg/auth/discord/callback
DISCORD_SCOPES=identify email

FRONTEND_URL=https://rizzotto.gg

NODE_ENV=production
LOG_LEVEL=info

UPLOAD_DIR=/var/lib/tww3/uploads/army-lists
VITE_PUBLIC_URL=https://rizzotto.gg
```

## SEO-Vorbereitungen vor Deploy

Folgende Placeholder müssen vor dem ersten Production-Deploy ersetzt werden:

1. **`apps/frontend/public/og-image.png`** — Platzhalter-Textdatei. Ersetzen durch echtes OG-Bild (1200×630px PNG).
2. **`apps/frontend/public/sitemap.xml`** — `https://example.com` durch die echte Domain ersetzen.
3. **`apps/frontend/public/robots.txt`** — Sitemap-URL (`https://example.com/sitemap.xml`) durch die echte Domain ersetzen.
4. **`apps/frontend/public/icons/factions/*.svg`** — SVG-Placeholders mit Initialen und Faction-Farbe. Ersetzen durch offizielle Faction-Artwork-SVGs. Pfad-Konvention: `/icons/factions/<faction_id>.svg`.

## Build + Deploy

```bash
# 1. Build all workspaces
pnpm install --frozen-lockfile
pnpm build

# 2. Apply migrations
pnpm --filter @tww3/db exec prisma migrate deploy

# 3. Seed default data (idempotent — only on first deploy)
pnpm db:seed

# 4. Start backend (e.g., via PM2 or systemd)
node apps/backend/dist/server.js

# 5. Serve frontend static files (e.g., via Nginx)
# Frontend build output: apps/frontend/dist/
```

## Docker-Compose-Beispiel

`docker-compose.production.yml` (Skelett):

```yaml
services:
  postgres:
    image: postgres:16-alpine
    env_file: .env.production
    volumes:
      - pgdata:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    restart: unless-stopped

  backend:
    build: .
    env_file: .env.production
    depends_on: [postgres, redis]
    ports: ["3000:3000"]
    volumes:
      - uploads:/var/lib/tww3/uploads
    restart: unless-stopped

  frontend:
    image: nginx:alpine
    volumes:
      - ./apps/frontend/dist:/usr/share/nginx/html:ro
      - ./nginx.conf:/etc/nginx/conf.d/default.conf:ro
    ports: ["443:443"]
    restart: unless-stopped

volumes:
  pgdata:
  uploads:
```

## Backup-Strategy

- **PostgreSQL:** `pg_dump` täglich, gzipped, in S3-kompatibles Object-Storage. 7-Tage-Rotation. Test-Restore monatlich.
- **Redis:** Nicht kritisch (Cache + Draft-State), AOF-Snapshots optional.
- **Uploads:** rsync oder Object-Storage-Sync täglich.

## Health-Checks

- `GET /api/health` — sollte 200 zurückgeben (prüfe Existenz, ggf. ergänzen)
- `GET /api/leaderboard` — funktioneller Smoke
- Frontend: `GET /` — sollte das React-Bundle servieren

## Production-Smoke vor Live-Schaltung

```bash
PLAYWRIGHT_BASE_URL=https://staging.rizzotto.gg \
  pnpm --filter @tww3/e2e exec playwright test production-smoke.spec.ts
```

Alternativ mit separater API-URL (wenn Backend auf anderem Port/Host):

```bash
PLAYWRIGHT_BASE_URL=https://staging.rizzotto.gg \
PLAYWRIGHT_API_URL=https://api.staging.rizzotto.gg \
  pnpm --filter @tww3/e2e exec playwright test production-smoke.spec.ts
```

## Domain + TLS

- Domain DNS auf den Server pointen
- Let's-Encrypt via Certbot (oder Cloud-Provider-Managed-Certs)
- HTTPS-Redirect via Nginx oder Edge-Provider

## Post-Launch Checks

1. Discord-OAuth funktioniert
2. Bracket-View auf Mobile + Desktop
3. Faction-Stats für aktive Season vorhanden (sonst `pnpm db:seed` o. Cron-Trigger)
4. Cron-Job für FactionStatsSnapshot läuft (Default: 00:05 UTC täglich)
5. Backup-Job konfiguriert

## Rollback

- Container-Tags taggen pre-deploy: `git push origin <tag>`, Docker-Image-Tag
- Rollback: alte Image-Tag deployen + ggf. `prisma migrate resolve --rolled-back <last-migration>`
- Bei Schema-Breaking-Change: vorher Forwarder-Migration einbauen, dann rückwärtskompatibel deployen
