#!/usr/bin/env bash
#
# Stops DataForge by freeing the configured ports. Covers both launchers.
#
# The escape hatch for when nothing is supervising and a server is still holding its
# port: after --detach, or after a terminal that was closed in a way the launcher's
# trap could not survive. A launcher stopped normally cleans up after itself.
#
# Both ports are cleared either way: ./dev.sh uses one per server, and ./start.sh
# serves everything on the UI port.
#
# Only leftover python and node processes are stopped; anything else on those ports
# is reported and left alone.
#
# The Windows twin is stop.ps1.
#
# Usage: ./stop.sh

set -eo pipefail

# shellcheck source=scripts/dev-common.sh
. "$(cd "$(dirname "$0")" && pwd)/scripts/dev-common.sh"

say "Stopping DataForge servers..."

# Neither port has a fixed occupant here: 18081 is Vite under ./dev.sh and the whole
# app under ./start.sh, so the label names the product rather than a half of it.
API_FREED=0
UI_FREED=0
clear_port "$DEV_API_PORT" "DataForge" && API_FREED=1
clear_port "$DEV_UI_PORT" "DataForge" && UI_FREED=1

if [ "$API_FREED" = "1" ] && [ "$UI_FREED" = "1" ]; then
    ok "Ports $DEV_API_PORT and $DEV_UI_PORT are free."
    exit 0
fi

exit 1
