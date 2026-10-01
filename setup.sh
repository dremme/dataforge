#!/usr/bin/env bash

set -eo pipefail

# shellcheck source=scripts/dev-common.sh
. "$(cd "$(dirname "$0")" && pwd)/scripts/dev-common.sh"

PYTHON_VERSION="$(tr -d '\r\n' < "$DEV_ROOT/.python-version")"
PYTHON_SERIES="${PYTHON_VERSION%.*}"

# Keep in step with the engines range in frontend/package.json. Both come from what
# the lockfile actually resolves: eslint 10 and sass 1.103.
NODE_RANGE="^20.19.0 || ^22.13.0 || >=24"

fail() {
    say ""
    err "$*"
    exit 1
}

python_matches_pin() {
    "$1" "$DEV_SCRIPTS/py_version.py" >/dev/null 2>&1
}

find_python() {
    local candidate
    if [ -n "$DATAFORGE_PYTHON" ]; then
        if python_matches_pin "$DATAFORGE_PYTHON"; then
            printf '%s\n' "$DATAFORGE_PYTHON"
            return 0
        fi
        return 1
    fi
    for candidate in "python$PYTHON_SERIES" python3 python; do
        if command -v "$candidate" >/dev/null 2>&1 && python_matches_pin "$candidate"; then
            command -v "$candidate"
            return 0
        fi
    done
    return 1
}

node_version_ok() {
    # The engines range, evaluated without needing semver installed - npm is not
    # usable yet at this point in setup.
    local version="$1" major rest minor
    version="${version#v}"
    major="${version%%.*}"
    rest="${version#*.}"
    minor="${rest%%.*}"

    case "$major$minor" in
        *[!0-9]*) return 1 ;;
    esac

    [ "$major" -ge 24 ] && return 0
    [ "$major" -eq 22 ] && [ "$minor" -ge 13 ] && return 0
    [ "$major" -eq 20 ] && [ "$minor" -ge 19 ] && return 0
    return 1
}

say "================================================"
say "  DataForge setup"
say "  Python $PYTHON_SERIES.x   Node $NODE_RANGE"
say "================================================"
say ""

# ---------------------------------------------------------------------------
# 1. Interpreters
# ---------------------------------------------------------------------------

PYTHON="$(find_python || true)"
if [ -z "$PYTHON" ]; then
    err "No Python $PYTHON_SERIES.x was found."
    if command -v python3 >/dev/null 2>&1; then
        say "        The python3 on PATH is $(python3 -V 2>&1 | tr -d '\n')."
    fi
    say ""
    say "        Install any final Python $PYTHON_SERIES.x release, or use the default from .python-version:"
    say ""
    say "          pyenv install $PYTHON_VERSION"
    say "          pyenv local $PYTHON_VERSION"
    say ""
    say "        Already have one somewhere else? Point at it directly:"
    say "          DATAFORGE_PYTHON=/path/to/python3.13 ./setup.sh"
    exit 1
fi
ok "Python: $PYTHON ($("$PYTHON" -V 2>&1 | tr -d '\n'))"

if ! command -v node >/dev/null 2>&1; then
    fail "Node is not installed, or not on PATH. DataForge needs $NODE_RANGE."
fi
NODE_VERSION="$(node --version)"
if ! node_version_ok "$NODE_VERSION"; then
    err "Node $NODE_VERSION is outside the supported range $NODE_RANGE."
    say "        This is what the lockfile resolves to, not a preference: eslint 10"
    say "        and sass 1.103 both refuse anything older, and npm will now stop"
    say "        the install rather than fail later inside vite."
    say ""
    say "        Note that 21.x, 22.0-22.12 and 23.x are excluded too - a recent"
    say "        Node is not automatically a supported one."
    exit 1
fi
ok "Node:   $(command -v node) ($NODE_VERSION)"

if ! command -v npm >/dev/null 2>&1; then
    fail "npm is not installed, or not on PATH."
fi
say ""

# ---------------------------------------------------------------------------
# 2. Backend
# ---------------------------------------------------------------------------

if [ ! -x "$DEV_VENV_PY" ]; then
    say "Creating backend/.venv..."
    if ! "$PYTHON" -m venv "$DEV_BACKEND/.venv"; then
        err "Failed to create backend/.venv."
        say "        On Debian and Ubuntu the venv module ships separately:"
        say "          sudo apt install python3.13-venv"
        exit 1
    fi
    [ -x "$DEV_VENV_PY" ] || fail "backend/.venv was created but has no bin/python."
else
    if ! python_matches_pin "$DEV_VENV_PY"; then
        say "Recreating backend/.venv with Python $PYTHON_SERIES.x..."
        "$PYTHON" -m venv --clear "$DEV_BACKEND/.venv" || fail "Failed to recreate backend/.venv."
    else
        say "Reusing the existing backend/.venv."
    fi
fi
"$DEV_VENV_PY" "$DEV_SCRIPTS/py_version.py" || fail "backend/.venv must use Python $PYTHON_SERIES.x."

say "Upgrading pip and installing backend dependencies..."
"$DEV_VENV_PY" -m pip install --upgrade pip || fail "pip upgrade failed."
"$DEV_VENV_PY" -m pip install \
    -r "$DEV_BACKEND/requirements.txt" \
    -r "$DEV_BACKEND/requirements-dev.txt" || fail "Backend dependency installation failed."

say "Verifying FFmpeg 7.1.x..."
"$DEV_VENV_PY" "$DEV_SCRIPTS/check_ffmpeg.py" || fail "FFmpeg 7.1.x is required. Install a matching binary on PATH and run setup again."

# Dates the install, so check_backend_dependency_drift can warn when a later git pull brings
# in requirements the venv never saw. Same filename the PowerShell side reads.
date +%Y-%m-%dT%H:%M:%S%z > "$DEV_DEPS_STAMP"
say ""

# ---------------------------------------------------------------------------
# 3. Frontend
# ---------------------------------------------------------------------------

if [ -f "$DEV_FRONTEND/package-lock.json" ]; then
    say "Installing frontend dependencies (npm ci)..."
    (cd "$DEV_FRONTEND" && npm ci) || fail "Frontend npm ci failed."
else
    say "Installing frontend dependencies (npm install)..."
    (cd "$DEV_FRONTEND" && npm install) || fail "Frontend npm install failed."
fi
say ""

# ---------------------------------------------------------------------------
# 4. Generated sources
# ---------------------------------------------------------------------------

# The ordering trap this script exists to remove: these three are gitignored, two of
# them carry real values, and they come out of the backend venv - so the frontend
# cannot typecheck, build or test until the venv above exists and this has run.
say "Generating the frontend API types..."
"$DEV_VENV_PY" "$DEV_SCRIPTS/generate_types.py" || fail "Frontend type generation failed."

say ""
say "================================================"
ok  "  Setup complete."
say "  ./start.sh   run the app at $DEV_UI_URL"
say "  ./dev.sh     develop it, with hot reload"
say ""
say "  Working on DataForge itself? Install the hooks too:"
say "    sh scripts/install-git-hooks.sh"
say "================================================"
