"""Moving a finished temp file onto a name the gallery may still be streaming."""

from __future__ import annotations

import os
from contextlib import suppress
from pathlib import Path


def publish_replacing(temp_path: Path, final_path: Path, stale_path: Path) -> None:
    """Move ``temp_path`` onto ``final_path``, displacing an open destination if needed.

    ``os.replace`` onto a path the gallery is still streaming fails on Windows with
    WinError 5, even when the open handle shares delete (see ``media_file_response``).
    Renaming that open destination out of the way first succeeds, so the new file can
    take its name.

    ``stale_path`` is supplied rather than derived so this carries no naming policy:
    each caller keeps its own marker convention.
    """
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
