"""Folder listing assembly; runs on a worker thread so it does not block the event loop."""

import logging
from pathlib import Path
from time import perf_counter

from automation.backup_captions import has_caption_backup
from constants import LAST_FOLDER_KEY
from db import get_preference, set_preference
from filesystem import build_breadcrumbs, get_home_folder, list_subfolders
from folder_fingerprint import (
    folder_signature_from_scan,
    recall_folder_signature,
    remember_folder_signature,
)
from folder_scan import scan_folder
from media_listing import list_media_from_scan, media_items_named
from schemas import FolderChangesResponse, FolderResponse, SubfolderStats, SubfolderStatsResponse
from sysprompt import load_sysprompt_item

logger = logging.getLogger(__name__)


def _remember_last_folder(folder: Path) -> None:
    """Skip the write when the value is unchanged; change detection re-lists every few seconds."""
    value = str(folder)
    if get_preference(LAST_FOLDER_KEY) == value:
        return
    set_preference(LAST_FOLDER_KEY, value)


def build_folder_response(folder: Path) -> FolderResponse:
    started = perf_counter()
    _remember_last_folder(folder)

    parent = folder.parent
    parent_path = None if parent == folder else str(parent.resolve())

    scan = scan_folder(folder)
    scanned = perf_counter()

    if scan is None:
        subfolders: list[dict[str, str]] = []
        items: list[dict] = []
        fingerprint = ""
    else:
        # Names only: the counts come from /api/folders/subfolder-stats.
        subfolders = [{"name": entry.name, "path": str(entry.path)} for entry in scan.dirs]
        items = list_media_from_scan(scan)
        signature = folder_signature_from_scan(scan)
        remember_folder_signature(folder, signature)
        fingerprint = signature.fingerprint
    listed = perf_counter()

    response = FolderResponse(
        path=str(folder),
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
        "folder %s: %d items, %d subfolders (scan %.3fs, list %.3fs, assemble %.3fs)",
        folder,
        len(items),
        len(subfolders),
        scanned - started,
        listed - scanned,
        perf_counter() - listed,
    )
    return response


def build_folder_changes(folder: Path, since: str) -> FolderChangesResponse:
    """Answers ``full`` when there is nothing to diff against (unknown baseline, unreadable folder, or a shell change)."""
    scan = scan_folder(folder)
    if scan is None:
        return FolderChangesResponse(full=True, fingerprint="")

    signature = folder_signature_from_scan(scan)
    remember_folder_signature(folder, signature)

    baseline = recall_folder_signature(folder, since)
    if baseline is None or baseline.shell != signature.shell:
        return FolderChangesResponse(full=True, fingerprint=signature.fingerprint)

    changed = {name for name, item in signature.items.items() if baseline.items.get(name) != item}
    removed = sorted(baseline.items.keys() - signature.items.keys())

    return FolderChangesResponse(
        full=False,
        fingerprint=signature.fingerprint,
        changed=media_items_named(scan, changed),
        removed=[str(folder / name) for name in removed],
    )


def build_subfolder_stats_response(folder: Path) -> SubfolderStatsResponse:
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
