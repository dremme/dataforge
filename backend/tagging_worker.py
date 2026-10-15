"""Tags the media in favorite folders in the background, never their subfolders.

One daemon thread owns the model. Each step rescans the favorites, then tags for a short budget
before looking again, so a new favorite or a new file is picked up within one step. A result
lands in ``media_tags``, whose revision moves the folder fingerprint and so reaches open tabs.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import events
from folder_favorites import get_folder_favorite_paths
from folder_scan import ScannedEntry, get_media_type, scan_folder
from media_tags import folder_tag_rows, forget_media_tags, save_media_tags
from schemas import TaggingEvent, TaggingState, TaggingStatusResponse
from tagger import (
    MISSING_REQUIREMENTS,
    TagModel,
    load_media_frames,
    load_vocabulary,
    select_model_name,
    tagging_requirements_installed,
    vocabulary_id,
)

logger = logging.getLogger(__name__)

#: How long one step tags before rescanning the favorites.
STEP_BUDGET_SECONDS = 5.0

#: How often the favorites are rescanned once everything in them is tagged.
IDLE_SECONDS = 15.0

#: After a model that would not load, or one that kept failing, before trying again.
FAILURE_BACKOFF_SECONDS = 300.0

#: Installing the requirements needs a restart anyway; this only keeps the status honest.
UNAVAILABLE_RECHECK_SECONDS = 60.0

LOADING_DETAIL = "The first load downloads the model, about 500 MB."

#: Files that fail in a row before the model, not the files, is taken to be the problem.
MAX_CONSECUTIVE_FAILURES = 3


@dataclass(frozen=True)
class PendingFile:
    folder: Path
    entry: ScannedEntry
    media_type: str


def pending_in_folder(folder: Path, vocabulary: str) -> list[PendingFile]:
    """Files without current tags. Rows for files that left the folder are dropped on the way."""
    scan = scan_folder(folder)
    if scan is None:
        return []

    rows = folder_tag_rows(folder)
    gone = rows.keys() - {entry.name for entry in scan.media}
    if gone:
        forget_media_tags(folder, gone)

    pending: list[PendingFile] = []
    for entry in scan.media:
        media_type = get_media_type(entry.path)
        if media_type is None or media_type == "audio":
            continue
        row = rows.get(entry.name)
        if (
            row is None
            or row.vocabulary != vocabulary
            or not row.matches(entry.mtime_ns, entry.size)
        ):
            pending.append(PendingFile(folder, entry, media_type))
    return pending


def favorite_folders() -> list[Path]:
    return [path for path in map(Path, get_folder_favorite_paths()) if path.is_dir()]


class TaggingWorker:
    """``step`` runs on the worker thread; ``status`` is safe from any thread."""

    def __init__(
        self,
        model_factory: Callable[[list[str], str], TagModel] = TagModel,
        vocabulary_loader: Callable[[], list[str]] = load_vocabulary,
        requirements_check: Callable[[], bool] = tagging_requirements_installed,
        model_selector: Callable[[], str] = select_model_name,
    ) -> None:
        self._model_factory = model_factory
        self._vocabulary_loader = vocabulary_loader
        self._requirements_check = requirements_check
        self._model_selector = model_selector
        self._model: TagModel | None = None
        self._model_vocabulary = ""
        self._lock = threading.Lock()
        self._status = TaggingStatusResponse(state="idle", model="", vocabulary_size=0, pending=0)

    def status(self) -> TaggingStatusResponse:
        with self._lock:
            return self._status.model_copy()

    def _report(
        self,
        state: TaggingState,
        *,
        detail: str = "",
        folder: Path | None = None,
        **changes: int | str,
    ) -> None:
        """Pushes only a new state or folder; the per-file count is read when someone asks."""
        with self._lock:
            before = self._status
            self._status = before.model_copy(
                update={
                    "state": state,
                    "detail": detail,
                    "folder": None if folder is None else str(folder),
                    **changes,
                }
            )
            current = self._status
        if (current.state, current.folder) != (before.state, before.folder):
            events.publish(TaggingEvent(status=current).model_dump())

    def step(self) -> float:
        """Does one round of work; returns how long to wait before the next."""
        terms = self._vocabulary_loader()
        if not self._requirements_check():
            self._report(
                "unavailable", detail=MISSING_REQUIREMENTS, pending=0, vocabulary_size=len(terms)
            )
            return UNAVAILABLE_RECHECK_SECONDS

        model_name = self._model_selector()
        vocabulary = vocabulary_id(terms, model_name)
        pending = [
            file for folder in favorite_folders() for file in pending_in_folder(folder, vocabulary)
        ]
        if not pending:
            self._report("idle", pending=0, vocabulary_size=len(terms), model=model_name)
            # Freed as soon as the favorites are done, so its VRAM goes back to other tools.
            self.close()
            return IDLE_SECONDS

        if self._model is None or self._model_vocabulary != vocabulary:
            self.close()
            self._report(
                "loading",
                detail=LOADING_DETAIL,
                folder=pending[0].folder,
                pending=len(pending),
                vocabulary_size=len(terms),
                model=model_name,
            )
            try:
                self._model = self._model_factory(terms, model_name)
            except Exception as error:
                logger.exception("Tagging model failed to load")
                self._report("failed", detail=f"The tagging model failed to load: {error}")
                return FAILURE_BACKOFF_SECONDS
            self._model_vocabulary = vocabulary

        return self._tag(self._model, pending, vocabulary)

    def _tag(self, model: TagModel, pending: list[PendingFile], vocabulary: str) -> float:
        deadline = time.monotonic() + STEP_BUDGET_SECONDS
        failures = 0
        for done, file in enumerate(pending):
            if time.monotonic() > deadline:
                break
            self._report("tagging", folder=file.folder, pending=len(pending) - done)
            try:
                tags = model.tag_frames(load_media_frames(file.entry.path, file.media_type))
                failures = 0
            except Exception as error:
                failures += 1
                logger.warning("Tagging failed for %s", file.entry.path, exc_info=True)
                if failures >= MAX_CONSECUTIVE_FAILURES:
                    self.close()
                    self._report("failed", detail=f"Tagging keeps failing: {error}")
                    return FAILURE_BACKOFF_SECONDS
                # Stored empty, so one undecodable file is not retried until it changes.
                tags = []
            save_media_tags(
                file.folder,
                file.entry.name,
                mtime_ns=file.entry.mtime_ns,
                size=file.entry.size,
                vocabulary=vocabulary,
                tags=tags,
            )

        return 0.0

    def close(self) -> None:
        if self._model is not None:
            self._model.close()
            self._model = None
            self._model_vocabulary = ""


_worker = TaggingWorker()


def tagging_status() -> TaggingStatusResponse:
    return _worker.status()


def _run(worker: TaggingWorker, stop: threading.Event) -> None:
    while not stop.is_set():
        try:
            delay = worker.step()
        except Exception:
            logger.exception("Tagging step failed")
            delay = FAILURE_BACKOFF_SECONDS
        stop.wait(delay)
    worker.close()


#: Set by the E2E backend: a fresh database's default favorite is the real home folder.
DISABLE_TAGGING_ENV = "DATAFORGE_DISABLE_TAGGING"


def tagging_disabled() -> bool:
    return os.environ.get(DISABLE_TAGGING_ENV, "").strip().lower() in {"1", "true", "yes", "on"}


def start_tagging_worker() -> Callable[[], None]:
    """Returns the stop function. A daemon thread: a long model load must not hold up shutdown."""
    if tagging_disabled():
        _worker._report("unavailable", detail=f"Tagging is turned off by {DISABLE_TAGGING_ENV}.")
        return lambda: None
    stop = threading.Event()
    threading.Thread(target=_run, args=(_worker, stop), name="tagging", daemon=True).start()
    return stop.set
