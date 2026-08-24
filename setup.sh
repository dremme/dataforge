#!/usr/bin/env bash
#
# Installs every dependency for a fresh Unix clone: the venv, the backend packages,
# the npm packages, and the three generated frontend sources.
#
# This is not a port of setup.ps1. That script downloads portable runtimes into
# .python/ and .node/ because a Windows box may have neither and installing them
# needs UAC. On macOS and Linux a real python3 and node are the normal case, so this
# checks the ones already installed and says exactly what is wrong when they are too
# old - which is the failure a fresh clone actually hits, since nothing else enforces
# the version floors until something breaks much later.
#
# Usage: ./setup.sh

set -eo pipefail

# shellcheck source=scripts/dev-common.sh
. "$(cd "$(dirname "$0")" && pwd)/scripts/dev-common.sh"

# Keep in step with backend/pyproject.toml (requires-python) and scripts/py_version.py.
MIN_PY_MAJOR=3
MIN_PY_MINOR=12

# Keep in step with the engines range in frontend/package.json. Both come from what
# the lockfile actually resolves: eslint 10 and sass 1.101.
NODE_RANGE="^20.19.0 || ^22.13.0 || >=24"

fail() {
    say ""
    err "$*"
    exit 1
}

python_is_new_enough() {
    "$1" -c "import sys; raise SystemExit(0 if sys.version_info >= ($MIN_PY_MAJOR, $MIN_PY_MINOR) else 1)" \
        >/dev/null 2>&1
}

find_python() {
    # Newest first, so a box with several interpreters gets the best one rather than
    # whichever bare `python3` happens to be on PATH - that is usually the distro
    # one, and on Debian 12 or RHEL 9 it is exactly the 3.11 that cannot parse the
    # backend. DATAFORGE_PYTHON overrides the search entirely.
    local candidate
    if [ -n "$DATAFORGE_PYTHON" ]; then
        if python_is_new_enough "$DATAFORGE_PYTHON"; then
            printf '%s\n' "$DATAFORGE_PYTHON"
            return 0
        fi
        return 1
    fi
    for candidate in python3.14 python3.13 python3.12 python3 python; do
        if command -v "$candidate" >/dev/null 2>&1 && python_is_new_enough "$candidate"; then
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
say "  Python >= $MIN_PY_MAJOR.$MIN_PY_MINOR   Node $NODE_RANGE"
say "================================================"
say ""

# ---------------------------------------------------------------------------
# 1. Interpreters
# ---------------------------------------------------------------------------

PYTHON="$(find_python || true)"
if [ -z "$PYTHON" ]; then
    err "No Python $MIN_PY_MAJOR.$MIN_PY_MINOR or newer was found."
    if command -v python3 >/dev/null 2>&1; then
        say "        The python3 on PATH is $(python3 -V 2>&1 | tr -d '\n')."
    fi
    say ""
    say "        The backend uses PEP 695 syntax that older versions cannot parse,"
    say "        so this is a hard floor rather than a preference."
    say ""
    say "          macOS    brew install python@3.12"
    say "          Debian   sudo apt install python3.12 python3.12-venv"
    say "          Fedora   sudo dnf install python3.12"
    say "          anywhere pyenv install 3.12"
    say ""
    say "        Already have one somewhere else? Point at it directly:"
    say "          DATAFORGE_PYTHON=/path/to/python3.12 ./setup.sh"
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
    say "        and sass 1.101 both refuse anything older, and npm will now stop"
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
        say "          sudo apt install python3.12-venv"
        exit 1
    fi
    [ -x "$DEV_VENV_PY" ] || fail "backend/.venv was created but has no bin/python."
else
    # An existing venv can predate the floor - it is built against whichever
    # interpreter created it, and nothing rebuilds it on an upgrade.
    if ! python_is_new_enough "$DEV_VENV_PY"; then
        err "backend/.venv runs $("$DEV_VENV_PY" -V 2>&1 | tr -d '\n'), which is too old."
        say "        Delete it and run this again to rebuild it with $PYTHON:"
        say "          rm -rf backend/.venv && ./setup.sh"
        exit 1
    fi
    say "Reusing the existing backend/.venv."
fi

say "Upgrading pip and installing backend dependencies..."
"$DEV_VENV_PY" -m pip install --upgrade pip || fail "pip upgrade failed."
"$DEV_VENV_PY" -m pip install \
    -r "$DEV_BACKEND/requirements.txt" \
    -r "$DEV_BACKEND/requirements-dev.txt" || fail "Backend dependency installation failed."

# Dates the install, so check_dependency_drift can warn when a later git pull brings
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
