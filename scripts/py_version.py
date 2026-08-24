"""The interpreter floor, checked before anything imports the backend.

``backend/pyproject.toml`` declares ``requires-python = ">=3.12"``, but nothing ever
installs that file - it is there for ruff - so pip never enforces it. A 3.11 clone
therefore installs every dependency cleanly and only fails later, on import, with a
SyntaxError pointing at a line that looks perfectly ordinary.

The cause is PEP 695: ``backend/schemas.py`` and ``backend/media_dimensions.py`` use
``type X = ...`` statements, which 3.11 cannot parse at all. So this check has to run
*before* the first backend import, and this module has to stay parseable by every
Python it might be asked to reject - no PEP 695, no match statements, no walrus.

Entry points call ``require_python()`` at module scope, ahead of their own backend
imports (all of which happen inside functions, after a sys.path insert).
"""

from __future__ import annotations

import os
import sys

# Raise this in step with backend/pyproject.toml's requires-python and the CI matrix
# in .github/workflows/checks.yml.
MIN_PYTHON = (3, 12)


def require_python(minimum: tuple = MIN_PYTHON) -> None:
    """Exit with a readable message when the running interpreter is too old.

    Prints the interpreter path rather than just the version: the usual cause is a
    venv built by whichever ``python3`` happened to be first on PATH, and the path
    is what tells you which one that was.
    """
    if sys.version_info >= minimum:
        return

    want = ".".join(str(part) for part in minimum)
    have = ".".join(str(part) for part in sys.version_info[:3])

    # The remedy has to be runnable as printed, and the venv layout differs: a
    # Unix-shaped path on Windows sends people looking for a bin\ that is not there.
    if os.name == "nt":
        launcher = "py -%s" % want
        venv_python = r"backend\.venv\Scripts\python"
    else:
        launcher = "python%s" % want
        venv_python = "backend/.venv/bin/python"

    lines = [
        "[ERROR] DataForge needs Python %s or newer, but this is %s." % (want, have),
        "        Interpreter: %s" % sys.executable,
        "",
        "        The backend uses PEP 695 `type` statements (backend/schemas.py),",
        "        which older versions cannot parse. Dependencies install fine and",
        "        the server then fails on import, so the check happens here instead.",
        "",
        "        Recreate the venv with a newer interpreter, from the project root:",
        "          %s -m venv backend/.venv" % launcher,
        "          %s -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt" % venv_python,
    ]
    sys.stderr.write("\n".join(lines) + "\n")
    raise SystemExit(1)
