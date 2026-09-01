#!/usr/bin/env bash
#
# Launches the DataForge backend and frontend dev servers, waits until each is
# actually serving, then supervises them.
#
# Both logs land in this terminal, tagged [api] and [ui] - the Windows twin uses two
# separate console windows for the same reason, to keep uvicorn's reload output from
# stepping on Vite's. Press any key here, or Ctrl+C, to stop both cleanly, including
# the uvicorn reload child that an unguarded exit would orphan.
#
# The frontend's generated API types are rebuilt from backend/schemas.py on every
# launch. They are gitignored, so a branch switch leaves the other branch's shape in
# place and nothing else would notice.
#
# The Windows twin is dev.ps1. For a production run - bundled UI, one process, no hot
# reload - use ./start.sh.
#
# Usage: ./dev.sh [--backend-only|--frontend-only] [--no-browser] [--no-reload] [--detach]

set -eo pipefail

# shellcheck source=scripts/dev-common.sh
. "$(cd "$(dirname "$0")" && pwd)/scripts/dev-common.sh"

BACKEND_ONLY=0
FRONTEND_ONLY=0
NO_BROWSER=0
NO_RELOAD=0
DETACH=0

usage() {
    cat <<'USAGE'
Usage: ./dev.sh [options]

  --backend-only   Start only the API (DATAFORGE_API_PORT, default 18080)
  --frontend-only  Start only the Vite dev server (DATAFORGE_UI_PORT, default 18081)
  --no-browser     Do not open the browser once the servers are ready
  --no-reload      Run the API without uvicorn's reloader. Use this while a long
                   job is running: a reload re-runs job recovery and re-spawns
                   worker threads mid-flight
  --detach         Exit once both are ready instead of supervising them;
                   stop them later with ./stop.sh
  -h, --help       Show this help
USAGE
}

while [ $# -gt 0 ]; do
    case "$1" in
        --backend-only) BACKEND_ONLY=1 ;;
        --frontend-only) FRONTEND_ONLY=1 ;;
        --no-browser) NO_BROWSER=1 ;;
        --no-reload) NO_RELOAD=1 ;;
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

if [ "$BACKEND_ONLY" = "1" ] && [ "$FRONTEND_ONLY" = "1" ]; then
    err "--backend-only and --frontend-only cannot be combined."
    exit 1
fi

START_BACKEND=1
START_FRONTEND=1
[ "$FRONTEND_ONLY" = "1" ] && START_BACKEND=0
[ "$BACKEND_ONLY" = "1" ] && START_FRONTEND=0

LEAVE_RUNNING=0

cleanup() {
    if [ "$LEAVE_RUNNING" = "0" ] && [ -n "$DEV_SUPERVISED" ]; then
        say ""
        say "Stopping dev servers..."
        stop_supervised
        # Backstop: a terminal closed by hand leaves a server holding its port with
        # no job left to walk down from.
        [ "$START_BACKEND" = "1" ] && clear_port "$DEV_API_PORT" "backend" >/dev/null 2>&1 || true
        [ "$START_FRONTEND" = "1" ] && clear_port "$DEV_UI_PORT" "frontend" >/dev/null 2>&1 || true
        say "Stopped."
    fi
}

trap 'exit 130' INT TERM
trap cleanup EXIT

say "================================================"
say "  Starting DataForge Dev Servers"
[ "$START_BACKEND" = "1" ] && say "  Backend  : $DEV_API_URL"
[ "$START_FRONTEND" = "1" ] && say "  Frontend : $DEV_UI_URL"
say "================================================"
say ""

# Ahead of the check below, not instead of it: regenerating is what keeps the three
# gitignored sources in step with backend/schemas.py across a branch switch, and the
# check stays as the backstop for a clone that has no venv to generate them with.
if [ "$START_FRONTEND" = "1" ]; then
    update_generated_sources || true
fi

check_prerequisites "$START_BACKEND" "$START_FRONTEND" || exit 1
check_dependency_drift "$START_BACKEND" "$START_FRONTEND"

# Clear stale listeners before launching. Vite runs with strictPort, so a leftover
# node on the UI port kills the frontend the moment it starts.
if [ "$START_BACKEND" = "1" ]; then
    clear_port "$DEV_API_PORT" "backend" || exit 1
fi
if [ "$START_FRONTEND" = "1" ]; then
    clear_port "$DEV_UI_PORT" "frontend" || exit 1
fi

BACKEND_PID=""
FRONTEND_PID=""

if [ "$START_BACKEND" = "1" ]; then
    say "Starting backend on port $DEV_API_PORT..."
    if [ "$NO_RELOAD" = "1" ]; then
        start_server "api" "$DEV_ROOT" "$DEV_VENV_PY" "$DEV_DEV_SERVER" --no-reload
    else
        start_server "api" "$DEV_ROOT" "$DEV_VENV_PY" "$DEV_DEV_SERVER"
    fi
    BACKEND_PID="$DEV_LAST_PID"
    supervise "$BACKEND_PID"
fi

if [ "$START_FRONTEND" = "1" ]; then
    say "Starting frontend on port $DEV_UI_PORT..."
    start_server "ui" "$DEV_FRONTEND" npm run dev
    FRONTEND_PID="$DEV_LAST_PID"
    supervise "$FRONTEND_PID"
fi

say ""

# Wait for real readiness rather than a fixed sleep: a cold Vite start is routinely
# slower than any timeout worth hardcoding, and opening the browser early just means
# a connection error you have to refresh past.
BACKEND_READY=1
FRONTEND_READY=1

if [ "$START_BACKEND" = "1" ]; then
    printf '%s' "  Waiting for the API to answer /api/health..."
    if wait_http_ready "$DEV_HEALTH_URL" 60 "$BACKEND_PID"; then
        ok " ready."
    else
        err " FAILED."
        BACKEND_READY=0
    fi
fi

if [ "$START_FRONTEND" = "1" ]; then
    printf '%s' "  Waiting for Vite to accept connections on $DEV_UI_PORT..."
    if wait_tcp_ready "$DEV_UI_PORT" 90 "$FRONTEND_PID"; then
        ok " ready."
    else
        err " FAILED."
        FRONTEND_READY=0
    fi
fi

if [ "$BACKEND_READY" = "0" ] || [ "$FRONTEND_READY" = "0" ]; then
    say ""
    [ "$BACKEND_READY" = "0" ] && err "The backend never became ready. See the [api] log above."
    [ "$FRONTEND_READY" = "0" ] && err "The frontend never became ready. See the [ui] log above."
    say "        Whatever did start was left running so the error stays readable."
    say "        Run ./stop.sh to free the ports."
    LEAVE_RUNNING=1
    supervise_release
    exit 1
fi

if [ "$NO_BROWSER" = "0" ]; then
    if [ "$START_FRONTEND" = "1" ]; then
        open_browser "$DEV_UI_URL"
    else
        open_browser "$DEV_API_URL"
    fi
fi

say ""
say "Hot reload:"
[ "$START_FRONTEND" = "1" ] && say "  Frontend - Vite HMR on save"
if [ "$START_BACKEND" = "1" ]; then
    if [ "$NO_RELOAD" = "1" ]; then
        say "  Backend  - disabled, restart manually to pick up changes"
    else
        say "  Backend  - uvicorn reloader on .py changes, tests excluded"
    fi
fi
say ""

if [ "$DETACH" = "1" ]; then
    LEAVE_RUNNING=1
    supervise_release
    say "Servers are running in the background. Run ./stop.sh to stop them."
    exit 0
fi

say "Both servers are running. This terminal supervises them."
hint "Press any key here to stop them, or Ctrl+C."
wait_for_key
