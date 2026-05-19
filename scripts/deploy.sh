#!/usr/bin/env bash
# Idempotent production deploy for Rizzotto.
# Run as the `deploy` user from /home/deploy/rizzotto on the Hetzner host.
set -euo pipefail

REPO_DIR="/home/deploy/rizzotto"
BRANCH="${DEPLOY_BRANCH:-main}"

cd "$REPO_DIR"

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
