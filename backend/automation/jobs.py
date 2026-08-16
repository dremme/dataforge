"""Background job queue with SQLite-backed progress tracking."""

from __future__ import annotations

import threading
import uuid
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from time import monotonic

import events
from automation import jobs_store
from automation.auto_caption import run_auto_caption_job, validate_auto_caption_folder
from automation.backup_captions import (
    run_backup_captions_job,
    run_restore_captions_job,
    validate_backup_captions_folder,
    validate_restore_captions_folder,
)
from automation.find_duplicates import (
    DEFAULT_THRESHOLD as DEFAULT_DUPLICATE_THRESHOLD,
)
from automation.find_duplicates import (
    run_find_duplicates_job,
    validate_find_duplicates_folder,
)
from automation.job_messages import (
    auto_caption_failure_message,
    backup_captions_error_message,
    find_duplicates_error_message,
    rename_media_error_message,
    replace_captions_error_message,
    resolve_job_error,
    restore_captions_error_message,
    set_captions_error_message,
    strip_metadata_error_message,
    verify_captions_failure_message,
    watermark_error_message,
)
from automation.rename_media import run_rename_media_job, validate_rename_media_folder
from automation.replace_captions import (
    DEFAULT_MODE as DEFAULT_REPLACE_MODE,
)
from automation.replace_captions import (
    run_replace_captions_job,
    validate_replace_captions_folder,
)
from automation.set_captions import run_set_captions_job, validate_set_captions_folder
from automation.strip_metadata import run_strip_metadata_job, validate_strip_metadata_folder
from automation.train_lora import run_train_lora_job, validate_train_lora_folder
from automation.verify_captions import run_verify_captions_job, validate_verify_captions_folder
from automation.watermark import (
    DEFAULT_WATERMARK_OPACITY,
    DEFAULT_WATERMARK_POSITION,
    DEFAULT_WATERMARK_SIZE,
    run_watermark_job,
    validate_watermark_folder,
)
from filesystem import normalize_user_path, path_leaf_name
from schemas import JobEvent, JobResponse, JobStatus, JobType

ACTIVE_STATUSES = frozenset({"queued", "running"})

#: A per-file job saves a snapshot before and after every file, which for a fast job is
#: far more than a UI can use. Mid-run frames are thinned to this cadence; a status
#: change always goes out immediately, so nothing that matters is delayed.
JOB_EVENT_MIN_INTERVAL_SECONDS = 0.25


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


def _resolve_train_lora_status(job: Job, cancelled: bool) -> tuple[JobStatus, str | None]:
    # A failed training run raises out of the runner, so it never reaches here.
    if cancelled or job.stats.get("stopped"):
        return "cancelled", None
    return "completed", None


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
    # Names the external job this one co-tracks (the AI-Toolkit job name).
    external_ref: str | None = None

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
            external_ref=data.get("external_ref"),  # type: ignore[arg-type]
        )

    def to_summary_dict(self) -> dict[str, object]:
        """Everything about the job except its per-file results.

        This is the wire shape. ``results`` holds one entry per processed file and an
        auto-caption entry carries the whole generated caption, so it would dominate
        every response of a list that is polled while work runs; it is served on
        demand by ``/api/jobs/{id}/results`` instead.
        """
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
            "error": resolve_job_error(
                job_type=self.job_type,
                stats=self.stats,
                stored_error=self.error,
            ),
            "created_at": self.created_at,
            "started_at": self.started_at,
            "finished_at": self.finished_at,
            "auto_caption_mode": self.auto_caption_mode,
            "external_ref": self.external_ref,
        }

    def to_dict(self) -> dict[str, object]:
        """The persistence shape: the summary plus the per-file results."""
        return {**self.to_summary_dict(), "results": self.results}


ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
StatusResolver = Callable[[Job, bool], tuple[JobStatus, str | None]]


def _folder_only(validate: Callable[[Path], None]) -> Callable[..., None]:
    """Adapt a plain folder validator to the ``(folder, **params)`` spec signature."""

    def validate_folder(folder: Path, **_params: object) -> None:
        validate(folder)

    return validate_folder


def _selected_paths(params: dict[str, object]) -> list[Path] | None:
    selected = params.get("selected_paths")
    return selected if isinstance(selected, list) else None


def _validate_rename_media(folder: Path, **params: object) -> None:
    validate_rename_media_folder(
        folder,
        stem=str(params.get("stem", "")),
        selected_paths=_selected_paths(params),
    )


def _validate_replace_captions(folder: Path, **params: object) -> None:
    validate_replace_captions_folder(
        folder,
        mode=str(params.get("mode", DEFAULT_REPLACE_MODE)),
        search=str(params.get("search", "")),
        replacement=str(params.get("replacement", "")),
        use_regex=bool(params.get("use_regex", False)),
        case_sensitive=bool(params.get("case_sensitive", False)),
    )


def _validate_find_duplicates(folder: Path, **params: object) -> None:
    validate_find_duplicates_folder(
        folder,
        threshold=str(params.get("threshold", DEFAULT_DUPLICATE_THRESHOLD)),
    )


def _validate_watermark(folder: Path, **params: object) -> None:
    validate_watermark_folder(
        folder,
        text=str(params.get("text", "")),
        size=str(params.get("size", DEFAULT_WATERMARK_SIZE)),
        opacity=int(params.get("opacity", DEFAULT_WATERMARK_OPACITY)),  # type: ignore[arg-type]
        position=str(params.get("position", DEFAULT_WATERMARK_POSITION)),
        selected_paths=_selected_paths(params),
    )


def _train_lora_external_ref(params: dict[str, object]) -> str | None:
    return str(params.get("lora_name", "")).strip() or None


def _resume_train_lora(job: Job) -> dict[str, object] | None:
    if not job.external_ref:
        return None
    return {"lora_name": job.external_ref, "attach_only": True}


def _auto_caption_mode(params: dict[str, object]) -> str | None:
    return str(params.get("mode", "thinking"))


def _validate_auto_caption(folder: Path, **params: object) -> None:
    validate_auto_caption_folder(folder, caption_audio=bool(params.get("caption_audio", False)))


@dataclass(frozen=True)
class JobSpec:
    """Everything that differs between job types; JobManager handles the rest.

    ``run`` is called as ``run(folder, on_progress=..., should_cancel=..., **params)``,
    so a job's queue-time parameters must match its runner's keyword arguments.

    ``resume`` returns the params to pick a job back up with after a restart, or None
    when it cannot be resumed. Only jobs whose real work outlives this process (an
    external service doing the work) define it; everything else stays interrupted.

    ``external_ref`` and ``caption_mode`` derive their stored ``Job`` columns from the
    queue-time params, so ``JobManager`` never has to know which type it is handling.
    """

    thread_prefix: str
    run: Callable[..., dict[str, object]]
    resolve_status: StatusResolver
    validate: Callable[..., None]
    resume: Callable[[Job], dict[str, object] | None] | None = None
    external_ref: Callable[[dict[str, object]], str | None] | None = None
    caption_mode: Callable[[dict[str, object]], str | None] | None = None


JOB_SPECS: dict[JobType, JobSpec] = {
    "auto_caption": JobSpec(
        thread_prefix="auto-caption",
        run=run_auto_caption_job,
        resolve_status=_resolve_stats_errors(auto_caption_failure_message),
        validate=_validate_auto_caption,
        caption_mode=_auto_caption_mode,
    ),
    "strip_metadata": JobSpec(
        thread_prefix="strip-metadata",
        run=run_strip_metadata_job,
        resolve_status=_resolve_stats_errors(strip_metadata_error_message),
        validate=_folder_only(validate_strip_metadata_folder),
    ),
    "set_captions": JobSpec(
        thread_prefix="set-captions",
        run=run_set_captions_job,
        resolve_status=_resolve_stats_errors(set_captions_error_message),
        validate=_folder_only(validate_set_captions_folder),
    ),
    "replace_captions": JobSpec(
        thread_prefix="replace-captions",
        run=run_replace_captions_job,
        resolve_status=_resolve_stats_errors(replace_captions_error_message),
        validate=_validate_replace_captions,
    ),
    "find_duplicates": JobSpec(
        thread_prefix="find-duplicates",
        run=run_find_duplicates_job,
        resolve_status=_resolve_stats_errors(find_duplicates_error_message),
        validate=_validate_find_duplicates,
    ),
    "batch_rename": JobSpec(
        thread_prefix="rename-media",
        run=run_rename_media_job,
        resolve_status=_resolve_stats_errors(rename_media_error_message),
        validate=_validate_rename_media,
    ),
    "backup_captions": JobSpec(
        thread_prefix="backup-captions",
        run=run_backup_captions_job,
        resolve_status=_resolve_stats_errors(backup_captions_error_message),
        validate=_folder_only(validate_backup_captions_folder),
    ),
    "restore_captions": JobSpec(
        thread_prefix="restore-captions",
        run=run_restore_captions_job,
        resolve_status=_resolve_stats_errors(restore_captions_error_message),
        validate=_folder_only(validate_restore_captions_folder),
    ),
    "verify_captions": JobSpec(
        thread_prefix="verify-captions",
        run=run_verify_captions_job,
        resolve_status=_resolve_verify_captions_status,
        validate=_folder_only(validate_verify_captions_folder),
    ),
    "watermark": JobSpec(
        thread_prefix="watermark",
        run=run_watermark_job,
        resolve_status=_resolve_stats_errors(watermark_error_message),
        validate=_validate_watermark,
    ),
    "train_lora": JobSpec(
        thread_prefix="train-lora",
        run=run_train_lora_job,
        resolve_status=_resolve_train_lora_status,
        validate=validate_train_lora_folder,
        resume=_resume_train_lora,
        external_ref=_train_lora_external_ref,
    ),
}


class JobManager:
    def __init__(self) -> None:
        self._jobs: dict[str, Job] = {}
        self._lock = threading.Lock()
        self._cancel_flags: dict[str, threading.Event] = {}
        self._deleted_ids: set[str] = set()
        #: job id -> (last publish time, status published) for event thinning.
        self._published: dict[str, tuple[float, str]] = {}

    def initialize(self) -> None:
        # Collected before recovery, which is what marks the rows interrupted.
        resumable = self._resumable_jobs()

        jobs_store.recover_stale_jobs()
        with suppress(Exception):
            jobs_store.prune_duplicate_jobs()

        for job, params in resumable:
            self._resume_job(job, params)

    def get_job(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                return job
        return self._job_from_store(job_id)

    def get_job_results(self, job_id: str) -> list[dict[str, object]] | None:
        """Per-file results for one job, or ``None`` when no such job exists."""
        with self._lock:
            job = self._jobs.get(job_id)
            if job is not None:
                return list(job.results)

        stored = jobs_store.get_job(job_id)
        if stored is None:
            return None

        results = stored.get("results")
        return list(results) if isinstance(results, list) else []

    def list_jobs(self, *, limit: int = 100) -> list[Job]:
        stored_jobs = jobs_store.list_jobs(limit=limit)

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

        stored = jobs_store.get_latest_job_for_folder(folder, job_type=job_type)
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

        stored = jobs_store.get_active_job_for_folder(folder, job_type=job_type)
        if stored is None:
            return None
        return Job.from_dict(stored)

    def queue_job(self, job_type: JobType, folder: Path, **params: object) -> Job:
        """Queue a job of ``job_type``; ``params`` are forwarded to its runner."""
        spec = JOB_SPECS[job_type]
        folder = folder.expanduser().resolve()
        spec.validate(folder, **params)

        job, cancel_event = self._register_job(folder, job_type, params)
        self._spawn_worker(spec, job, folder, cancel_event, params)
        return job

    def cancel_job(self, job_id: str) -> Job | None:
        with self._lock:
            job = self._jobs.get(job_id)
            cancel_event = self._cancel_flags.get(job_id)
            if job is None:
                # Only in-memory jobs have a worker to signal; a stored-only job
                # is already finished, so report it back as-is.
                return self._job_from_store(job_id)

            if cancel_event is None or job.status not in ACTIVE_STATUSES:
                return job
            cancel_event.set()
        return job

    def delete_job(self, job_id: str) -> bool:
        stored = jobs_store.get_job(job_id)
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
            self._published.pop(job_id, None)
            self._deleted_ids.add(job_id)
            deleted_store = jobs_store.delete_job(job_id)

        return deleted_store or had_memory

    def delete_all_jobs(self) -> int:
        stored_jobs = jobs_store.list_jobs(limit=100)
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
            self._published.clear()

            # Delete while holding the lock so a worker cannot pass the
            # not-deleted check and re-insert a ``running`` row after we clear.
            deleted_count = jobs_store.delete_all_jobs()

        return max(deleted_count, stored_count)

    def _resumable_jobs(self) -> list[tuple[Job, dict[str, object]]]:
        """Jobs left active by a previous process whose spec knows how to pick them back up."""
        stored_jobs: list[dict[str, object]] = []
        with suppress(Exception):
            stored_jobs = jobs_store.list_active_jobs()

        resumable: list[tuple[Job, dict[str, object]]] = []
        for stored in stored_jobs:
            job = Job.from_dict(stored)
            spec = JOB_SPECS.get(job.job_type)
            if spec is None or spec.resume is None:
                continue
            params = spec.resume(job)
            if params is not None:
                resumable.append((job, params))
        return resumable

    def _resume_job(self, job: Job, params: dict[str, object]) -> None:
        """Re-attach to a job whose real work outlived the last process, keeping its row."""
        cancel_event = threading.Event()

        job.status = "queued"
        job.error = None
        job.finished_at = None

        with self._lock:
            self._jobs[job.id] = job
            self._cancel_flags[job.id] = cancel_event

        self._persist(job)
        self._spawn_worker(JOB_SPECS[job.job_type], job, Path(job.folder), cancel_event, params)

    def _spawn_worker(
        self,
        spec: JobSpec,
        job: Job,
        folder: Path,
        cancel_event: threading.Event,
        params: dict[str, object],
    ) -> None:
        thread = threading.Thread(
            target=lambda: self._run_managed_job(spec, job.id, folder, cancel_event, params),
            name=f"{spec.thread_prefix}-{job.id[:8]}",
            daemon=True,
        )
        thread.start()

    def _register_job(
        self,
        folder: Path,
        job_type: JobType,
        params: dict[str, object],
    ) -> tuple[Job, threading.Event]:
        """Create the job, evict any earlier job for the same folder and type, persist it."""
        spec = JOB_SPECS[job_type]

        with self._lock:
            active = self._memory_job_for_folder_unlocked(str(folder), active_only=True)
            if active is not None:
                raise ValueError("A job is already running for this folder")

            job_id = uuid.uuid4().hex
            job = Job(
                id=job_id,
                folder=str(folder),
                job_type=job_type,
                auto_caption_mode=spec.caption_mode(params) if spec.caption_mode else None,
                external_ref=spec.external_ref(params) if spec.external_ref else None,
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
                    self._published.pop(jid, None)

        self._persist(job)

        with suppress(Exception):
            jobs_store.delete_jobs_for_folder(str(folder), job_type=job_type, keep_id=job_id)

        return job, cancel_event

    def _run_managed_job(
        self,
        spec: JobSpec,
        job_id: str,
        folder: Path,
        cancel_event: threading.Event,
        params: dict[str, object],
    ) -> None:
        if not self._begin_job(job_id, cancel_event):
            return

        try:
            result = spec.run(
                folder,
                on_progress=self._progress_callback(job_id),
                should_cancel=cancel_event.is_set,
                **params,
            )
        except Exception as exc:
            self._fail_job(job_id, str(exc))
            return

        self._complete_job(job_id, result, cancel_event.is_set(), spec.resolve_status)

    def _begin_job(self, job_id: str, cancel_event: threading.Event) -> bool:
        with self._lock:
            job = self._jobs[job_id]
            if cancel_event.is_set():
                job.status = "cancelled"
                job.finished_at = _utc_now()
            else:
                job.status = "running"
                # Kept when set, so a resumed job's elapsed time stays true.
                job.started_at = job.started_at or _utc_now()
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
        stored = jobs_store.get_job(job_id)
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
        """Write a snapshot and push it to connected clients. Caller must hold ``self._lock``.

        Requires the job to still be in memory and not deleted so a worker
        cannot re-insert a row after ``delete_job`` / ``delete_all_jobs``.
        """
        if job_id in self._deleted_ids or job_id not in self._jobs:
            return
        jobs_store.save_job(snapshot)
        self._publish_snapshot(job_id, snapshot)

    def _publish_snapshot(self, job_id: str, snapshot: dict[str, object]) -> None:
        """Push a job snapshot to connected clients. Caller must hold ``self._lock``.

        Every status change goes out; the progress frames between them are thinned to
        ``JOB_EVENT_MIN_INTERVAL_SECONDS``. Dropping one costs nothing because each
        frame carries the job's whole state, so the next one restores the truth.
        """
        status = str(snapshot.get("status") or "")
        now = monotonic()
        published = self._published.get(job_id)

        if (
            published is not None
            and published[1] == status
            and now - published[0] < JOB_EVENT_MIN_INTERVAL_SECONDS
        ):
            return

        self._published[job_id] = (now, status)
        events.publish(JobEvent(job=JobResponse.model_validate(snapshot)).model_dump())


job_manager = JobManager()
