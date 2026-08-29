#!/usr/bin/env bash
# Post a single Discord embed. Sourced by the ops scripts so alerting lives in one place.
#
# Usage:  discord_alert "<title>" "<description>" [<colour-int>]
# Needs:  ALERT_DISCORD_WEBHOOK in the environment. Unset ⇒ no-op (exit 0), so a host without
#         alerting configured still runs its recovery and backup paths normally.
#
# JSON is built with python3 (present on the host) rather than jq (not installed): log tails
# contain quotes, backslashes and newlines, and hand-rolled shell escaping gets that wrong.

RED=15158332
GREEN=3066993

discord_alert() {
  local title="$1" description="$2" colour="${3:-$RED}"
  [ -n "${ALERT_DISCORD_WEBHOOK:-}" ] || return 0

  local payload
  payload=$(TITLE="$title" DESCRIPTION="$description" COLOUR="$colour" python3 -c '
import json, os
desc = os.environ["DESCRIPTION"]
# Discord rejects embeds over 4096 chars in description; keep the tail, which is the useful end.
if len(desc) > 3500:
    desc = "…" + desc[-3500:]
print(json.dumps({"embeds": [{
    "title": os.environ["TITLE"][:256],
    "description": desc,
    "color": int(os.environ["COLOUR"]),
}]}))')

  curl -sS -m 10 -X POST "$ALERT_DISCORD_WEBHOOK" \
    -H 'Content-Type: application/json' -d "$payload" >/dev/null || true
}
