#!/usr/bin/env bash
# Pre-deploy sanity checks. Run as `deploy` user on the production host.
# Exits non-zero on the first failure so callers can chain it.
set -euo pipefail

ENV_FILE="/etc/rizzotto/env/backend.env"
SECRETS_DIR="/etc/rizzotto/secrets"
REPO_DIR="/home/deploy/rizzotto"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok()   { echo "OK:   $*"; }

echo "--- Checking env file ---"
[[ -r "$ENV_FILE" ]] || fail "$ENV_FILE not readable"
# shellcheck disable=SC1090
set -a; source "$ENV_FILE"; set +a

[[ -n "${DATABASE_URL:-}" ]]                  || fail "DATABASE_URL unset"
[[ -n "${REDIS_URL:-}" ]]                     || fail "REDIS_URL unset"
[[ -n "${JWT_SECRET:-}" ]]                    || fail "JWT_SECRET unset"
[[ ${#JWT_SECRET} -ge 32 ]]                   || fail "JWT_SECRET too short (<32 chars)"
[[ -n "${DISCORD_CLIENT_ID:-}" ]]             || fail "DISCORD_CLIENT_ID unset"
[[ -n "${DISCORD_CLIENT_SECRET:-}" ]]         || fail "DISCORD_CLIENT_SECRET unset"
[[ -n "${STEAM_OPENID_RETURN_URL:-}" ]]       || fail "STEAM_OPENID_RETURN_URL unset"
[[ "${FRONTEND_URL:-}" == "https://rizzotto.gg" ]] || fail "FRONTEND_URL must be https://rizzotto.gg"
ok "env vars sane"

echo "--- Checking TLS certs ---"
[[ -e "$SECRETS_DIR/cf-origin.pem" ]] || fail "cf-origin.pem missing"
[[ -e "$SECRETS_DIR/cf-origin.key" ]] || fail "cf-origin.key missing"
# Note: deploy user can't read cf-origin.key (root:caddy 0640) — that's intentional.
# Caddy reads it as the caddy user. We only verify the file exists here.
ok "TLS material present"

echo "--- Checking Docker services ---"
docker exec rizzotto-postgres pg_isready -U rizzotto -d rizzotto >/dev/null 2>&1 \
  || fail "Postgres not ready"
docker exec rizzotto-redis redis-cli ping 2>/dev/null | grep -q PONG \
  || fail "Redis not responding"
ok "Docker stack healthy"

echo "--- Checking frontend build ---"
[[ -f "$REPO_DIR/apps/frontend/dist/index.html" ]] \
  || fail "Frontend not built (no dist/index.html)"
ok "Frontend build present"

echo "--- Checking upload dir ---"
[[ -d /var/lib/rizzotto/uploads ]] || fail "/var/lib/rizzotto/uploads missing"
[[ -w /var/lib/rizzotto/uploads ]] || fail "/var/lib/rizzotto/uploads not writable by current user"
ok "Upload dir writable"

echo "--- All preflight checks passed ---"
