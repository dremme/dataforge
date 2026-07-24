from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

import httpx

OSTRIS_BASE_URL = "http://127.0.0.1:8675"
OSTRIS_JOBS_URL = f"{OSTRIS_BASE_URL}/api/jobs"
OSTRIS_REQUEST_TIMEOUT_SECONDS = 3.0
OSTRIS_STOP_OPERATION_TIMEOUT_SECONDS = 600.0
OSTRIS_SAVE_POLL_INTERVAL_SECONDS = 1.0
OSTRIS_STOP_POLL_INTERVAL_SECONDS = 1.0
OSTRIS_SAVE_MAX_WAIT_SECONDS = 1800.0
OSTRIS_STOP_MAX_WAIT_SECONDS = 300.0
ACTIVE_OSTRIS_STATUSES = frozenset({"running"})
TERMINAL_OSTRIS_STATUSES = frozenset({"stopped", "completed", "error"})


class OstrisJobStopError(Exception):
    pass


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


def _total_steps(raw_job: dict[str, Any], process_config: dict[str, Any]) -> int | None:
    total_steps = raw_job.get("total_steps")
    if isinstance(total_steps, int) and total_steps > 0:
        return total_steps

    train = process_config.get("train")
    if not isinstance(train, dict):
        return None

    steps = train.get("steps")
    return steps if isinstance(steps, int) and steps > 0 else None


def _folder_name(folder_path: str | None) -> str:
    if not folder_path:
        return ""
    return Path(folder_path).name or folder_path


def _as_bool(value: Any) -> bool:
    return value is True or value == 1


def _is_checkpoint_save_in_progress(job: dict[str, Any]) -> bool:
    if _as_bool(job.get("save_now")):
        return True

    info = job.get("info")
    return info == "Saving model"


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


def _ostris_job_url(job_id: str) -> str:
    return f"{OSTRIS_JOBS_URL}/{job_id}"


def fetch_ostris_job(client: httpx.Client, job_id: str) -> dict[str, Any] | None:
    response = client.get(OSTRIS_JOBS_URL, params={"id": job_id})
    response.raise_for_status()
    payload = response.json()
    return payload if isinstance(payload, dict) else None


def request_save_next_step(client: httpx.Client, job_id: str) -> None:
    response = client.get(f"{_ostris_job_url(job_id)}/save_now")
    response.raise_for_status()


def wait_for_save_next_step(
    client: httpx.Client,
    job_id: str,
    *,
    save_was_requested: bool = True,
    poll_interval_seconds: float = OSTRIS_SAVE_POLL_INTERVAL_SECONDS,
    max_wait_seconds: float = OSTRIS_SAVE_MAX_WAIT_SECONDS,
) -> dict[str, Any]:
    deadline = time.monotonic() + max_wait_seconds
    saw_pending_save = save_was_requested

    while time.monotonic() < deadline:
        job = fetch_ostris_job(client, job_id)
        if job is None:
            raise OstrisJobStopError("Ostris job not found while waiting for checkpoint save.")

        if _as_bool(job.get("save_now")):
            saw_pending_save = True

        if saw_pending_save and not _is_checkpoint_save_in_progress(job):
            return job

        time.sleep(poll_interval_seconds)

    raise OstrisJobStopError("Timed out waiting for Ostris to save the next-step checkpoint.")


def request_graceful_stop(db_path: Path, job_id: str) -> None:
    conn = sqlite3.connect(db_path, timeout=10.0)
    try:
        cursor = conn.execute(
            "UPDATE Job SET stop = 1, info = 'Stopping job...' WHERE id = ?",
            (job_id,),
        )
        if cursor.rowcount != 1:
            raise OstrisJobStopError("Failed to request a graceful stop for the Ostris job.")
        conn.commit()
    finally:
        conn.close()


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
    with httpx.Client(timeout=OSTRIS_STOP_OPERATION_TIMEOUT_SECONDS) as client:
        job = fetch_ostris_job(client, job_id)
        if job is None:
            raise OstrisJobStopError("Ostris job not found.")

        status = job.get("status")
        if status != "running":
            raise OstrisJobStopError("Only running Ostris jobs can be stopped.")

        if _as_bool(job.get("save_now")):
            wait_for_save_next_step(client, job_id, save_was_requested=False)
        else:
            request_save_next_step(client, job_id)
            wait_for_save_next_step(client, job_id, save_was_requested=True)

        db_path = resolve_sqlite_db_path(job)
        if db_path is None:
            raise OstrisJobStopError(
                "Could not locate the Ostris SQLite database to request a graceful stop.",
            )

        request_graceful_stop(db_path, job_id)
        return wait_for_job_stop(client, job_id)


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
    model_name = None
    if isinstance(model, dict):
        name_or_path = model.get("name_or_path")
        if isinstance(name_or_path, str) and name_or_path:
            model_name = name_or_path

    step = raw_job.get("step")
    normalized_step = step if isinstance(step, int) and step >= 0 else 0

    return {
        "id": job_id,
        "name": name,
        "status": status,
        "step": normalized_step,
        "total_steps": _total_steps(raw_job, process_config),
        "info": raw_job.get("info") if isinstance(raw_job.get("info"), str) else None,
        "speed_string": raw_job.get("speed_string")
        if isinstance(raw_job.get("speed_string"), str)
        else None,
        "job_type": raw_job.get("job_type") if isinstance(raw_job.get("job_type"), str) else None,
        "dataset_folder": dataset_folder,
        "dataset_folder_name": _folder_name(dataset_folder),
        "model": model_name,
        "created_at": raw_job.get("created_at")
        if isinstance(raw_job.get("created_at"), str)
        else None,
        "save_now": _as_bool(raw_job.get("save_now")),
        "stop_requested": _as_bool(raw_job.get("stop")),
    }


def fetch_active_ostris_jobs() -> tuple[list[dict[str, Any]], bool]:
    try:
        with httpx.Client(timeout=OSTRIS_REQUEST_TIMEOUT_SECONDS) as client:
            response = client.get(OSTRIS_JOBS_URL)
            response.raise_for_status()
            payload = response.json()
    except (httpx.HTTPError, json.JSONDecodeError, TypeError, ValueError):
        return [], False

    if not isinstance(payload, dict):
        return [], False

    raw_jobs = payload.get("jobs")
    if not isinstance(raw_jobs, list):
        return [], True

    jobs: list[dict[str, Any]] = []
    for raw_job in raw_jobs:
        if not isinstance(raw_job, dict):
            continue
        normalized = normalize_ostris_job(raw_job)
        if normalized is not None:
            jobs.append(normalized)

    return jobs, True
