from __future__ import annotations

import sys
from pathlib import Path


def require_python() -> None:
    backend = str(Path(__file__).resolve().parent.parent / "backend")
    sys.path.insert(0, backend)
    try:
        from python_version import require_python as require_supported_python

        require_supported_python()
    finally:
        sys.path.remove(backend)


if __name__ == "__main__":
    require_python()
