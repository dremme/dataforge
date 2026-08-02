"""Browse response assembly — runs on a worker thread to avoid blocking the event loop."""

import logging
from pathlib import Path
from time import perf_counter

from automation.backup_captions import has_caption_backup
from constants import LAST_FOLDER_KEY
from db import get_preference, set_preference
from filesystem import build_breadcrumbs, get_home_folder, list_subfolders
from folder_fingerprint import browse_fingerprint_from_scan
from folder_scan import scan_folder
from media_listing import list_media_from_scan
from schemas import BrowseResponse, SubfolderStats, SubfolderStatsResponse
from sysprompt import load_sysprompt_item

logger = logging.getLogger(__name__)


def _remember_last_folder(folder: Path) -> None:
    """Persist the folder only when it actually changed.

    Change detection re-browses the open folder every few seconds; without this
    guard each one opened a fresh SQLite connection to rewrite the same value.
    """
    value = str(folder)
    if get_preference(LAST_FOLDER_KEY) == value:
        return
    set_preference(LAST_FOLDER_KEY, value)


def build_browse_response(folder: Path) -> BrowseResponse:
    started = perf_counter()
    _remember_last_folder(folder)

    parent = folder.parent
    parent_path = None if parent == folder else str(parent.resolve())

    # One scan feeds both the item list and the fingerprint; they used to walk
    # the directory independently and stat every file twice.
    scan = scan_folder(folder)
    scanned = perf_counter()

    if scan is None:
        subfolders: list[dict[str, str]] = []
        items: list[dict] = []
        fingerprint = ""
    else:
        # Names only: the counts come from /api/browse/subfolder-stats.
        subfolders = [{"name": entry.name, "path": str(entry.path)} for entry in scan.dirs]
        items = list_media_from_scan(scan)
        fingerprint = browse_fingerprint_from_scan(scan)
    listed = perf_counter()

    response = BrowseResponse(
        folder=str(folder),
        home=str(get_home_folder()),
        parent=parent_path,
        breadcrumbs=build_breadcrumbs(folder),
        subfolders=subfolders,
        items=items,
        sysprompt=load_sysprompt_item(folder),
        has_caption_backup=has_caption_backup(folder),
        item_count=len(items),
        subfolder_count=len(subfolders),
        fingerprint=fingerprint,
    )

    logger.debug(
        "browse %s: %d items, %d subfolders (scan %.3fs, list %.3fs, assemble %.3fs)",
        folder,
        len(items),
        len(subfolders),
        scanned - started,
        listed - scanned,
        perf_counter() - listed,
    )
    return response


def build_subfolder_stats_response(folder: Path) -> SubfolderStatsResponse:
    """Per-child media/caption counts, served separately from the browse payload.

    Counting means reading every caption sidecar in every child folder, so this
    is kept off the critical path that renders the grid.
    """
    started = perf_counter()
    subfolders = list_subfolders(folder)

    logger.debug(
        "subfolder stats %s: %d folders in %.3fs",
        folder,
        len(subfolders),
        perf_counter() - started,
    )
    return SubfolderStatsResponse(
        folder=str(folder),
        subfolders=[
            SubfolderStats(
                path=str(entry["path"]),
                file_count=int(entry["file_count"]),
                captioned_count=int(entry["captioned_count"]),
                issue_count=int(entry["issue_count"]),
            )
            for entry in subfolders
        ],
    )
