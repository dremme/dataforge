#!/usr/bin/env bash
#
# Runs DataForge in production mode: builds the frontend if needed, then serves the
# bundled UI and the API from a single process.
#
# One uvicorn process binds DATAFORGE_UI_PORT (default 18081) and answers both the
# built UI at / and the API under /api. Same origin, so there is no proxy hop and no
# CORS - and no reloader, so a long job is never restarted out from under itself.
#
# The build is skipped when frontend/dist is newer than every frontend source, which
# makes the usual launch near-instant. This terminal stays open as a supervisor:
# press any key, or Ctrl+C, to stop the server cleanly.
#
# The Windows twin is start.ps1. For hot reload while developing, use ./dev.sh.
#
# Usage: ./start.sh [--rebuild] [--no-build] [--no-browser] [--detach]

set -eo pipefail

# shellcheck source=scripts/dev-common.sh
. "$(cd "$(dirname "$0")" && pwd)/scripts/dev-common.sh"

REBUILD=0
NO_BUILD=0
NO_BROWSER=0
DETACH=0

usage() {
    cat <<'USAGE'
Usage: ./start.sh [options]

  --rebuild      Build the frontend even when dist looks up to date
  --no-build     Never build; serve whatever is already in frontend/dist
  --no-browser   Do not open the browser once the server is ready
  --detach       Exit once the server is ready instead of supervising it;
                 stop it later with ./stop.sh
  -h, --help     Show this help
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --rebuild) REBUILD=1 ;;
        --no-build) NO_BUILD=1 ;;
        --no-browser) NO_BROWSER=1 ;;
        --detach) DETACH=1 ;;
        -h | --help)
            usage
            exit 0
            ;;
        *)
            err "Unknown option: $1"
            say ""
            usage
            exit 1
            ;;
    esac
    shift
done

if [ "$REBUILD" = "1" ] && [ "$NO_BUILD" = "1" ]; then
    err "--rebuild and --no-build cannot be combined."
    exit 1
fi

LEAVE_RUNNING=0

cleanup() {
    if [ "$LEAVE_RUNNING" = "0" ] && [ -n "$DEV_SUPERVISED" ]; then
        say ""
        say "Stopping the server..."
        stop_supervised
        # Backstop: a terminal closed by hand can leave the server holding the port
        # with no job left to walk down from.
        clear_port "$DEV_UI_PORT" "app" >/dev/null 2>&1 || true
        say "Stopped."
    fi
}

# INT and TERM exit, and the EXIT trap does the actual stopping - so Ctrl+C, kill,
# and a closed terminal all take the same path.
trap 'exit 130' INT TERM
trap cleanup EXIT

say "================================================"
say "  Starting DataForge"
say "  App      : $DEV_UI_URL"
say "  Mode     : production - bundled UI, no hot reload"
say "================================================"
say ""

# Ahead of both the check below and the freshness test: the generated sources are
# gitignored, so a branch switch leaves the other branch's shape in place, and a dist
# built from it would otherwise still measure as up to date.
update_generated_sources || true

check_prerequisites 1 1 || exit 1
check_dependency_drift 1 1

if [ "$NO_BUILD" = "1" ]; then
    if [ ! -f "$DEV_DIST/index.html" ]; then
        err "No frontend build in frontend/dist, and --no-build was passed."
        say "        Run ./start.sh without --no-build, or build it yourself:"
        say "          cd frontend && npm run build"
        exit 1
    fi
    say "Skipping the build (--no-build). Serving the existing frontend/dist."
elif [ "$REBUILD" = "1" ] || ! dist_is_fresh; then
    build_frontend || exit 1
else
    say "Frontend build is up to date. Pass --rebuild to force a rebuild."
fi
say ""

# Vite from a leftover ./dev.sh holds this port too, and the server would just fail
# to bind. Clearing it first keeps ./start.sh working right after ./dev.sh.
clear_port "$DEV_UI_PORT" "app" || exit 1

say "Starting the server on port $DEV_UI_PORT..."
start_server "app" "$DEV_ROOT" "$DEV_VENV_PY" "$DEV_PROD_SERVER"
APP_PID="$DEV_LAST_PID"
supervise "$APP_PID"

say ""
printf '%s' "  Waiting for the app to answer /api/health..."
if wait_http_ready "$DEV_APP_HEALTH_URL" 60 "$APP_PID"; then
    ok " ready."
else
    err " FAILED."
    say ""
    err "The server never became ready. The log above is the whole story."
    LEAVE_RUNNING=1
    supervise_release
    exit 1
fi

if [ "$NO_BROWSER" = "0" ]; then
    open_browser "$DEV_UI_URL"
fi

say ""
if [ "$DETACH" = "1" ]; then
    LEAVE_RUNNING=1
    supervise_release
    say "The server is running in the background. Run ./stop.sh to stop it."
    exit 0
fi

say "The app is running at $DEV_UI_URL. This terminal supervises it."
hint "Press any key here to stop it, or Ctrl+C."
wait_for_key
