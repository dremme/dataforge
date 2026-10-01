from __future__ import annotations

import json
import os
import re
import sqlite3
import time
from contextlib import closing
from pathlib import Path
from typing import Any

import httpx

from app_settings import effective_settings
from filesystem import path_leaf_name

OSTRIS_JOBS_PATH = "/api/jobs"
OSTRIS_SETTINGS_PATH = "/api/settings"
OSTRIS_GPU_PATH = "/api/gpu"
OSTRIS_QUEUE_PATH = "/api/queue"
OSTRIS_REQUEST_TIMEOUT_SECONDS = 3.0
OSTRIS_TRAINING_TIMEOUT_SECONDS = 30.0
OSTRIS_STOP_OPERATION_TIMEOUT_SECONDS = 600.0
OSTRIS_SAVE_POLL_INTERVAL_SECONDS = 1.0
OSTRIS_STOP_POLL_INTERVAL_SECONDS = 1.0
OSTRIS_TRAIN_POLL_INTERVAL_SECONDS = 3.0
OSTRIS_SAVE_MAX_WAIT_SECONDS = 1800.0
OSTRIS_STOP_MAX_WAIT_SECONDS = 300.0
DEFAULT_OSTRIS_GPU_IDS = "0"
ACTIVE_OSTRIS_STATUSES = frozenset({"running", "queued", "stopping"})
TERMINAL_OSTRIS_STATUSES = frozenset({"stopped", "completed", "error"})


class OstrisJobStopError(Exception):
    pass


def get_ostris_base_url() -> str:
    return effective_settings().ai_toolkit_base_url


def open_ostris_client(timeout: float) -> httpx.Client:
    """Binds the address once, so a run keeps talking to the AI-Toolkit it started on."""
    return httpx.Client(base_url=get_ostris_base_url(), timeout=timeout)


def _first_process_config(job_config: dict[str, Any]) -> dict[str, Any]:
    config = job_config.get("config")
    if not isinstance(config, dict):
        return {}

    process = config.get("process")
    if not isinstance(process, list) or not process:
        return {}

    first = process[0]
    return first if isinstance(first, dict) else {}


def _parse_job_config(raw_job: dict[str, Any]) -> dict[str, Any]:
    try:
        job_config = json.loads(raw_job.get("job_config") or "{}")
    except json.JSONDecodeError:
        return {}

    return job_config if isinstance(job_config, dict) else {}


def _dataset_folder(process_config: dict[str, Any]) -> str | None:
    datasets = process_config.get("datasets")
    if not isinstance(datasets, list) or not datasets:
        return None

    first = datasets[0]
    if not isinstance(first, dict):
        return None

    folder_path = first.get("folder_path")
    return folder_path if isinstance(folder_path, str) and folder_path else None


def job_sample_prompts(raw_job: dict[str, Any]) -> list[str]:
    """The sample prompts a job was configured with, in the order its samples are numbered."""
    sample = _first_process_config(_parse_job_config(raw_job)).get("sample")
    if not isinstance(sample, dict):
        return []

    samples = sample.get("samples")
    if not isinstance(samples, list):
        return []

    prompts: list[str] = []
    for item in samples:
        prompt = item.get("prompt") if isinstance(item, dict) else None
        prompts.append(prompt if isinstance(prompt, str) else "")
    return prompts


def _total_steps(raw_job: dict[str, Any], process_config: dict[str, Any]) -> int | None:
    total_steps = raw_job.get("total_steps")
    if isinstance(total_steps, int) and total_steps > 0:
        return total_steps

    train = process_config.get("train")
    if not isinstance(train, dict):
        return None

    steps = train.get("steps")
    return steps if isinstance(steps, int) and steps > 0 else None


def ostris_job_total_steps(raw_job: dict[str, Any]) -> int | None:
    """Total training steps from the job row, falling back to the job config."""
    return _total_steps(raw_job, _first_process_config(_parse_job_config(raw_job)))


_SPEED_SEC_PER_ITER = re.compile(r"([\d.]+)\s*sec/iter", re.IGNORECASE)


def ostris_job_speed_seconds_per_step(raw_job: dict[str, Any]) -> float | None:
    """Seconds per training step, parsed out of the job's ``speed_string``."""
    raw = raw_job.get("speed_string")
    if not isinstance(raw, str):
        return None

    match = _SPEED_SEC_PER_ITER.search(raw)
    if match is None:
        return None

    try:
        seconds = float(match.group(1))
    except ValueError:
        return None

    return seconds if seconds > 0 else None


def _as_bool(value: Any) -> bool:
    return value is True or value == 1


def _is_checkpoint_save_in_progress(job: dict[str, Any]) -> bool:
    return _as_bool(job.get("save_now")) or job.get("info") == "Saving model"


def _str_or_none(raw_job: dict[str, Any], key: str) -> str | None:
    value = raw_job.get(key)
    return value if isinstance(value, str) else None


def resolve_sqlite_db_path(raw_job: dict[str, Any]) -> Path | None:
    process_config = _first_process_config(_parse_job_config(raw_job))
    sqlite_path = process_config.get("sqlite_db_path")
    if not isinstance(sqlite_path, str) or not sqlite_path:
        sqlite_path = "./aitk_db.db"

    configured = Path(sqlite_path)
    if configured.is_absolute():
        return configured if configured.exists() else None

    candidates: list[Path] = []
    training_folder = process_config.get("training_folder")
    if isinstance(training_folder, str) and training_folder:
        candidates.append((Path(training_folder).parent / configured).resolve())

    toolkit_root = os.environ.get("OSTRIS_TOOLKIT_ROOT")
    if toolkit_root:
        candidates.append((Path(toolkit_root) / configured).resolve())

    for candidate in candidates:
        if candidate.exists():
            return candidate

    return None


def _ostris_job_path(job_id: str) -> str:
    return f"{OSTRIS_JOBS_PATH}/{job_id}"


def _get_ok(client: httpx.Client, path: str) -> None:
    client.get(path).raise_for_status()


def _get_dict(client: httpx.Client, path: str, **params: str) -> dict[str, Any]:
    response = client.get(path, params=params) if params else client.get(path)
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else {}


def fetch_ostris_job(client: httpx.Client, job_id: str) -> dict[str, Any] | None:
    return _get_dict(client, OSTRIS_JOBS_PATH, id=job_id) or None


def fetch_ostris_job_by_name(client: httpx.Client, name: str) -> dict[str, Any] | None:
    """Look up a job by its unique name, which Ostris enforces on creation."""
    raw_jobs = _get_dict(client, OSTRIS_JOBS_PATH).get("jobs")
    if not isinstance(raw_jobs, list):
        return None

    for raw_job in raw_jobs:
        if isinstance(raw_job, dict) and raw_job.get("name") == name:
            return raw_job
    return None


def fetch_ostris_training_folder(client: httpx.Client) -> str | None:
    training_folder = _get_dict(client, OSTRIS_SETTINGS_PATH).get("TRAINING_FOLDER")
    return training_folder if isinstance(training_folder, str) and training_folder else None


def fetch_ostris_gpu_ids(client: httpx.Client) -> str:
    """The GPU the job is queued on. Ostris rewrites this to "mps" on macOS itself."""
    gpus = _get_dict(client, OSTRIS_GPU_PATH).get("gpus")
    if not isinstance(gpus, list) or not gpus:
        return DEFAULT_OSTRIS_GPU_IDS

    first = gpus[0]
    index = first.get("index") if isinstance(first, dict) else None
    return str(index) if isinstance(index, int) else DEFAULT_OSTRIS_GPU_IDS


def create_ostris_job(
    client: httpx.Client,
    *,
    name: str,
    gpu_ids: str,
    job_config: dict[str, Any],
) -> httpx.Response:
    return client.post(
        OSTRIS_JOBS_PATH,
        json={"name": name, "gpu_ids": gpu_ids, "job_config": job_config},
    )


def queue_ostris_job(client: httpx.Client, job_id: str) -> None:
    _get_ok(client, f"{_ostris_job_path(job_id)}/start")


def start_ostris_queue(client: httpx.Client, gpu_ids: str) -> None:
    """Queueing a job is not enough; its GPU queue has to be running to pick it up."""
    _get_ok(client, f"{OSTRIS_QUEUE_PATH}/{gpu_ids}/start")


def mark_ostris_job_stopped(client: httpx.Client, job_id: str) -> None:
    """Drop a job that is still queued. The checkpoint stop only accepts running jobs."""
    _get_ok(client, f"{_ostris_job_path(job_id)}/mark_stopped")


def request_save_next_step(client: httpx.Client, job_id: str) -> None:
    _get_ok(client, f"{_ostris_job_path(job_id)}/save_now")


def wait_for_save_next_step(
    client: httpx.Client,
    job_id: str,
    *,
    poll_interval_seconds: float = OSTRIS_SAVE_POLL_INTERVAL_SECONDS,
    max_wait_seconds: float = OSTRIS_SAVE_MAX_WAIT_SECONDS,
) -> dict[str, Any]:
    """Call only once a save is requested or pending, so a finished save is not awaited again."""
    deadline = time.monotonic() + max_wait_seconds

    while time.monotonic() < deadline:
        job = fetch_ostris_job(client, job_id)
        if job is None:
            raise OstrisJobStopError("Ostris job not found while waiting for checkpoint save.")

        if not _is_checkpoint_save_in_progress(job):
            return job

        time.sleep(poll_interval_seconds)

    raise OstrisJobStopError("Timed out waiting for Ostris to save the next-step checkpoint.")


def request_graceful_stop(db_path: Path, job_id: str) -> None:
    with closing(sqlite3.connect(db_path, timeout=10.0)) as conn:
        cursor = conn.execute(
            "UPDATE Job SET stop = 1, info = 'Stopping job...' WHERE id = ?",
            (job_id,),
        )
        if cursor.rowcount != 1:
            raise OstrisJobStopError("Failed to request a graceful stop for the Ostris job.")
        conn.commit()


def wait_for_job_stop(
    client: httpx.Client,
    job_id: str,
    *,
    poll_interval_seconds: float = OSTRIS_STOP_POLL_INTERVAL_SECONDS,
    max_wait_seconds: float = OSTRIS_STOP_MAX_WAIT_SECONDS,
) -> dict[str, Any]:
    deadline = time.monotonic() + max_wait_seconds

    while time.monotonic() < deadline:
        job = fetch_ostris_job(client, job_id)
        if job is None:
            raise OstrisJobStopError("Ostris job not found while waiting for stop.")

        status = job.get("status")
        if isinstance(status, str) and status in TERMINAL_OSTRIS_STATUSES:
            return job

        time.sleep(poll_interval_seconds)

    raise OstrisJobStopError("Timed out waiting for the Ostris job to stop.")


def stop_ostris_job_with_checkpoint(job_id: str) -> dict[str, Any]:
    with open_ostris_client(OSTRIS_STOP_OPERATION_TIMEOUT_SECONDS) as client:
        job = fetch_ostris_job(client, job_id)
        if job is None:
            raise OstrisJobStopError("Ostris job not found.")

        status = job.get("status")
        if status == "queued":
            # Nothing has been trained yet, so there is no checkpoint to save.
            mark_ostris_job_stopped(client, job_id)
            return wait_for_job_stop(client, job_id)

        if status != "running":
            raise OstrisJobStopError("Only running or queued Ostris jobs can be stopped.")

        if not _as_bool(job.get("save_now")):
            request_save_next_step(client, job_id)
        wait_for_save_next_step(client, job_id)

        db_path = resolve_sqlite_db_path(job)
        if db_path is None:
            raise OstrisJobStopError(
                "Could not locate the Ostris SQLite database to request a graceful stop.",
            )

        request_graceful_stop(db_path, job_id)
        return wait_for_job_stop(client, job_id)


def _queue_position(raw_job: dict[str, Any]) -> int:
    value = raw_job.get("queue_position")
    return value if isinstance(value, int) and not isinstance(value, bool) else 0


_STATUS_RANK = {"running": 0, "stopping": 1}


def _queue_sort_key(raw_job: dict[str, Any]) -> tuple[int, int]:
    """Match AI-Toolkit: the running job first, then queued jobs by queue_position."""
    return (_STATUS_RANK.get(raw_job.get("status"), 2), _queue_position(raw_job))


def normalize_ostris_job(raw_job: dict[str, Any]) -> dict[str, Any] | None:
    status = raw_job.get("status")
    if status not in ACTIVE_OSTRIS_STATUSES:
        return None

    job_id = raw_job.get("id")
    name = raw_job.get("name")
    if not isinstance(job_id, str) or not job_id:
        return None
    if not isinstance(name, str) or not name:
        return None

    job_config = _parse_job_config(raw_job)
    process_config = _first_process_config(job_config)
    dataset_folder = _dataset_folder(process_config)
    model = process_config.get("model")
    model_name = (_str_or_none(model, "name_or_path") or None) if isinstance(model, dict) else None

    step = raw_job.get("step")
    normalized_step = step if isinstance(step, int) and step >= 0 else 0

    return {
        "id": job_id,
        "name": name,
        "status": status,
        "step": normalized_step,
        "total_steps": ostris_job_total_steps(raw_job),
        "info": _str_or_none(raw_job, "info"),
        "speed_string": _str_or_none(raw_job, "speed_string"),
        "job_type": _str_or_none(raw_job, "job_type"),
        "dataset_folder": dataset_folder,
        "dataset_folder_name": path_leaf_name(dataset_folder or ""),
        "model": model_name,
        "created_at": _str_or_none(raw_job, "created_at"),
        "save_now": _as_bool(raw_job.get("save_now")),
        "stop_requested": _as_bool(raw_job.get("stop")),
    }


def fetch_active_ostris_jobs() -> tuple[list[dict[str, Any]], bool]:
    try:
        with open_ostris_client(OSTRIS_REQUEST_TIMEOUT_SECONDS) as client:
            payload = _get_dict(client, OSTRIS_JOBS_PATH)
    except (httpx.HTTPError, TypeError, ValueError):
        return [], False

    if not payload:
        return [], False

    raw_jobs = payload.get("jobs")
    if not isinstance(raw_jobs, list):
        return [], True

    ranked: list[tuple[tuple[int, int], dict[str, Any]]] = []
    for raw_job in raw_jobs:
        if not isinstance(raw_job, dict):
            continue
        normalized = normalize_ostris_job(raw_job)
        if normalized is not None:
            ranked.append((_queue_sort_key(raw_job), normalized))

    ranked.sort(key=lambda item: item[0])
    return [job for _, job in ranked], True
