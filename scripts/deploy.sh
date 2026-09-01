#!/usr/bin/env bash
# Idempotent production deploy for Rizzotto.
# Run as the `deploy` user from /home/deploy/rizzotto on the Hetzner host.
set -euo pipefail

REPO_DIR="/home/deploy/rizzotto"
BRANCH="${DEPLOY_BRANCH:-main}"

cd "$REPO_DIR"

echo "=== Guard: refuse to deploy over a live tournament ==="
# Restarting the backend runs startup routines that can mutate live tournament
# data (the 2026-08-17 incident corrupted a live tournament this way). HARD-BLOCK
# the deploy while any tournament is ONGOING. Override only with the host's
# explicit go-ahead: ALLOW_ONGOING=1 bash scripts/deploy.sh
ONGOING=$(docker exec rizzotto-postgres psql -U rizzotto -d rizzotto -tAc \
  "SELECT count(*) FROM \"Tournament\" WHERE status = 'ONGOING' AND deleted_at IS NULL" 2>/dev/null \
  | tr -d '[:space:]')
if [[ "$ONGOING" =~ ^[0-9]+$ ]]; then
  if [[ "$ONGOING" -gt 0 && "${ALLOW_ONGOING:-0}" != "1" ]]; then
    echo "BLOCKED: $ONGOING tournament(s) currently ONGOING — deploy aborted." >&2
    echo "         A backend restart can mutate live tournament data. Wait until they" >&2
    echo "         finish, or re-run with ALLOW_ONGOING=1 (host's explicit go-ahead only)." >&2
    exit 1
  fi
  echo "OK: $ONGOING ongoing tournament(s) — clear to proceed."
else
  # The DB probe itself failed (container name / auth / psql). Don't silently
  # assume it's safe — block unless explicitly overridden, so a broken probe
  # can't sneak a deploy past the gate.
  echo "BLOCKED: could not determine the ongoing-tournament count (got '${ONGOING:-}')." >&2
  echo "         Re-run with ALLOW_ONGOING=1 once you have confirmed no tournament is live." >&2
  [[ "${ALLOW_ONGOING:-0}" == "1" ]] || exit 1
fi

echo "=== [1/7] Fetching $BRANCH ==="
git fetch origin
git checkout "$BRANCH"
git pull origin "$BRANCH"

echo "=== [2/7] Installing dependencies ==="
pnpm install --frozen-lockfile

echo "=== [3/7] Generating Prisma client ==="
pnpm db:generate

echo "=== [4/7] Applying database migrations ==="
pnpm --filter @rizzotto/db exec prisma migrate deploy

echo "=== [5/7] Building shared packages and frontend ==="
# @rizzotto/types must be built before frontend can resolve workspace imports.
pnpm --filter @rizzotto/types build
VITE_PUBLIC_URL=https://rizzotto.gg pnpm --filter @rizzotto/frontend build

echo "=== [6/7] Type-checking backend (sanity) ==="
pnpm --filter @rizzotto/backend typecheck

echo "=== [7/7] Restarting backend ==="
sudo systemctl restart rizzotto-backend
sleep 2
sudo systemctl status rizzotto-backend --no-pager --lines=20

echo "=== Deploy complete ==="
