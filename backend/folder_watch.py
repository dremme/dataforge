from __future__ import annotations

import asyncio
import logging
import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import events
from filesystem import looks_like_windows_path, preference_folder_key
from folder_fingerprint import compute_folder_fingerprint
from schemas import FolderEvent

logger = logging.getLogger(__name__)

#: Must outlast a hidden tab's safety poll, or a quiet tab would stop being watched.
WATCH_TTL_SECONDS = 120.0

#: Floor bounds how fast a change is noticed; ceiling stops a slow scan from running back-to-back.
MIN_INTERVAL_SECONDS = 1.0
MAX_INTERVAL_SECONDS = 10.0

#: Pass cost relative to the scan it just did, so a big folder does not spend a core on watching.
INTERVAL_SCAN_RATIO = 4.0

IDLE_INTERVAL_SECONDS = 5.0

#: A disconnected network drive blocks for the SMB timeout; retrying every second helps nobody.
SLOW_SCAN_SECONDS = 1.0
BACKOFF_SECONDS = 30.0

#: Matches the fingerprint ``build_folder_changes`` returns for an unreadable folder.
UNREADABLE_FINGERPRINT = ""

_watches: dict[str, dict[str, float]] = {}

#: A navigation leaves the previous folder behind for a moment; holding a couple avoids a miss.
MAX_FOLDERS_PER_TAB = 3


def watch_key(path: str) -> str:
    """Windows paths fold with ``lower``, not ``casefold``: ``Straße`` and ``Strasse`` are distinct folders."""
    key = preference_folder_key(path)
    if os.name == "nt" or looks_like_windows_path(key):
        return key.lower()
    return key


def touch(tab_id: str, path: str) -> None:
    """Record that ``tab_id`` is looking at ``path``."""
    key = watch_key(path)
    # A blank path would scan the process cwd and publish a path no client can match.
    if not tab_id or not key:
        return

    folders = _watches.setdefault(tab_id, {})
    folders[key] = time.monotonic()

    if len(folders) > MAX_FOLDERS_PER_TAB:
        for folder in sorted(folders, key=folders.__getitem__)[:-MAX_FOLDERS_PER_TAB]:
            del folders[folder]


def watchers_by_folder() -> dict[str, set[str]]:
    """Watched folders, each with the tabs to notify. Only tabs holding a live stream count."""
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

    # Not the default executor: ``os.scandir`` on a disconnected drive would block the API.
    executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="folder-watch")
    loop = asyncio.get_running_loop()

    try:
        while True:
            watchers = watchers_by_folder()
            if not watchers:
                # Next watcher hydrates over REST and must not miss a change made while idle.
                seen.clear()
                retry_after.clear()
                await asyncio.sleep(IDLE_INTERVAL_SECONDS)
                continue

            slowest = 0.0
            now = time.monotonic()

            # Sequentially: one blocking folder must not take the private worker's whole queue.
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

            # Against the live set: a folder added mid-pass would otherwise lose its memo.
            still_watched = watchers_by_folder()
            for folder in [name for name in seen if name not in still_watched]:
                del seen[folder]
                retry_after.pop(folder, None)

            await asyncio.sleep(
                min(max(slowest * INTERVAL_SCAN_RATIO, MIN_INTERVAL_SECONDS), MAX_INTERVAL_SECONDS)
            )
    finally:
        executor.shutdown(wait=False)
