"""Move a finished temp file onto a name the gallery may still be streaming."""

from __future__ import annotations

import os
from collections.abc import Callable
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


def sweep_publish_leftovers(
    folder: Path,
    *,
    temp_suffix: str,
    stale_suffix: str,
    is_busy: Callable[[Path], bool],
) -> None:
    """Clear what a hard kill left behind, without touching another file's write in progress.

    A stale file whose live file is gone is the only copy of a failed publish, so it is moved
    back rather than deleted.
    """
    with suppress(OSError):
        for suffix in (temp_suffix, stale_suffix):
            for leftover in folder.glob(f"*{suffix}"):
                owner = leftover.with_name(leftover.name.removesuffix(suffix))
                if is_busy(owner):
                    continue
                with suppress(OSError):
                    if suffix == stale_suffix and not owner.exists():
                        os.replace(leftover, owner)
                    else:
                        leftover.unlink(missing_ok=True)
