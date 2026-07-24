from __future__ import annotations

import logging
from pathlib import Path

from captions import issue_file_path
from constants import SIDECAR_EXTENSIONS

logger = logging.getLogger(__name__)


def delete_media_with_sidecars(file_path: Path) -> dict[str, object]:
    deleted: list[str] = []

    try:
        file_path.unlink()
    except OSError as exc:
        raise OSError(f"Failed to delete {file_path.name}: {exc}") from exc

    deleted.append(file_path.name)

    for extension in SIDECAR_EXTENSIONS:
        sidecar = file_path.with_suffix(extension)
        if not sidecar.is_file():
            continue
        try:
            sidecar.unlink()
            deleted.append(sidecar.name)
        except OSError as exc:
            logger.warning("Failed to delete sidecar %s: %s", sidecar.name, exc)

    issue_sidecar = issue_file_path(file_path)
    if issue_sidecar.is_file():
        try:
            issue_sidecar.unlink()
            deleted.append(issue_sidecar.name)
        except OSError as exc:
            logger.warning("Failed to delete issue sidecar %s: %s", issue_sidecar.name, exc)

    return {
        "path": str(file_path),
        "deleted": deleted,
    }
