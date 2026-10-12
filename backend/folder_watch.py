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

#: How often the feed looks for folders that are due; well under ``MIN_INTERVAL_SECONDS``.
TICK_SECONDS = 0.25

#: Scans run side by side, so a folder on a dead drive delays only itself.
WATCH_WORKERS = 4

#: A disconnected network drive blocks for the SMB timeout; retrying every second helps nobody.
#: Only an unreadable folder backs off: a big one on a slow drive is paced by its scan time.
SLOW_SCAN_SECONDS = 1.0
BACKOFF_SECONDS = 30.0

#: Pushed for a folder that cannot be read; the client's re-read then reports the error.
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

    watchers: dict[str, set[str]] = {}
    for tab_id, folders in list(_watches.items()):
        for folder, seen in list(folders.items()):
            if seen < cutoff:
                del folders[folder]
            elif tab_id in connected:
                watchers.setdefault(folder, set()).add(tab_id)

        if not folders:
            del _watches[tab_id]

    return watchers


def clear_watches_for_tests() -> None:
    _watches.clear()


def _scan(folder: str) -> str:
    return compute_folder_fingerprint(Path(folder)) or UNREADABLE_FINGERPRINT


async def run_folder_watch_feed() -> None:
    """Push every watched folder's fingerprint whenever it changes."""
    seen: dict[str, str] = {}
    #: When each folder may be scanned again; each is paced by its own scan, not the slowest.
    due: dict[str, float] = {}
    scanning: dict[str, asyncio.Task[None]] = {}

    # Not the default executor: ``os.scandir`` on a disconnected drive would block the API.
    executor = ThreadPoolExecutor(max_workers=WATCH_WORKERS, thread_name_prefix="folder-watch")
    loop = asyncio.get_running_loop()

    async def scan(folder: str) -> None:
        started = time.monotonic()
        try:
            fingerprint = await loop.run_in_executor(executor, _scan, folder)
        except Exception:
            logger.debug("Folder scan failed for %s", folder, exc_info=True)
            due[folder] = time.monotonic() + BACKOFF_SECONDS
            return

        elapsed = time.monotonic() - started
        if elapsed >= SLOW_SCAN_SECONDS and fingerprint == UNREADABLE_FINGERPRINT:
            pause = BACKOFF_SECONDS
        else:
            pause = min(
                max(elapsed * INTERVAL_SCAN_RATIO, MIN_INTERVAL_SECONDS), MAX_INTERVAL_SECONDS
            )
        due[folder] = time.monotonic() + pause

        # Asked now, not when the scan began: a slow scan outlives navigations and tabs.
        tab_ids = watchers_by_folder().get(folder)
        if not tab_ids or seen.get(folder) == fingerprint:
            return

        seen[folder] = fingerprint
        events.publish_to_tabs(
            tab_ids,
            FolderEvent(path=folder, fingerprint=fingerprint).model_dump(),
        )

    def finished(folder: str, task: asyncio.Task[None]) -> None:
        scanning.pop(folder, None)
        if not task.cancelled() and task.exception() is not None:
            logger.error("Folder watch failed for %s", folder, exc_info=task.exception())

    try:
        while True:
            watchers = watchers_by_folder()
            if not watchers:
                # Next watcher hydrates over REST and must not miss a change made while idle.
                seen.clear()
                due.clear()
                await asyncio.sleep(IDLE_INTERVAL_SECONDS)
                continue

            now = time.monotonic()
            for folder in watchers:
                # One scan per folder at a time: a blocked one holds a worker, never a queue.
                if folder in scanning or due.get(folder, 0.0) > now:
                    continue
                task = asyncio.create_task(scan(folder))
                scanning[folder] = task
                task.add_done_callback(lambda done, folder=folder: finished(folder, done))

            for folder in [name for name in seen.keys() | due.keys() if name not in watchers]:
                seen.pop(folder, None)
                due.pop(folder, None)

            await asyncio.sleep(TICK_SECONDS)
    finally:
        for task in scanning.values():
            task.cancel()
        executor.shutdown(wait=False)
