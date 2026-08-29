#!/usr/bin/env bash
# OnFailure= target for the Rizzotto units — see deploy/systemd/rizzotto-alert@.service.
# Reports a unit systemd itself declared failed. (The health watchdog covers the other case:
# a unit that is still "running" but no longer answering.)
set -uo pipefail

# shellcheck source=scripts/notify-discord.sh
. "$(dirname "$(readlink -f "$0")")/notify-discord.sh"

unit="${1:?usage: notify-unit-failure.sh <unit-name>}"
state=$(systemctl show -p ActiveState -p Result --value "$unit" 2>/dev/null | tr '\n' ' ')
tail_log=$(journalctl -u "$unit" -n 15 --no-pager -o cat 2>/dev/null | tail -c 1200)

discord_alert "Unit failed — $unit" \
"State: \`${state:-unknown}\`
\`\`\`
${tail_log}
\`\`\`"
