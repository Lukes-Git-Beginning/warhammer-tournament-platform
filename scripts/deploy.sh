#!/usr/bin/env bash
# Idempotent production deploy for Rizzotto.
# Run as the `deploy` user from /home/deploy/rizzotto on the Hetzner host.
set -euo pipefail

REPO_DIR="/home/deploy/rizzotto"
BRANCH="${DEPLOY_BRANCH:-main}"

cd "$REPO_DIR"

echo "=== Pre-deploy check: ongoing tournaments ==="
# A backend restart runs startup / reconciler routines that can touch live tournament
# data (the 2026-08-17 incident). Whether to deploy over a live tournament is a call
# made BEFORE the deploy is triggered — the operator is warned in the chat and decides
# there. This script therefore only SURFACES the count; it never hard-blocks, so a
# needed fix (e.g. one that repairs a live tournament) is never dead-locked by the gate.
ONGOING=$(docker exec rizzotto-postgres psql -U rizzotto -d rizzotto -tAc \
  "SELECT count(*) FROM \"Tournament\" WHERE status = 'ONGOING' AND deleted_at IS NULL" 2>/dev/null \
  | tr -d '[:space:]')
if [[ "$ONGOING" =~ ^[0-9]+$ ]] && [[ "$ONGOING" -gt 0 ]]; then
  echo "NOTE: $ONGOING tournament(s) currently ONGOING — proceeding (operator-approved deploy)."
elif [[ "$ONGOING" =~ ^[0-9]+$ ]]; then
  echo "OK: no ongoing tournaments."
else
  echo "WARN: could not determine the ongoing-tournament count (got '${ONGOING:-}') — proceeding."
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
