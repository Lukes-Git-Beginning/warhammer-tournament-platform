#!/usr/bin/env bash
# Health watchdog for the Rizzotto backend.
#
# Why this exists: on 2026-08-28 a replay parse spun the event loop for 35 minutes. The process
# never exited, so systemd saw "active (running)" and Restart=always had nothing to act on — the
# site 502'd until a human redeployed. `Restart=` can only react to a process that DIES; a process
# that stops ANSWERING needs an external prober. That is this script.
#
# Probes the local backend, and after FAIL_THRESHOLD consecutive misses posts to Discord and
# restarts the unit. Deliberately probes /health (not /health/deep): a wedged event loop cannot
# answer either, but restarting Node because Postgres is down would only make things worse.
set -uo pipefail

# shellcheck source=scripts/notify-discord.sh
. "$(dirname "$(readlink -f "$0")")/notify-discord.sh"

URL="${HEALTH_URL:-http://127.0.0.1:3000/health}"
UNIT="${HEALTH_UNIT:-rizzotto-backend}"
TIMEOUT="${HEALTH_TIMEOUT:-5}"
FAIL_THRESHOLD="${HEALTH_FAIL_THRESHOLD:-2}"
# Minimum gap between two watchdog restarts. Stops a backend that crash-loops on boot from being
# hammered by the watchdog on top of systemd's own Restart= handling.
RESTART_COOLDOWN="${HEALTH_RESTART_COOLDOWN:-600}"

STATE_DIR="${HEALTH_STATE_DIR:-/run/rizzotto-health}"
FAIL_FILE="$STATE_DIR/consecutive-failures"
LAST_RESTART_FILE="$STATE_DIR/last-restart"
mkdir -p "$STATE_DIR"

if curl -fsS -o /dev/null -m "$TIMEOUT" "$URL"; then
  # Recovered after at least one miss → say so, so the Discord channel does not just show alarms.
  if [ "$(cat "$FAIL_FILE" 2>/dev/null || echo 0)" -ge "$FAIL_THRESHOLD" ]; then
    discord_alert "Backend healthy again — rizzotto.gg" "\`$URL\` is answering." "$GREEN"
  fi
  echo 0 > "$FAIL_FILE"
  exit 0
fi

fails=$(( $(cat "$FAIL_FILE" 2>/dev/null || echo 0) + 1 ))
echo "$fails" > "$FAIL_FILE"
echo "health probe failed ($fails/$FAIL_THRESHOLD): $URL"
[ "$fails" -ge "$FAIL_THRESHOLD" ] || exit 0

now=$(date +%s)
last=$(cat "$LAST_RESTART_FILE" 2>/dev/null || echo 0)
if [ $(( now - last )) -lt "$RESTART_COOLDOWN" ]; then
  echo "in restart cooldown ($(( now - last ))s < ${RESTART_COOLDOWN}s) — alerting only"
  discord_alert "Backend still unhealthy — rizzotto.gg" \
    "\`$URL\` failed $fails consecutive probes. Watchdog is in cooldown and did NOT restart; needs a look."
  exit 1
fi

echo "$now" > "$LAST_RESTART_FILE"
tail_log=$(journalctl -u "$UNIT" -n 15 --no-pager -o cat 2>/dev/null | tail -c 1200)
discord_alert "Backend unresponsive — restarting $UNIT" \
"\`$URL\` failed $fails consecutive probes while the unit was still running.
\`\`\`
${tail_log}
\`\`\`"
systemctl restart "$UNIT"
echo 0 > "$FAIL_FILE"
