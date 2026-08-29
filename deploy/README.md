# Rizzotto — Production Deploy Reference

This directory holds the deploy-time infrastructure that runs Rizzotto on its
Hetzner CX22 host. The runtime topology is **hybrid**:

- `docker-compose.production.yml` — Postgres 16 + Redis 7 (loopback-only ports)
- `systemd/rizzotto-backend.service` — Backend (Fastify) on the host, `tsx` runtime
- `systemd/rizzotto-health.{service,timer}` — minute-by-minute `/health` probe + auto-restart
- `systemd/rizzotto-backup.{service,timer}` — daily `pg_dump`, local rotation + off-site copy
- `systemd/rizzotto-alert@.service` — `OnFailure=` template, posts a failed unit to Discord
- `Caddyfile` — TLS terminator + reverse proxy + SPA static server (host service)

Caddy runs as a native package; everything else is either a Docker container or a
systemd unit. The frontend `dist/` is served straight from the repo working tree
at `/home/deploy/rizzotto/apps/frontend/dist`.

## Server-only paths (never committed)

| Path                                   | Contents                                 |
|----------------------------------------|------------------------------------------|
| `/etc/rizzotto/env/backend.env`        | Runtime secrets (template: `.env.production.example`) |
| `/etc/rizzotto/env/alert.env`          | `ALERT_DISCORD_WEBHOOK` — watchdog + `rizzotto-alert@` |
| `/etc/rizzotto/env/backup.env`         | `BACKUP_REMOTE` + `RCLONE_CONFIG_*` (see Off-site backups) |
| `/etc/rizzotto/secrets/cf-origin.pem`  | Cloudflare 15yr origin cert              |
| `/etc/rizzotto/secrets/cf-origin.key`  | Cloudflare origin cert key (0600)        |
| `/etc/rizzotto/secrets/pg_password.txt`| Postgres password (Docker secret source) |
| `/var/lib/rizzotto/postgres-data/`     | Postgres volume                          |
| `/var/lib/rizzotto/uploads/`           | Army-list uploads, replays               |
| `/var/backups/rizzotto/`               | `pg_dump.sql.gz`, 14-day rotation        |

## Deploy

From the production host, run:

```bash
ssh deploy@178.105.166.118
cd /home/deploy/rizzotto
bash scripts/deploy.sh
```

Phase-2-or-later GitHub Actions auto-deploy is a follow-up (see plan file).

## Monitoring & auto-recovery

Three independent layers, because each one is blind to what the others catch:

| Layer | Catches | Misses |
|---|---|---|
| `Restart=always` (systemd) | the process **dies** | a process that stays up but stops answering |
| `rizzotto-health.timer` (this host) | a **wedged** or unresponsive backend | the whole box being gone |
| External uptime monitor | host down, network, TLS, Cloudflare | nothing — but it cannot fix anything |

On 2026-08-28 only the middle layer would have helped, and it did not exist: a replay parse spun
the event loop for 35 minutes, the process stayed `active (running)`, and the site 502'd until a
human redeployed. See `docs/postmortem-2026-08-28.md`.

### External uptime monitor (manual, one-off)

1. Create a monitor (UptimeRobot / Better Stack free tier is enough) on
   `https://rizzotto.gg/health/deep`, interval 1–5 min, expected status `200`.
2. Point its alerting at the same Discord channel as the deploy-failure webhook.
3. In Cloudflare, confirm `/health*` is **not** cached — a cached 200 would monitor Cloudflare
   rather than the origin. (Cache rule: bypass for `/health*`.)

### Health watchdog

```bash
sudo cp deploy/systemd/rizzotto-health.{service,timer} deploy/systemd/rizzotto-alert@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now rizzotto-health.timer

# Probe once by hand — should log "0 consecutive failures" style output and exit 0.
sudo systemctl start rizzotto-health.service && journalctl -u rizzotto-health -n 20 --no-pager
```

Discord alerting is **optional** — `EnvironmentFile=-…` means a missing file is fine, and the
watchdog still restarts a wedged backend without it (recovery must never depend on alerting).
To turn alerts on:

```bash
printf 'ALERT_DISCORD_WEBHOOK=%s\n' '<webhook-url>' | sudo tee /etc/rizzotto/env/alert.env >/dev/null
sudo chmod 640 /etc/rizzotto/env/alert.env && sudo chown root:deploy /etc/rizzotto/env/alert.env
sudo /home/deploy/rizzotto/scripts/notify-unit-failure.sh rizzotto-backend   # should post to Discord
```

The alert helpers (`scripts/notify-discord.sh`, `scripts/notify-unit-failure.sh`) build their JSON
with `python3`, which the host already has — deliberately not `jq`, which it does not.

Tunables (env or `/etc/rizzotto/env/alert.env`): `HEALTH_FAIL_THRESHOLD` (default 2 probes),
`HEALTH_TIMEOUT` (5s), `HEALTH_RESTART_COOLDOWN` (600s — keeps the watchdog from fighting
systemd's own restart loop).

## Off-site backups (Cloudflare R2)

The local dump under `/var/backups/rizzotto` shares the server's fate, so it is worthless for the
one scenario backups exist for. `scripts/backup-db.sh` copies each dump to R2 after writing it.

1. Cloudflare dashboard → R2 → create bucket `rizzotto-backups`.
2. R2 → *Manage API tokens* → create a token with **Object Read & Write** scoped to that bucket.
3. On the host, install rclone (`sudo apt install rclone`) and write the credentials:

```bash
sudo tee /etc/rizzotto/env/backup.env >/dev/null <<'ENV'
BACKUP_REMOTE=r2:rizzotto-backups
RCLONE_CONFIG_R2_TYPE=s3
RCLONE_CONFIG_R2_PROVIDER=Cloudflare
RCLONE_CONFIG_R2_ACCESS_KEY_ID=<access-key-id>
RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=<secret-access-key>
RCLONE_CONFIG_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true
ENV
sudo chmod 600 /etc/rizzotto/env/backup.env
sudo chown root:deploy /etc/rizzotto/env/backup.env
```

4. Add an R2 lifecycle rule deleting objects older than 30 days (Bucket → Settings → Object
   lifecycle rules). The local copy keeps its own 14-day rotation.
5. Roll out and test:

```bash
sudo cp deploy/systemd/rizzotto-backup.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start rizzotto-backup.service
journalctl -u rizzotto-backup -n 30 --no-pager      # must end with "Off-site copy verified"
```

Leaving `BACKUP_REMOTE` unset keeps the old local-only behaviour instead of failing.

**Test the restore, not just the backup.** Quarterly, into a throwaway database:

```bash
rclone copyto r2:rizzotto-backups/db-<stamp>.sql.gz /tmp/restore-test.sql.gz
docker exec rizzotto-postgres psql -U rizzotto -c 'CREATE DATABASE restore_test;'
zcat /tmp/restore-test.sql.gz | docker exec -i rizzotto-postgres psql -U rizzotto restore_test
docker exec rizzotto-postgres psql -U rizzotto restore_test -c 'SELECT count(*) FROM "User";'
docker exec rizzotto-postgres psql -U rizzotto -c 'DROP DATABASE restore_test;'
rm /tmp/restore-test.sql.gz
```

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
| List timer status                   | `sudo systemctl list-timers 'rizzotto-*'`                |
| Probe health once                   | `sudo systemctl start rizzotto-health.service`           |
| Watchdog history                    | `sudo journalctl -u rizzotto-health --since today`       |
| Is the backend answering?           | `curl -s localhost:3000/health/deep \| python3 -m json.tool` |
| Preflight checks                    | `bash scripts/preflight.sh`                              |
