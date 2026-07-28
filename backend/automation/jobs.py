"""Background job queue with SQLite-backed progress tracking."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from automation.auto_caption import run_auto_caption_job, validate_auto_caption_folder
from automation.batch_rename import run_batch_rename_job, validate_batch_rename_folder
from automation.body_parts import (
    list_body_parts_images,
    run_body_parts_job,
    validate_body_parts_folder,
)
from automation.job_messages import (
    auto_caption_error_message,
    batch_rename_error_message,
    body_parts_error_message,
    resolve_job_error,
    set_captions_error_message,
    strip_metadata_error_message,
    verify_captions_failure_message,
)
from automation.jobs_store import (
    delete_all_jobs as delete_all_jobs_from_store,
)
from automation.jobs_store import (
    delete_job as delete_job_from_store,
)
from automation.jobs_store import (
    delete_jobs_for_folder as delete_jobs_for_folder_from_store,
)
from automation.jobs_store import (
    get_active_job_for_folder as get_active_job_for_folder_from_store,
)
from automation.jobs_store import (
    get_job as get_job_from_store,
)
from automation.jobs_store import (
    get_latest_job_for_folder as get_latest_job_for_folder_from_store,
)
from automation.jobs_store import (
    list_jobs as list_jobs_from_store,
)
from automation.jobs_store import (
    prune_duplicate_jobs,
    recover_stale_jobs,
    save_job,
)
from automation.set_captions import run_set_captions_job, validate_set_captions_folder
from automation.strip_metadata import run_strip_metadata_job, validate_strip_metadata_folder
from automation.verify_captions import run_verify_captions_job, validate_verify_captions_folder
from filesystem import normalize_user_path, path_leaf_name

JobStatus = Literal["queued", "running", "completed", "failed", "cancelled", "interrupted"]
JobType = Literal[
    "auto_caption",
    "body_parts",
    "strip_metadata",
    "set_captions",
    "verify_captions",
    "batch_rename",
]
ACTIVE_STATUSES = frozenset({"queued", "running"})


def _utc_now() -> str:
    return datetime.now(tz=UTC).isoformat()


def _normalize_folder(folder: str) -> str:
    return str(normalize_user_path(folder))


def _folder_name(folder: str) -> str:
    return path_leaf_name(folder)


def _resolve_verify_captions_status(job: Job, cancelled: bool) -> tuple[JobStatus, str | None]:
    if cancelled:
        return "cancelled", None
    message = verify_captions_failure_message(job.stats)
    if message:
        return "failed", message
    return "completed", None


def _resolve_api_errors(stat_key: str, message: Callable[[int], str]) -> StatusResolver:
    def resolve(job: Job, cancelled: bool) -> tuple[JobStatus, str | None]:
        if cancelled:
            return "cancelled", None
        count = int(job.stats.get(stat_key) or 0)
        if count > 0:
            return "failed", message(count)
        return "completed", None

    return resolve


def _resolve_stats_errors(message: Callable[[dict[str, int]], str | None]) -> StatusResolver:
    def resolve(job: Job, cancelled: bool) -> tuple[JobStatus, str | None]:
        if cancelled:
            return "cancelled", None
        error_message = message(job.stats)
        if error_message:
            return "failed", error_message
        return "completed", None

    return resolve


@dataclass
class Job:
    id: str
    folder: str
    status: JobStatus = "queued"
    total: int = 0
    processed: int = 0
    current_file: str | None = None
    current_name: str | None = None
    stats: dict[str, int] = field(default_factory=dict)
    results: list[dict[str, object]] = field(default_factory=list)
    error: str | None = None
    created_at: str = field(default_factory=_utc_now)
    started_at: str | None = None
    finished_at: str | None = None
    job_type: JobType = "auto_caption"
    auto_caption_mode: str | None = None

    @classmethod
    def from_dict(cls, data: dict[str, object]) -> Job:
        stats = data.get("stats") or {}
        results = data.get("results") or []
        return cls(
            id=str(data["id"]),
            folder=str(data["folder"]),
            status=data["status"],  # type: ignore[arg-type]
            total=int(data.get("total") or 0),
            processed=int(data.get("processed") or 0),
            current_file=data.get("current_file"),  # type: ignore[arg-type]
            current_name=data.get("current_name"),  # type: ignore[arg-type]
            stats=dict(stats) if isinstance(stats, dict) else {},
            results=list(results) if isinstance(results, list) else [],
            error=data.get("error"),  # type: ignore[arg-type]
            created_at=str(data["created_at"]),
            started_at=data.get("started_at"),  # type: ignore[arg-type]
            finished_at=data.get("finished_at"),  # type: ignore[arg-type]
            job_type=data.get("job_type", "auto_caption"),  # type: ignore[arg-type]
            auto_caption_mode=data.get("auto_caption_mode"),  # type: ignore[arg-type]
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "id": self.id,
            "folder": self.folder,
            "folder_name": _folder_name(self.folder),
            "job_type": self.job_type,
            "status": self.status,
            "total": self.total,
            "processed": self.processed,
            "current_file": self.current_file,
            "current_name": self.current_name,
            "stats": self.stats,
            "results": self.results,
            "error": resolve_job_error(
                job_type=self.job_type,
                stats=self.stats,
                stored_error=self.error,
            ),
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "auto_caption_mode": self.auto_caption_mode,
        }


ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
CancelCheck = Callable[[], bool]
ExecuteFn = Callable[[ProgressCallback, CancelCheck], dict[str, object]]
StatusResolver = Callable[[Job, bool], tuple[JobStatus, str | None]]
JobRunner = Callable[[str, Path, threading.Event], None]
ValidateFn = Callable[[Path], None]


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._cancel_flags: dict[str, threading.Event] = {}
        self._deleted_ids: set[str] = set()

    def initialize(self) -> None:
        recover_stale_jobs()
        with suppress(Exception):
            prune_duplicate_jobs()

    def get_job(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                return job
        return self._job_from_store(job_id)

    def list_jobs(self, *, limit: int = 100) -> list[Job]:
        stored_jobs = list_jobs_from_store(limit=limit)

        with self._lock:
            memory_jobs = dict(self._jobs)

        jobs: list[Job] = []
        for stored in stored_jobs:
            job_id = str(stored["id"])
            if job_id in memory_jobs:
                jobs.append(memory_jobs[job_id])
            else:
                jobs.append(Job.from_dict(stored))
        return jobs

    def get_latest_job_for_folder(
        self,
        folder: str,
        *,
        job_type: JobType | None = None,
    ) -> Job | None:
        with self._lock:
            memory_match = self._memory_job_for_folder_unlocked(folder, job_type=job_type)

        stored = get_latest_job_for_folder_from_store(folder, job_type=job_type)
        if memory_match is not None and stored is not None:
            if memory_match.created_at >= str(stored["created_at"]):
                return memory_match
            return Job.from_dict(stored)

        if memory_match is not None:
            return memory_match
        if stored is not None:
            return Job.from_dict(stored)
        return None

    def get_active_job_for_folder(
        self,
        folder: str,
        *,
        job_type: JobType | None = None,
    ) -> Job | None:
        with self._lock:
            active = self._memory_job_for_folder_unlocked(
                folder,
                job_type=job_type,
                active_only=True,
            )
            if active is not None:
                return active

        stored = get_active_job_for_folder_from_store(folder, job_type=job_type)
        if stored is None:
            return None
        return Job.from_dict(stored)

    def queue_auto_caption_job(
        self,
        folder: Path,
        *,
        mode: str = "thinking",
        selected_paths: list[Path] | None = None,
    ) -> Job:
        return self._queue_job(
            folder,
            job_type="auto_caption",
            validate=validate_auto_caption_folder,
            runner=lambda job_id, resolved, cancel_event: self._run_auto_caption_job(
                job_id,
                resolved,
                cancel_event,
                mode=mode,
                selected_paths=selected_paths,
            ),
            thread_prefix="auto-caption",
            auto_caption_mode=mode,
        )

    def queue_body_parts_job(
        self,
        folder: Path,
        *,
        body_description: str = "",
        face_description: str = "",
        keywords: list[str] | None = None,
        element_description: str = "",
        selected_paths: list[Path] | None = None,
    ) -> Job:
        keyword_list = keywords or []
        return self._queue_job(
            folder,
            job_type="body_parts",
            validate=validate_body_parts_folder,
            runner=lambda job_id, resolved, cancel_event: self._run_body_parts_job(
                job_id,
                resolved,
                cancel_event,
                body_description,
                face_description,
                keyword_list,
                element_description,
                selected_paths=selected_paths,
            ),
            thread_prefix="body-parts",
        )

    def queue_strip_metadata_job(
        self,
        folder: Path,
        *,
        selected_paths: list[Path] | None = None,
    ) -> Job:
        return self._queue_job(
            folder,
            job_type="strip_metadata",
            validate=validate_strip_metadata_folder,
            runner=lambda job_id, resolved, cancel_event: self._run_strip_metadata_job(
                job_id,
                resolved,
                cancel_event,
                selected_paths=selected_paths,
            ),
            thread_prefix="strip-metadata",
        )

    def queue_set_captions_job(
        self,
        folder: Path,
        *,
        caption: str,
        overwrite: bool = False,
        selected_paths: list[Path] | None = None,
    ) -> Job:
        return self._queue_job(
            folder,
            job_type="set_captions",
            validate=validate_set_captions_folder,
            runner=lambda job_id, resolved, cancel_event: self._run_set_captions_job(
                job_id,
                resolved,
                cancel_event,
                caption,
                overwrite,
                selected_paths=selected_paths,
            ),
            thread_prefix="set-captions",
        )

    def queue_batch_rename_job(
        self,
        folder: Path,
        *,
        stem: str,
        selected_paths: list[Path] | None = None,
    ) -> Job:
        return self._queue_job(
            folder,
            job_type="batch_rename",
            validate=lambda resolved: validate_batch_rename_folder(
                resolved, stem=stem, selected_paths=selected_paths
            ),
            runner=lambda job_id, resolved, cancel_event: self._run_batch_rename_job(
                job_id,
                resolved,
                cancel_event,
                stem,
                selected_paths=selected_paths,
            ),
            thread_prefix="batch-rename",
        )

    def queue_verify_captions_job(
        self,
        folder: Path,
        *,
        mode: str = "instruct",
        context: str = "",
        selected_paths: list[Path] | None = None,
    ) -> Job:
        return self._queue_job(
            folder,
            job_type="verify_captions",
            validate=validate_verify_captions_folder,
            runner=lambda job_id, resolved, cancel_event: self._run_verify_captions_job(
                job_id,
                resolved,
                cancel_event,
                mode=mode,
                context=context,
                selected_paths=selected_paths,
            ),
            thread_prefix="verify-captions",
        )

    def cancel_job(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
            cancel_event = self._cancel_flags.get(job_id)
            if job is None:
                job = self._job_from_store(job_id)
                if job is None:
                    return None
                if job.status not in ACTIVE_STATUSES:
                    return job
                return job

            if cancel_event is None or job.status not in ACTIVE_STATUSES:
                return job
            cancel_event.set()
        return job

    def delete_job(self, job_id: str) -> bool:
        stored = get_job_from_store(job_id)
        with self._lock:
            memory_job = self._jobs.get(job_id)

        if stored is None and memory_job is None:
            return False

        had_memory = memory_job is not None

        if memory_job is not None and memory_job.status in ACTIVE_STATUSES:
            self.cancel_job(job_id)

        with self._lock:
            self._jobs.pop(job_id, None)
            self._cancel_flags.pop(job_id, None)
            self._deleted_ids.add(job_id)
            deleted_store = delete_job_from_store(job_id)

        return deleted_store or had_memory

    def delete_all_jobs(self) -> int:
        stored_jobs = list_jobs_from_store(limit=100)
        stored_count = len(stored_jobs)

        with self._lock:
            for job_id, job in list(self._jobs.items()):
                if job.status in ACTIVE_STATUSES:
                    cancel_event = self._cancel_flags.get(job_id)
                    if cancel_event is not None:
                        cancel_event.set()

            for stored in stored_jobs:
                self._deleted_ids.add(str(stored["id"]))
            for job_id in self._jobs:
                self._deleted_ids.add(job_id)

            self._jobs.clear()
            self._cancel_flags.clear()

            # Delete while holding the lock so a worker cannot pass the
            # not-deleted check and re-insert a ``running`` row after we clear.
            deleted_count = delete_all_jobs_from_store()

        return max(deleted_count, stored_count)

    def _queue_job(
        self,
        folder: Path,
        *,
        job_type: JobType,
        validate: ValidateFn,
        runner: JobRunner,
        thread_prefix: str,
        auto_caption_mode: str | None = None,
    ) -> Job:
        folder = folder.expanduser().resolve()
        validate(folder)

        with self._lock:
            active = self._memory_job_for_folder_unlocked(str(folder), active_only=True)
            if active is not None:
                raise ValueError("A job is already running for this folder")

            job_id = uuid.uuid4().hex
            job = Job(
                id=job_id,
                folder=str(folder),
                job_type=job_type,
                auto_caption_mode=auto_caption_mode if job_type == "auto_caption" else None,
            )
            self._jobs[job_id] = job
            cancel_event = threading.Event()
            self._cancel_flags[job_id] = cancel_event

            for jid in list(self._jobs):
                if jid == job_id:
                    continue
                existing = self._jobs[jid]
                if existing.folder == job.folder and existing.job_type == job_type:
                    self._jobs.pop(jid, None)
                    self._cancel_flags.pop(jid, None)

        self._persist(job)

        with suppress(Exception):
            delete_jobs_for_folder_from_store(str(folder), job_type=job_type, keep_id=job_id)

        thread = threading.Thread(
            target=runner,
            args=(job_id, folder, cancel_event),
            name=f"{thread_prefix}-{job_id[:8]}",
            daemon=True,
        )
        thread.start()
        return job

    def _run_auto_caption_job(
        self,
        job_id: str,
        folder: Path,
        cancel_event: threading.Event,
        *,
        mode: str = "thinking",
        selected_paths: list[Path] | None = None,
    ) -> None:
        self._run_managed_job(
            job_id,
            folder,
            cancel_event,
            execute=lambda on_progress, should_cancel: run_auto_caption_job(
                folder,
                mode=mode,
                on_progress=on_progress,
                should_cancel=should_cancel,
                selected_paths=selected_paths,
            ),
            resolve_status=_resolve_api_errors("api_error", auto_caption_error_message),
        )

    def _run_body_parts_job(
        self,
        job_id: str,
        folder: Path,
        cancel_event: threading.Event,
        body_description: str,
        face_description: str,
        keywords: list[str],
        element_description: str,
        *,
        selected_paths: list[Path] | None = None,
    ) -> None:
        def prepare(job: Job) -> None:
            from automation.selection import filter_media_list

            image_files = filter_media_list(list_body_parts_images(folder), selected_paths)
            job.total = len(image_files)
            job.current_name = "Loading models..."

        self._run_managed_job(
            job_id,
            folder,
            cancel_event,
            prepare=prepare,
            execute=lambda on_progress, should_cancel: run_body_parts_job(
                folder,
                body_description=body_description,
                face_description=face_description,
                keywords=keywords,
                element_description=element_description,
                on_progress=on_progress,
                should_cancel=should_cancel,
                selected_paths=selected_paths,
            ),
            resolve_status=_resolve_stats_errors(body_parts_error_message),
        )

    def _run_strip_metadata_job(
        self,
        job_id: str,
        folder: Path,
        cancel_event: threading.Event,
        *,
        selected_paths: list[Path] | None = None,
    ) -> None:
        self._run_managed_job(
            job_id,
            folder,
            cancel_event,
            execute=lambda on_progress, should_cancel: run_strip_metadata_job(
                folder,
                on_progress=on_progress,
                should_cancel=should_cancel,
                selected_paths=selected_paths,
            ),
            resolve_status=_resolve_stats_errors(strip_metadata_error_message),
        )

    def _run_set_captions_job(
        self,
        job_id: str,
        folder: Path,
        cancel_event: threading.Event,
        caption: str,
        overwrite: bool,
        *,
        selected_paths: list[Path] | None = None,
    ) -> None:
        self._run_managed_job(
            job_id,
            folder,
            cancel_event,
            execute=lambda on_progress, should_cancel: run_set_captions_job(
                folder,
                caption,
                overwrite=overwrite,
                on_progress=on_progress,
                should_cancel=should_cancel,
                selected_paths=selected_paths,
            ),
            resolve_status=_resolve_stats_errors(set_captions_error_message),
        )

    def _run_batch_rename_job(
        self,
        job_id: str,
        folder: Path,
        cancel_event: threading.Event,
        stem: str,
        *,
        selected_paths: list[Path] | None = None,
    ) -> None:
        self._run_managed_job(
            job_id,
            folder,
            cancel_event,
            execute=lambda on_progress, should_cancel: run_batch_rename_job(
                folder,
                stem,
                on_progress=on_progress,
                should_cancel=should_cancel,
                selected_paths=selected_paths,
            ),
            resolve_status=_resolve_stats_errors(batch_rename_error_message),
        )

    def _run_verify_captions_job(
        self,
        job_id: str,
        folder: Path,
        cancel_event: threading.Event,
        *,
        mode: str = "instruct",
        context: str = "",
        selected_paths: list[Path] | None = None,
    ) -> None:
        self._run_managed_job(
            job_id,
            folder,
            cancel_event,
            execute=lambda on_progress, should_cancel: run_verify_captions_job(
                folder,
                mode=mode,
                context=context,
                on_progress=on_progress,
                should_cancel=should_cancel,
                selected_paths=selected_paths,
            ),
            resolve_status=_resolve_verify_captions_status,
        )

    def _run_managed_job(
        self,
        job_id: str,
        folder: Path,
        cancel_event: threading.Event,
        *,
        execute: ExecuteFn,
        resolve_status: StatusResolver,
        prepare: Callable[[Job], None] | None = None,
    ) -> None:
        if not self._begin_job(job_id, cancel_event, prepare=prepare):
            return

        try:
            result = execute(self._progress_callback(job_id), cancel_event.is_set)
        except Exception as exc:
            self._fail_job(job_id, str(exc))
            return

        self._complete_job(job_id, result, cancel_event.is_set(), resolve_status)

    def _begin_job(
        self,
        job_id: str,
        cancel_event: threading.Event,
        *,
        prepare: Callable[[Job], None] | None = None,
    ) -> bool:
        with self._lock:
            job = self._jobs[job_id]
            if cancel_event.is_set():
                job.status = "cancelled"
                job.finished_at = _utc_now()
                snapshot = job.to_dict()
            else:
                job.status = "running"
                job.started_at = _utc_now()
                if prepare is not None:
                    prepare(job)
                snapshot = job.to_dict()
            # Persist before releasing the lock so store never lags behind memory status.
            self._save_snapshot(job_id, snapshot)

        return not cancel_event.is_set()

    def _progress_callback(self, job_id: str) -> ProgressCallback:
        def on_progress(
            current_file: str,
            current_name: str,
            processed: int,
            total: int,
            stats: dict[str, int],
        ) -> None:
            with self._lock:
                active = self._jobs.get(job_id)
                if active is None:
                    return
                active.current_file = current_file
                active.current_name = current_name
                active.processed = processed
                active.total = total
                active.stats = dict(stats)
                self._save_snapshot(job_id, active.to_dict())

        return on_progress

    def _fail_job(self, job_id: str, error: str) -> None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return
            job.status = "failed"
            job.error = error
            job.finished_at = _utc_now()
            self._save_snapshot(job_id, job.to_dict())

    def _complete_job(
        self,
        job_id: str,
        result: dict[str, object],
        cancelled: bool,
        resolve_status: StatusResolver,
    ) -> None:
        with self._lock:
            if self._is_deleted(job_id):
                return
            job = self._jobs.get(job_id)
            if job is None:
                return

            job.total = int(result["total"])
            job.processed = int(result["processed"])
            job.stats = dict(result["stats"])
            job.results = list(result["results"])
            job.current_file = None
            job.current_name = None
            job.finished_at = _utc_now()

            status, error = resolve_status(job, cancelled)
            job.status = status
            job.error = error
            self._save_snapshot(job_id, job.to_dict())

    def _memory_job_for_folder_unlocked(
        self,
        folder: str,
        *,
        job_type: JobType | None = None,
        active_only: bool = False,
    ) -> Job | None:
        normalized = _normalize_folder(folder)
        for job in reversed(list(self._jobs.values())):
            if job.folder != normalized:
                continue
            if job_type is not None and job.job_type != job_type:
                continue
            if active_only and job.status not in ACTIVE_STATUSES:
                continue
            return job
        return None

    def _job_from_store(self, job_id: str) -> Job | None:
        stored = get_job_from_store(job_id)
        if stored is None:
            return None
        return Job.from_dict(stored)

    def _is_deleted(self, job_id: str) -> bool:
        return job_id in self._deleted_ids

    def _persist(self, job: Job) -> None:
        """Persist ``job`` if it is still tracked and not deleted."""
        with self._lock:
            self._save_snapshot(job.id, job.to_dict())

    def _save_snapshot(self, job_id: str, snapshot: dict[str, object]) -> None:
        """Write a snapshot. Caller must hold ``self._lock``.

        Requires the job to still be in memory and not deleted so a worker
        cannot re-insert a row after ``delete_job`` / ``delete_all_jobs``.
        """
        if job_id in self._deleted_ids or job_id not in self._jobs:
            return
        save_job(snapshot)


job_manager = JobManager()
