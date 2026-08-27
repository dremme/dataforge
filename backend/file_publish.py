"""Move a finished temp file onto a name the gallery may still be streaming."""

from __future__ import annotations

import os
from contextlib import suppress
from pathlib import Path


def publish_replacing(temp_path: Path, final_path: Path, stale_path: Path) -> None:
    """``os.replace`` onto a streamed path fails on Windows (WinError 5); rename the destination out of the way first."""
    try:
        os.replace(temp_path, final_path)
        return
    except OSError:
        if not final_path.exists():
            raise

    with suppress(OSError):
        stale_path.unlink(missing_ok=True)

    os.replace(final_path, stale_path)
    try:
        os.replace(temp_path, final_path)
    except OSError:
        with suppress(OSError):
            os.replace(stale_path, final_path)
        raise

    with suppress(OSError):
        stale_path.unlink(missing_ok=True)
