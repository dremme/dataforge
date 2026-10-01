from __future__ import annotations

import os
import sys
from pathlib import Path

_PIN_FILE = Path(__file__).resolve().parent.parent / ".python-version"
PINNED_PYTHON = tuple(
    int(part) for part in _PIN_FILE.read_text(encoding="ascii").strip().split(".")
)
SUPPORTED_PYTHON = PINNED_PYTHON[:2]


def require_python() -> None:
    if sys.version_info[:2] == SUPPORTED_PYTHON and sys.version_info[3] == "final":
        return

    want = ".".join(str(part) for part in SUPPORTED_PYTHON) + ".x"
    have = ".".join(str(part) for part in sys.version_info[:3])
    if sys.version_info[3] != "final":
        have += f" ({sys.version_info[3]}{sys.version_info[4]})"
    setup = "setup.bat" if os.name == "nt" else "./setup.sh"
    lines = [
        f"[ERROR] DataForge requires Python {want}, but this is {have}.",
        f"        Interpreter: {sys.executable}",
        "        .python-version records the default release for CI and Windows setup.",
        f"        Install a supported release and run {setup} to recreate an incompatible venv.",
    ]
    sys.stderr.write("\n".join(lines) + "\n")
    raise SystemExit(1)
