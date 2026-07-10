# Deployment — Rizzotto

Production-Deployment-Anleitung. Setup: Caddy + systemd auf Hetzner CX22 (rizzotto.gg).

## Vorab-Voraussetzungen

- Node.js 22+ + pnpm 9
- PostgreSQL 16 (Self-Hosted oder Managed)
- Redis 7 (Self-Hosted oder Managed)
- [Caddy](https://caddyserver.com/) als Reverse-Proxy + Static-File-Server (TLS via Cloudflare Origin Cert)
- Discord-Application für OAuth (Client-ID + Secret + Redirect-URI)
- Steam-API-Key für Steam-OpenID-2.0-Login
- Domain `rizzotto.gg` hinter Cloudflare (Full-Strict-TLS)

## Environment-Variablen

Beispiel `.env.production` (alle Variablen-Namen aus `.env.example`):

```
DATABASE_URL=postgresql://user:pass@localhost:5432/rizzotto?schema=public
REDIS_URL=redis://localhost:6379

NODE_ENV=production
PORT=3000
LOG_LEVEL=info

JWT_SECRET=<openssl rand -base64 48>
JWT_COOKIE_NAME=auth_token
JWT_COOKIE_DOMAIN=rizzotto.gg
JWT_EXPIRES_IN=604800

DISCORD_CLIENT_ID=<id>
DISCORD_CLIENT_SECRET=<secret>
DISCORD_REDIRECT_URI=https://rizzotto.gg/auth/discord/callback
DISCORD_SCOPES=identify email
DISCORD_BOT_TOKEN=<optional — notifications>

STEAM_OPENID_RETURN_URL=https://rizzotto.gg/auth/steam/return
STEAM_WEB_API_KEY=<key>

FRONTEND_URL=https://rizzotto.gg
```

> **Upload-Verzeichnisse** (alle optional, Override per Env):
>
> | Variable | Default | Zweck |
> |----------|---------|-------|
> | `REPLAY_UPLOAD_DIR` | `<cwd>/uploads/replays` | Match-Replays |
> | `POSTER_UPLOAD_DIR` | auto → `/var/lib/rizzotto/uploads/posters` (prod), `<cwd>/uploads/posters` (dev) | Turnier-Poster |
> | `ARMY_LIST_UPLOAD_DIR` | `<cwd>/storage/army-lists` | Armeelisten |
>
> Der Service läuft gehärtet (`ProtectSystem=strict`, `ProtectHome=read-only`, siehe
> `deploy/systemd/rizzotto-backend.service`); **einzig schreibbar ist
> `ReadWritePaths=/var/lib/rizzotto/uploads`**. Uploads irgendwo anders (Checkout
> oder `deploy`-Home) schlagen mit ENOENT/EROFS fehl. Poster brauchen **keine**
> gesetzte Env: `lib/posters.ts` probiert beim Start eine Kandidatenliste durch und
> nimmt den ersten schreibbaren Pfad (in Prod → `/var/lib/rizzotto/uploads/posters`,
> in Dev → `<cwd>/uploads/posters`); `POSTER_UPLOAD_DIR` erzwingt einen expliziten
> Pfad. Replays defaulten cwd-relativ und brauchen in Prod `REPLAY_UPLOAD_DIR` unter
> dem schreibbaren Root. Poster und Replays werden über dedizierte
> `@fastify/static`-Mounts (`/uploads/posters/`, `/uploads/replays/`) aus genau
> diesen Pfaden ausgeliefert (siehe `app.ts`), nicht über den generischen
> `/uploads/`-Mount.

## Build + Deploy

```bash
# 1. Abhängigkeiten installieren
pnpm install --frozen-lockfile

# 2. Alle Workspaces bauen
pnpm build

# 3. Migrationen einspiele
pnpm --filter @rizzotto/db exec prisma migrate deploy

# 4. Seed-Daten (idempotent — nur beim ersten Deploy)
pnpm db:seed

# 5. Backend starten (via systemd — siehe unten)
node apps/backend/dist/server.js
```

## Reverse-Proxy: Caddy + systemd

### Übersicht

Der reale Prod-Stack nutzt **Caddy** (kein Nginx, kein Docker):

| Komponente | Beschreibung |
|---|---|
| **Caddy** | TLS-Termination (Cloudflare Origin Cert), API-Reverse-Proxy, SPA-Static-Server |
| **systemd** | Backend-Prozess-Supervisor (`node apps/backend/dist/server.js`) |
| **Cloudflare** | DNS + vorgelagerte WAF/DDoS-Mitigation, Full-Strict-TLS-Modus |

Das Backend (Fastify + Socket.IO) läuft auf `127.0.0.1:3000`; Caddy leitet `/api/*`, `/auth/*`, `/graphql`, `/health` und `/socket.io/*` dorthin weiter.  
Das Frontend (Vite-Build) wird von Caddy direkt aus `/home/deploy/rizzotto/apps/frontend/dist` als statische Dateien serviert, mit SPA-Fallback auf `index.html`.

### Caddy-Konfiguration

Die Repo-SSOT für die Caddy-Konfiguration ist **`deploy/Caddyfile`**. Die Live-Config auf dem Server liegt unter `/etc/caddy/Caddyfile`.

Bei Änderungen manuell synchronisieren:

```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile  # optional sanity check
sudo systemctl restart caddy
```

> **`restart`, nicht `reload`:** Der globale `admin off`-Block in der Caddyfile
> deaktiviert die Admin-API (Port 2019). `systemctl reload caddy` schickt die
> neue Config über genau diese API an den laufenden Prozess und schlägt deshalb
> fehl (`dial tcp [::1]:2019: connect: connection refused`). `restart` lädt die
> Datei direkt neu — Sub-Sekunden-Downtime hinter Cloudflare.

> Caddy liest TLS-Zertifikate aus `/etc/rizzotto/secrets/cf-origin.pem` (Cert) und  
> `/etc/rizzotto/secrets/cf-origin.key` (Key). Ablauf des Cloudflare-Origin-Certs (15 Jahre) rechtzeitig überwachen.

### Backend als systemd-Unit

Das Backend läuft als systemd-Service. Generische Unit-Vorlage (Unit-Name ggf. anpassen):

```ini
[Unit]
Description=Rizzotto Backend
After=network.target

[Service]
WorkingDirectory=/home/deploy/rizzotto
EnvironmentFile=/home/deploy/rizzotto/.env.production
ExecStart=/usr/bin/node apps/backend/dist/server.js
Restart=on-failure
RestartSec=5s
User=deploy

[Install]
WantedBy=multi-user.target
```

Typische Verwaltungsbefehle:

```bash
sudo systemctl daemon-reload
sudo systemctl restart rizzotto-backend   # ggf. Unit-Namen anpassen
sudo systemctl status rizzotto-backend
journalctl -u rizzotto-backend -f
```

## SEO-Vorbereitungen vor Deploy

Folgende Platzhalter müssen vor dem ersten Production-Deploy ersetzt werden:

1. **`apps/frontend/public/og-image.png`** — Platzhalter-Textdatei. Ersetzen durch echtes OG-Bild (1200×630px PNG).
2. **`apps/frontend/public/sitemap.xml`** — `https://example.com` durch die echte Domain ersetzen.
3. **`apps/frontend/public/robots.txt`** — Sitemap-URL (`https://example.com/sitemap.xml`) durch die echte Domain ersetzen.
4. **`apps/frontend/public/icons/factions/*.svg`** — SVG-Platzhalter mit Initialen und Faction-Farbe. Ersetzen durch offizielle Faction-Artwork-SVGs. Pfad-Konvention: `/icons/factions/<faction_id>.svg`.

## Backup-Strategy

- **PostgreSQL:** `pg_dump` täglich, gzipped, in S3-kompatibles Object-Storage. 7-Tage-Rotation. Test-Restore monatlich.
- **Redis:** Nicht kritisch (Cache + Draft-State), AOF-Snapshots optional.
- **Uploads:** rsync oder Object-Storage-Sync täglich.

## Health-Checks

- `GET /health` — Caddy leitet direkt an das Backend weiter; sollte 200 zurückgeben
- `GET /api/leaderboard` — funktioneller Smoke
- Frontend: `GET /` — Caddy serviert das React-Bundle aus `apps/frontend/dist`

## Production-Smoke vor Live-Schaltung

```bash
PLAYWRIGHT_BASE_URL=https://staging.rizzotto.gg \
  pnpm --filter @rizzotto/e2e exec playwright test production-smoke.spec.ts
```

Alternativ mit separater API-URL (wenn Backend auf anderem Port/Host):

```bash
PLAYWRIGHT_BASE_URL=https://staging.rizzotto.gg \
PLAYWRIGHT_API_URL=https://api.staging.rizzotto.gg \
  pnpm --filter @rizzotto/e2e exec playwright test production-smoke.spec.ts
```

## Post-Launch Checks

1. Discord-OAuth funktioniert (Redirect-URI stimmt mit `DISCORD_REDIRECT_URI` überein)
2. Steam-OpenID-Login funktioniert (`STEAM_OPENID_RETURN_URL` gesetzt + öffentlich erreichbar)
3. Bracket-View auf Mobile + Desktop
4. Faction-Stats für aktive Season vorhanden (sonst `pnpm db:seed` o. Cron-Trigger)
5. Cron-Job für FactionStatsSnapshot läuft (Default: 00:05 UTC täglich)
6. Backup-Job konfiguriert
7. Caddy-Status: `sudo systemctl status caddy` — kein TLS-Fehler in den Logs

## Rollback

- Deploy-Artefakte vor dem Deploy taggen: `git tag <deploy-tag> && git push origin <deploy-tag>`
- Rollback: alten Commit auschecken, `pnpm build` + `pnpm --filter @rizzotto/db exec prisma migrate deploy` + `sudo systemctl restart rizzotto-backend`
- Bei Schema-Breaking-Change: vorher Forwarder-Migration einbauen, dann rückwärtskompatibel deployen; notfalls `prisma migrate resolve --rolled-back <last-migration>`
