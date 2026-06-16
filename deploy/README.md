# Rizzotto — Production Deploy Reference

This directory holds the deploy-time infrastructure that runs Rizzotto on its
Hetzner CX22 host. The runtime topology is **hybrid**:

- `docker-compose.production.yml` — Postgres 16 + Redis 7 (loopback-only ports)
- `systemd/rizzotto-backend.service` — Backend (Fastify) on the host, `tsx` runtime
- `systemd/rizzotto-backup.{service,timer}` — daily `pg_dump` to `/var/backups/rizzotto`
- `Caddyfile` — TLS terminator + reverse proxy + SPA static server (host service)

Caddy runs as a native package; everything else is either a Docker container or a
systemd unit. The frontend `dist/` is served straight from the repo working tree
at `/home/deploy/rizzotto/apps/frontend/dist`.

## Server-only paths (never committed)

| Path                                   | Contents                                 |
|----------------------------------------|------------------------------------------|
| `/etc/rizzotto/env/backend.env`        | Runtime secrets (template: `.env.production.example`) |
| `/etc/rizzotto/secrets/cf-origin.pem`  | Cloudflare 15yr origin cert              |
| `/etc/rizzotto/secrets/cf-origin.key`  | Cloudflare origin cert key (0600)        |
| `/etc/rizzotto/secrets/pg_password.txt`| Postgres password (Docker secret source) |
| `/var/lib/rizzotto/postgres-data/`     | Postgres volume                          |
| `/var/lib/rizzotto/uploads/`           | Army-list uploads                        |
| `/var/backups/rizzotto/`               | `pg_dump.sql.gz`, 14-day rotation        |

## Deploy

From the production host, run:

```bash
ssh deploy@178.105.166.118
cd /home/deploy/rizzotto
bash scripts/deploy.sh
```

Phase-2-or-later GitHub Actions auto-deploy is a follow-up (see plan file).

## Restore from backup

```bash
# Pick a backup
ls /var/backups/rizzotto/

# Restore over an existing DB (destructive!)
zcat /var/backups/rizzotto/db-2026-05-20-0230.sql.gz \
  | docker exec -i rizzotto-postgres psql -U rizzotto rizzotto
```

For a clean restore: drop+recreate the DB inside the container first, then pipe.

## Cloudflare config

- DNS: A `rizzotto.gg` → `178.105.166.118` (Proxied / orange cloud)
- SSL/TLS mode: **Full (Strict)**
- Origin Certificate Authority issued the 15yr cert that lives on this host

## Common ops

| What                                | Command                                                  |
|-------------------------------------|----------------------------------------------------------|
| Backend logs (live)                 | `sudo journalctl -u rizzotto-backend -f`                 |
| Caddy logs (live)                   | `sudo journalctl -u caddy -f`                            |
| Postgres logs                       | `docker logs -f rizzotto-postgres`                       |
| Restart backend                     | `sudo systemctl restart rizzotto-backend`                |
| Apply Caddy config (admin off → restart, not reload) | `sudo systemctl restart caddy`          |
| Run backup manually                 | `sudo systemctl start rizzotto-backup.service`           |
| List backup timer status            | `sudo systemctl list-timers rizzotto-backup`             |
| Preflight checks                    | `bash scripts/preflight.sh`                              |
