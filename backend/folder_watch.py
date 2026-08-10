"""Which folders are being looked at, and pushing them when they change on disk.

Clients used to poll ``/api/folders/fingerprint`` every few seconds each. One task
does that here instead and pushes the result, so the cost is one directory scan per
watched folder rather than one per folder per tab.

Interest is inferred rather than registered: the folder requests a client already makes
say which folder it is on, so there is no separate registration to get out of order,
to redo after a reconnect, or to race against a navigation.
"""

from __future__ import annotations

import asyncio
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import events
from filesystem import normalize_user_path
from folder_fingerprint import compute_folder_fingerprint
from schemas import FolderEvent

logger = logging.getLogger(__name__)

#: How long a folder stays watched after a tab last mentioned it. Must outlast the
#: slowest client cadence, which is a hidden tab's safety poll, or a tab that goes quiet
#: would stop being watched while still looking at the folder.
WATCH_TTL_SECONDS = 120.0

#: Floor and ceiling for the interval between passes. The floor bounds how fast a
#: change is noticed; the ceiling stops a folder that scans slowly from being scanned
#: back-to-back forever.
MIN_INTERVAL_SECONDS = 1.0
MAX_INTERVAL_SECONDS = 10.0

#: What a pass costs relative to the scan it just did. Keeps a big folder from spending
#: a meaningful share of a core on being watched.
INTERVAL_SCAN_RATIO = 4.0

#: How long to wait before looking again for a first watcher.
IDLE_INTERVAL_SECONDS = 5.0

#: Backoff for a folder whose scan failed or dragged. A disconnected network drive
#: blocks for the SMB timeout, and retrying that every second helps nobody.
SLOW_SCAN_SECONDS = 1.0
BACKOFF_SECONDS = 30.0

#: What a folder that cannot be read reports. Matches the fingerprint
#: ``build_folder_changes`` returns for the same case, so the client answers it with
#: the reload it would have done anyway.
UNREADABLE_FINGERPRINT = ""

#: ``tab id -> {folder -> last mentioned}``. Keyed by tab so an event can be addressed
#: to the tab that is actually looking at that folder.
_watches: dict[str, dict[str, float]] = {}

#: The most recent folders one tab is credited with. A navigation leaves the previous
#: folder behind for a moment, and holding a couple means a client is never missed
#: because its registration arrived a beat late.
MAX_FOLDERS_PER_TAB = 3


def watch_key(path: str) -> str:
    """One folder, one key, however the client happened to spell it.

    ``normalize_user_path`` settles separators and the drive letter, but Windows is
    case-insensitive the rest of the way too, so ``C:\\Photos`` and ``c:/photos`` are
    the same directory and must not be scanned - or published - twice. POSIX is
    case-sensitive, where folding would merge two genuinely different folders.
    """
    normalized = str(normalize_user_path(path))
    return normalized.casefold() if os.name == "nt" else normalized


def touch(tab_id: str, path: str) -> None:
    """Record that ``tab_id`` is looking at ``path``."""
    if not tab_id:
        return

    folders = _watches.setdefault(tab_id, {})
    folders[watch_key(path)] = time.monotonic()

    if len(folders) > MAX_FOLDERS_PER_TAB:
        for folder in sorted(folders, key=folders.__getitem__)[:-MAX_FOLDERS_PER_TAB]:
            del folders[folder]


def watchers_by_folder() -> dict[str, set[str]]:
    """Watched folders, each with the tabs to notify.

    Only tabs holding a live stream count. A tab that has closed its stream - which is
    what a backgrounded one does - must not keep the server scanning on its behalf.
    """
    connected = events.connected_tab_ids()
    cutoff = time.monotonic() - WATCH_TTL_SECONDS

    for tab_id in [tab for tab in _watches if tab not in connected]:
        del _watches[tab_id]

    watchers: dict[str, set[str]] = {}
    for tab_id, folders in _watches.items():
        for folder, seen in list(folders.items()):
            if seen < cutoff:
                del folders[folder]
                continue
            watchers.setdefault(folder, set()).add(tab_id)

    return watchers


def clear_watches_for_tests() -> None:
    _watches.clear()


def _scan(folder: str) -> str:
    return compute_folder_fingerprint(Path(folder)) or UNREADABLE_FINGERPRINT


async def run_folder_watch_feed() -> None:
    """Push every watched folder's fingerprint whenever it changes."""
    seen: dict[str, str] = {}
    retry_after: dict[str, float] = {}

    # Deliberately not the default executor: that one also serves folder listings,
    # thumbnails and media, and ``os.scandir`` on a disconnected network drive blocks
    # for the SMB timeout. A private worker bounds that to "folder push stops working"
    # instead of "the API stops responding".
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="folder-watch")
    loop = asyncio.get_running_loop()

    try:
        while True:
            watchers = watchers_by_folder()
            if not watchers:
                # Forget what was last seen: the next watcher hydrates over REST and
                # must not miss a change made while nobody was looking.
                seen.clear()
                retry_after.clear()
                await asyncio.sleep(IDLE_INTERVAL_SECONDS)
                continue

            slowest = 0.0
            now = time.monotonic()

            # Sequentially, never gathered: one folder that blocks must not take the
            # private worker's whole queue with it.
            for folder, tab_ids in watchers.items():
                if retry_after.get(folder, 0.0) > now:
                    continue

                started = time.monotonic()
                try:
                    fingerprint = await loop.run_in_executor(executor, _scan, folder)
                except Exception:
                    logger.debug("Folder scan failed for %s", folder, exc_info=True)
                    retry_after[folder] = time.monotonic() + BACKOFF_SECONDS
                    continue

                elapsed = time.monotonic() - started
                slowest = max(slowest, elapsed)
                if elapsed >= SLOW_SCAN_SECONDS:
                    retry_after[folder] = time.monotonic() + BACKOFF_SECONDS

                if seen.get(folder) == fingerprint:
                    continue

                seen[folder] = fingerprint
                events.publish_to_tabs(
                    tab_ids,
                    FolderEvent(path=folder, fingerprint=fingerprint).model_dump(),
                )

            # Against the live set, not the one just iterated: a folder added mid-pass
            # would otherwise lose the memo it never had a chance to use. Resolved once,
            # or the comprehension would rebuild it for every remembered folder.
            still_watched = watchers_by_folder()
            for folder in [name for name in seen if name not in still_watched]:
                del seen[folder]
                retry_after.pop(folder, None)

            await asyncio.sleep(
                min(max(slowest * INTERVAL_SCAN_RATIO, MIN_INTERVAL_SECONDS), MAX_INTERVAL_SECONDS)
            )
    finally:
        executor.shutdown(wait=False)
