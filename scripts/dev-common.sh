# Shared helpers for the DataForge Unix launchers (setup.sh, dev.sh, start.sh,
# stop.sh). Source it, do not execute it:
#
#   . "$(dirname "$0")/scripts/dev-common.sh"
#
# The twin is scripts/dev-common.ps1. Port defaults, .env precedence, the stamp
# filenames and the only-kill-our-own-runtimes rule are all deliberately identical,
# so the two platforms behave the same. Process supervision is the one place they
# diverge on purpose - see the note above start_server.
#
# Written for bash 3.2, which is still what macOS ships: no associative arrays, no
# mapfile, no ${var,,}. The launchers also run without `set -u`, because bash 3.2
# treats ${#arr[@]} on an empty array as an unbound variable.

# Resolved from this file's own location, so the launchers work from any cwd.
DEV_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEV_BACKEND="$DEV_ROOT/backend"
DEV_FRONTEND="$DEV_ROOT/frontend"
DEV_SCRIPTS="$DEV_ROOT/scripts"
DEV_DIST="$DEV_FRONTEND/dist"
DEV_VENV_PY="$DEV_BACKEND/.venv/bin/python"
DEV_DEV_SERVER="$DEV_SCRIPTS/dev_server.py"
DEV_PROD_SERVER="$DEV_SCRIPTS/prod_server.py"

# Generated from backend/schemas.py and backend/constants.py, gitignored, and two of
# them carry real values - so the frontend neither starts nor builds without them.
DEV_GENERATED_SOURCES="types.ts constants.ts wireGuards.ts"

# Written only after a build that actually succeeded. Keying freshness off
# dist/index.html instead would trust a half-finished or hand-made dist.
DEV_BUILD_STAMP_NAME=".dataforge-build-stamp"

# Written by setup.sh, and by setup.ps1, after a successful pip install.
DEV_DEPS_STAMP="$DEV_BACKEND/.venv/.dataforge-deps-stamp"

# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

if [ -t 1 ] && [ -z "$NO_COLOR" ]; then
    DEV_RED=$'\033[31m'
    DEV_GREEN=$'\033[32m'
    DEV_YELLOW=$'\033[33m'
    DEV_CYAN=$'\033[36m'
    DEV_RESET=$'\033[0m'
else
    DEV_RED=""
    DEV_GREEN=""
    DEV_YELLOW=""
    DEV_CYAN=""
    DEV_RESET=""
fi

say()  { printf '%s\n' "$*"; }
ok()   { printf '%s%s%s\n' "$DEV_GREEN" "$*" "$DEV_RESET"; }
hint() { printf '%s%s%s\n' "$DEV_CYAN" "$*" "$DEV_RESET"; }
warn() { printf '%s[WARN] %s%s\n' "$DEV_YELLOW" "$*" "$DEV_RESET" >&2; }
err()  { printf '%s[ERROR] %s%s\n' "$DEV_RED" "$*" "$DEV_RESET" >&2; }

# ---------------------------------------------------------------------------
# .env, mirroring backend/env_file.py
# ---------------------------------------------------------------------------

# Same candidate order as env_file.py - project root first, then backend/ - and the
# first existing file wins. Nothing here touches the process environment; these are
# fallbacks that a real environment variable overrides, the way python-dotenv loads
# with override=False.
DEV_ENV_FILE=""
for _dev_candidate in "$DEV_ROOT/.env" "$DEV_BACKEND/.env"; do
    if [ -f "$_dev_candidate" ]; then
        DEV_ENV_FILE="$_dev_candidate"
        break
    fi
done
unset _dev_candidate

dev_env_value() {
    # Prints the value for a key from DEV_ENV_FILE, or nothing when it is absent.
    local key="$1"
    local line text name value first last

    [ -n "$DEV_ENV_FILE" ] || return 1
    [ -f "$DEV_ENV_FILE" ] || return 1

    while IFS= read -r line || [ -n "$line" ]; do
        text="${line#"${line%%[![:space:]]*}"}"
        text="${text%"${text##*[![:space:]]}"}"
        case "$text" in
            "" | "#"*) continue ;;
        esac
        case "$text" in
            "export "*) text="${text#export }" ;;
        esac
        case "$text" in
            *=*) : ;;
            *) continue ;;
        esac

        name="${text%%=*}"
        name="${name%"${name##*[![:space:]]}"}"
        [ "$name" = "$key" ] || continue

        value="${text#*=}"
        value="${value#"${value%%[![:space:]]*}"}"
        value="${value%"${value##*[![:space:]]}"}"

        # Strip one layer of matching quotes, the way python-dotenv does.
        if [ ${#value} -ge 2 ]; then
            first="${value%"${value#?}"}"
            last="${value#"${value%?}"}"
            if [ "$first" = "$last" ]; then
                case "$first" in
                    '"' | "'")
                        value="${value#?}"
                        value="${value%?}"
                        ;;
                esac
            fi
        fi

        printf '%s\n' "$value"
        return 0
    done < "$DEV_ENV_FILE"

    return 1
}

dev_port() {
    # A port setting, with a real environment variable winning over the .env file.
    # The unset-versus-empty distinction matters: an explicitly blank OS variable
    # still wins and then falls back, same as _env_port in scripts/dev_server.py.
    local name="$1" default="$2" raw

    if [ -n "${!name+set}" ]; then
        raw="${!name}"
    else
        raw="$(dev_env_value "$name" 2>/dev/null || true)"
    fi

    raw="${raw#"${raw%%[![:space:]]*}"}"
    raw="${raw%"${raw##*[![:space:]]}"}"

    if [ -z "$raw" ]; then
        printf '%s\n' "$default"
        return 0
    fi

    case "$raw" in
        *[!0-9]*)
            warn "Ignoring $name=$raw: not a port number. Using $default."
            printf '%s\n' "$default"
            return 0
            ;;
    esac

    if [ "$raw" -lt 1 ] || [ "$raw" -gt 65535 ]; then
        warn "Ignoring $name=$raw: not a port number. Using $default."
        printf '%s\n' "$default"
        return 0
    fi

    printf '%s\n' "$raw"
}

# frontend/vite.config.ts and backend/server_settings.py resolve the same two
# variables from the same .env.
DEV_API_PORT="$(dev_port DATAFORGE_API_PORT 8080)"
DEV_UI_PORT="$(dev_port DATAFORGE_UI_PORT 8081)"
DEV_API_URL="http://127.0.0.1:$DEV_API_PORT"
DEV_UI_URL="http://127.0.0.1:$DEV_UI_PORT"
DEV_HEALTH_URL="$DEV_API_URL/api/health"
# Production serves both halves on the UI port, so its health check lives there.
DEV_APP_HEALTH_URL="$DEV_UI_URL/api/health"

# ---------------------------------------------------------------------------
# Prerequisites
# ---------------------------------------------------------------------------

update_generated_sources() {
    # Always regenerates rather than comparing timestamps. The three files are
    # gitignored, so git leaves them untouched across a branch switch and they keep
    # the other branch's shape with a perfectly plausible mtime - there is no
    # freshness test that would catch it. The generator costs well under a second.
    #
    # A missing venv is not this function's error to report: check_prerequisites
    # names it and points at ./setup.sh. Nor is a failed generation fatal - the
    # previous files are still on disk, and a schemas.py broken enough to stop the
    # generator stops the backend too, which the readiness wait reports far better.
    [ -x "$DEV_VENV_PY" ] || return 0

    printf '%s' "Generating the frontend API types..."
    # The generator rewrites a file only when its content actually changed, so an
    # unchanged shape leaves every mtime alone and dist_is_fresh still reports a
    # dist built before this launch as fresh.
    if "$DEV_VENV_PY" "$DEV_SCRIPTS/generate_types.py" >/dev/null 2>&1; then
        ok " done."
        return 0
    fi

    err " FAILED."
    warn "The frontend API types were left as they were. The UI may not match the API."
    return 1
}

check_prerequisites() {
    # check_prerequisites <check_backend 0|1> <check_frontend 0|1>
    local check_backend="$1" check_frontend="$2"
    local name missing status

    status=0

    if [ "$check_backend" = "1" ] && [ ! -x "$DEV_VENV_PY" ]; then
        err "Python venv not found at backend/.venv."
        say "        Run ./setup.sh from the project root, or:"
        say "          python3 -m venv backend/.venv"
        say "          backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-dev.txt"
        status=1
    fi

    if [ "$check_frontend" = "1" ]; then
        if [ ! -d "$DEV_FRONTEND/node_modules" ]; then
            err "Frontend dependencies not installed."
            say "        Run ./setup.sh from the project root, or:"
            say "          cd frontend && npm ci"
            status=1
        fi

        missing=""
        for name in $DEV_GENERATED_SOURCES; do
            if [ ! -f "$DEV_FRONTEND/src/shared/$name" ]; then
                missing="$missing $name"
            fi
        done
        if [ -n "$missing" ]; then
            err "Generated frontend sources missing:$missing."
            say "        Run ./setup.sh from the project root, or:"
            say "          backend/.venv/bin/python scripts/generate_types.py"
            status=1
        fi
    fi

    return "$status"
}

check_dependency_drift() {
    # Warns when a git pull brought in dependencies that were never installed.
    # Advisory only - it never blocks startup.
    local check_backend="$1" check_frontend="$2"
    local lock installed name req

    if [ "$check_frontend" = "1" ]; then
        lock="$DEV_FRONTEND/package-lock.json"
        # npm rewrites this copy on every install, so it dates the install itself.
        installed="$DEV_FRONTEND/node_modules/.package-lock.json"
        if [ -f "$lock" ] && [ -f "$installed" ] && [ "$lock" -nt "$installed" ]; then
            warn "frontend/package-lock.json is newer than the installed node_modules."
            say "       Run ./setup.sh if the UI fails to build."
        fi
    fi

    if [ "$check_backend" = "1" ] && [ -f "$DEV_DEPS_STAMP" ]; then
        for name in requirements.txt requirements-dev.txt; do
            req="$DEV_BACKEND/$name"
            if [ -f "$req" ] && [ "$req" -nt "$DEV_DEPS_STAMP" ]; then
                warn "backend/$name is newer than the last dependency install."
                say "       Run ./setup.sh if the API fails to import something."
            fi
        done
    fi

    return 0
}

# ---------------------------------------------------------------------------
# Frontend build
# ---------------------------------------------------------------------------

dist_is_fresh() {
    # Whether frontend/dist was built after the last source change.
    #
    # Uses find -newer rather than stat: BSD and GNU stat take incompatible flags,
    # while -newer is POSIX and behaves identically on both. Unlike the PowerShell
    # twin an exact mtime tie counts as fresh here, since -newer is strict, which
    # only matters for a source saved in the same clock tick as the stamp.
    local stamp="$DEV_DIST/$DEV_BUILD_STAMP_NAME"
    local inputs name found

    [ -f "$stamp" ] || return 1
    [ -f "$DEV_DIST/index.html" ] || return 1

    # Everything vite build reads. src/ is recursive and covers the generated
    # src/shared files, so regenerating the API contract also marks the build stale.
    inputs=()
    for name in src public index.html package.json package-lock.json vite.config.ts; do
        if [ -e "$DEV_FRONTEND/$name" ]; then
            inputs[${#inputs[@]}]="$DEV_FRONTEND/$name"
        fi
    done
    for name in "$DEV_FRONTEND"/tsconfig*.json; do
        if [ -e "$name" ]; then
            inputs[${#inputs[@]}]="$name"
        fi
    done

    # Nothing to compare against - treat the build as fresh, as the twin does.
    [ "${#inputs[@]}" -gt 0 ] || return 0

    found="$(find "${inputs[@]}" -newer "$stamp" -print 2>/dev/null | head -n 1)"
    [ -z "$found" ]
}

build_frontend() {
    # Runs in the calling terminal rather than a spawned one: npm run build is
    # typecheck plus vite build, so its failures are compiler errors the caller has
    # to read before deciding to abort.
    say "Building the frontend (npm run build)..."
    say ""

    if ! (cd "$DEV_FRONTEND" && npm run build); then
        say ""
        err "Frontend build failed. Fix the errors above and try again."
        return 1
    fi

    say ""
    date +%Y-%m-%dT%H:%M:%S%z > "$DEV_DIST/$DEV_BUILD_STAMP_NAME"
    ok "Frontend build complete."
    return 0
}

# ---------------------------------------------------------------------------
# Ports
# ---------------------------------------------------------------------------

port_listener_pids() {
    # PIDs listening on a port, one per line. Exit 2 means neither tool is present,
    # which is a different thing from nothing listening.
    local port="$1"

    if command -v lsof >/dev/null 2>&1; then
        lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | sort -u
        return 0
    fi

    if command -v ss >/dev/null 2>&1; then
        ss -lptnH "sport = :$port" 2>/dev/null |
            grep -o 'pid=[0-9][0-9]*' | cut -d= -f2 | sort -u
        return 0
    fi

    return 2
}

process_name() {
    ps -o comm= -p "$1" 2>/dev/null | sed 's|.*/||' | tr -d ' '
}

clear_port() {
    # Frees a dev port held by a leftover python or node process.
    #
    # Only our own runtimes are killed. Anything else gets named and left alone -
    # force-killing an unrelated process because it happens to sit on a dev port is
    # a far worse outcome than refusing to start. Returns 0 when the port is free.
    local port="$1" label="$2"
    local pids pid name pgid deadline foreign rc

    [ -n "$label" ] || label="dev server"

    rc=0
    pids="$(port_listener_pids "$port")" || rc=$?
    if [ "$rc" -eq 2 ]; then
        warn "Neither lsof nor ss is available, so port $port was not checked."
        say "       A leftover server there will show up as a bind error instead."
        return 0
    fi
    [ -n "$pids" ] || return 0

    foreign=0
    for pid in $pids; do
        name="$(process_name "$pid")"
        case "$name" in
            python | python[0-9]* | pythonw | node) : ;;
            *)
                err "Port $port is held by ${name:-PID $pid} (PID $pid)."
                foreign=1
                ;;
        esac
    done
    if [ "$foreign" = "1" ]; then
        say "        That is not a leftover dev server, so it was left running."
        say "        Free the port yourself and try again."
        return 1
    fi

    for pid in $pids; do
        name="$(process_name "$pid")"
        printf '%s  Port %s: stopping leftover %s (PID %s) from a previous %s run...%s\n' \
            "$DEV_YELLOW" "$port" "$name" "$pid" "$label" "$DEV_RESET"
        # The tree, not the leaf: a dev server is python -> uvicorn reload child, or
        # npm -> node. Killing the listener alone can orphan the rest of the group.
        pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ')"
        if [ -n "$pgid" ]; then
            kill -TERM "-$pgid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
        else
            kill -TERM "$pid" 2>/dev/null || true
        fi
    done

    # The socket is released lazily, and Vite's strictPort makes a half-released
    # port just as fatal as an occupied one.
    deadline=$(( $(date +%s) + 5 ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        pids="$(port_listener_pids "$port")" || true
        [ -n "$pids" ] || return 0
        sleep 0.2
    done

    for pid in $pids; do
        kill -KILL "$pid" 2>/dev/null || true
    done
    sleep 0.5

    pids="$(port_listener_pids "$port")" || true
    if [ -n "$pids" ]; then
        err "Port $port is still in use after stopping the old process."
        return 1
    fi
    return 0
}

# ---------------------------------------------------------------------------
# Readiness
# ---------------------------------------------------------------------------

wait_http_ready() {
    # Polls a URL until it answers. Returns non-zero on timeout, or as soon as the
    # watched process exits - a crashed server should not cost the full timeout.
    local url="$1" timeout="$2" watch_pid="$3"
    local deadline

    [ -n "$timeout" ] || timeout=40

    if ! command -v curl >/dev/null 2>&1 && ! command -v wget >/dev/null 2>&1; then
        warn "Neither curl nor wget is available, so readiness was not checked."
        return 0
    fi

    deadline=$(( $(date +%s) + timeout ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if [ -n "$watch_pid" ] && ! kill -0 "$watch_pid" 2>/dev/null; then
            return 1
        fi
        if command -v curl >/dev/null 2>&1; then
            if curl -fsS -o /dev/null -m 2 "$url" 2>/dev/null; then
                return 0
            fi
        elif wget -q -O /dev/null -T 2 "$url" 2>/dev/null; then
            return 0
        fi
        sleep 0.4
    done

    return 1
}

wait_tcp_ready() {
    # Polls until a TCP port accepts a connection. Used for Vite, which has no
    # health endpoint of its own.
    local port="$1" timeout="$2" watch_pid="$3"
    local host="127.0.0.1" deadline

    [ -n "$timeout" ] || timeout=60

    deadline=$(( $(date +%s) + timeout ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        if [ -n "$watch_pid" ] && ! kill -0 "$watch_pid" 2>/dev/null; then
            return 1
        fi
        if command -v nc >/dev/null 2>&1; then
            if nc -z "$host" "$port" >/dev/null 2>&1; then
                return 0
            fi
        elif (exec 3<>"/dev/tcp/$host/$port") >/dev/null 2>&1; then
            return 0
        fi
        sleep 0.3
    done

    return 1
}

# ---------------------------------------------------------------------------
# Supervision
# ---------------------------------------------------------------------------
#
# This is where the Unix launchers deliberately diverge from the PowerShell ones.
# Windows spawns detached cmd windows and needs a Win32 console-control handler to
# keep a closed launcher from orphaning them (see Register-DevExitGuard). Here the
# servers are ordinary background children, each in its own process group, and one
# shell trap covers Ctrl+C, kill, and a closed terminal alike.

DEV_SUPERVISED=""
DEV_LAST_PID=""

start_server() {
    # start_server <label> <workdir> <command...>
    # Sets DEV_LAST_PID to the job, which under job control is also its group id.
    local label="$1" workdir="$2"
    shift 2

    # Job control puts each background job in its own process group, which is what
    # makes killing the group reap uvicorn's reload child instead of orphaning it.
    set -m
    (
        cd "$workdir" || exit 1
        # Without this python block-buffers stdout once it is a pipe rather than a
        # terminal, and a starting server looks hung until enough output piles up.
        # The tag is what keeps two interleaved server logs readable, now that
        # there are no separate windows to keep them apart.
        PYTHONUNBUFFERED=1 "$@" 2>&1 |
            awk -v tag="[$label] " '{ print tag $0; fflush() }'
    ) &
    DEV_LAST_PID=$!
    set +m
}

supervise() {
    DEV_SUPERVISED="$DEV_SUPERVISED $1"
}

supervise_release() {
    # For the exits that intentionally leave servers running: --detach, and the
    # readiness failure that keeps the error on screen.
    DEV_SUPERVISED=""
}

stop_process_group() {
    local pgid="$1" deadline

    [ -n "$pgid" ] || return 0
    kill -TERM "-$pgid" 2>/dev/null || return 0

    deadline=$(( $(date +%s) + 5 ))
    while [ "$(date +%s)" -lt "$deadline" ]; do
        kill -0 "-$pgid" 2>/dev/null || return 0
        sleep 0.2
    done

    kill -KILL "-$pgid" 2>/dev/null || true
}

stop_supervised() {
    local pgid
    for pgid in $DEV_SUPERVISED; do
        stop_process_group "$pgid"
    done
    DEV_SUPERVISED=""
}

open_browser() {
    local url="$1"
    if command -v open >/dev/null 2>&1; then
        open "$url" >/dev/null 2>&1 || true
    elif command -v xdg-open >/dev/null 2>&1; then
        xdg-open "$url" >/dev/null 2>&1 || true
    fi
}

wait_for_key() {
    # Returns when a key is pressed. With no terminal on stdin there is nothing to
    # wait on, so block instead and let the trap do the stopping - returning
    # immediately would tear the servers down the moment they came up.
    local unused
    if [ -t 0 ]; then
        # A builtin, so a trapped signal runs its handler at once.
        read -r -n 1 -s unused 2>/dev/null || read -r unused || true
    else
        # Deliberately `sleep &` plus `wait`, never a bare `sleep`: bash defers a
        # trap until the running foreground *external* command finishes, so a plain
        # `sleep 3600` would sit on a SIGTERM for up to an hour before cleaning up.
        # `wait` is a builtin and is interrupted immediately.
        while :; do
            sleep 3600 &
            wait $! || true
        done
    fi
}
