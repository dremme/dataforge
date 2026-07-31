"""Quick LoRA training, run by the local Ostris AI-Toolkit and tracked here.

DataForge creates the AI-Toolkit job from a YAML template, queues it, and then only
polls: the run ends by itself at the template's step count. Cancelling asks
AI-Toolkit for a checkpoint save first so no training progress is thrown away.
"""

from __future__ import annotations

import re
import time
from collections.abc import Callable
from pathlib import Path
from typing import Any

import httpx

from automation.selection import list_folder_media
from constants import MEDIA_EXTENSIONS
from external.ostris_jobs import (
    OSTRIS_TRAIN_POLL_INTERVAL_SECONDS,
    TERMINAL_OSTRIS_STATUSES,
    fetch_ostris_gpu_ids,
    fetch_ostris_job,
    fetch_ostris_job_by_name,
    fetch_ostris_training_folder,
    mark_ostris_job_stopped,
    ostris_job_total_steps,
    stop_ostris_job_with_checkpoint,
)
from external.ostris_training import (
    OstrisTrainingError,
    build_training_config,
    create_and_start_training,
    list_training_samples,
    load_training_template,
    training_samples_folder,
    validate_lora_name,
)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

OSTRIS_TRAINING_TIMEOUT_SECONDS = 30.0


def _clean_prompts(prompts: list[str] | None) -> list[str]:
    return [prompt.strip() for prompt in (prompts or []) if prompt.strip()]


def list_train_lora_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="name")


def validate_train_lora_folder(
    folder: Path,
    *,
    lora_name: str = "",
    prompts: list[str] | None = None,
    **_params: object,
) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not list_train_lora_media(folder):
        raise ValueError("No supported images or videos found in folder")

    validate_lora_name(lora_name.strip())

    if not _clean_prompts(prompts):
        raise ValueError("Add at least one example prompt")


def _int_or_none(value: Any) -> int | None:
    return value if isinstance(value, int) and value > 0 else None


_SPEED_SEC_PER_ITER = re.compile(r"([\d.]+)\s*sec/iter", re.IGNORECASE)


def _speed_ms_per_step(job: dict[str, Any]) -> int | None:
    """Parse Ostris speed_string into integer milliseconds per step for job stats."""
    raw = job.get("speed_string")
    if not isinstance(raw, str):
        return None
    match = _SPEED_SEC_PER_ITER.search(raw)
    if match is None:
        return None
    try:
        seconds = float(match.group(1))
    except ValueError:
        return None
    if seconds <= 0:
        return None
    return max(1, round(seconds * 1000))


def _progress_label(job: dict[str, Any]) -> str:
    info = job.get("info")
    speed = job.get("speed_string")
    parts = [part for part in (info, speed) if isinstance(part, str) and part]
    return " - ".join(parts)


def _request_stop(client: httpx.Client, job_id: str, status: str) -> None:
    """Stop the run the gentlest way its current state allows."""
    if status == "running":
        stop_ostris_job_with_checkpoint(job_id)
        return
    mark_ostris_job_stopped(client, job_id)


def _resolve_training_job(
    client: httpx.Client,
    *,
    name: str,
    folder: Path,
    training_folder: str,
    trigger_word: str,
    prompts: list[str],
    attach_only: bool,
) -> tuple[str, dict[str, Any]]:
    """The AI-Toolkit job to track, creating it unless we are re-attaching to a live one."""
    existing = fetch_ostris_job_by_name(client, name)
    if existing is not None and existing.get("status") not in TERMINAL_OSTRIS_STATUSES:
        job_id = existing.get("id")
        if isinstance(job_id, str) and job_id:
            return job_id, existing

    if attach_only:
        if existing is not None:
            job_id = existing.get("id")
            if isinstance(job_id, str) and job_id:
                return job_id, existing
        raise OstrisTrainingError(f'AI-Toolkit no longer has a training job named "{name}".')

    gpu_ids = fetch_ostris_gpu_ids(client)
    config = build_training_config(
        load_training_template(),
        name=name,
        training_folder=training_folder,
        dataset_folder=str(folder),
        trigger_word=trigger_word,
        prompts=prompts,
    )
    job_id = create_and_start_training(client, name=name, gpu_ids=gpu_ids, config=config)

    started = fetch_ostris_job(client, job_id)
    return job_id, started or {"id": job_id, "status": "queued", "step": 0}


def run_train_lora_job(
    folder: Path,
    *,
    lora_name: str = "",
    trigger_word: str = "",
    prompts: list[str] | None = None,
    attach_only: bool = False,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    selected_paths: list[Path] | None = None,
    poll_interval_seconds: float = OSTRIS_TRAIN_POLL_INTERVAL_SECONDS,
) -> dict[str, object]:
    del selected_paths  # AI-Toolkit always trains on the whole dataset folder.

    name = lora_name.strip()
    sample_prompts = _clean_prompts(prompts)

    with httpx.Client(timeout=OSTRIS_TRAINING_TIMEOUT_SECONDS) as client:
        training_folder = fetch_ostris_training_folder(client)
        if training_folder is None:
            raise OstrisTrainingError("AI-Toolkit did not report a training folder.")

        job_id, job = _resolve_training_job(
            client,
            name=name,
            folder=folder,
            training_folder=training_folder,
            trigger_word=trigger_word,
            prompts=sample_prompts,
            attach_only=attach_only,
        )

        samples_folder = str(training_samples_folder(training_folder, name))
        stop_requested = False
        total_steps = 0
        step = 0
        status = ""

        while True:
            if job is None:
                raise OstrisTrainingError(f'AI-Toolkit lost the training job "{name}".')

            status = str(job.get("status") or "")
            step = max(step, _int_or_none(job.get("step")) or 0)
            # Ostris often omits top-level total_steps; the config train.steps is authoritative.
            total_steps = ostris_job_total_steps(job) or total_steps

            if on_progress:
                stats: dict[str, int] = {"step": step, "total_steps": total_steps}
                speed_ms = _speed_ms_per_step(job)
                if speed_ms is not None:
                    stats["speed_ms_per_step"] = speed_ms
                on_progress(
                    samples_folder,
                    _progress_label(job),
                    step,
                    total_steps,
                    stats,
                )

            if status in TERMINAL_OSTRIS_STATUSES:
                break

            if not stop_requested and should_cancel and should_cancel():
                stop_requested = True
                _request_stop(client, job_id, status)

            time.sleep(poll_interval_seconds)
            job = fetch_ostris_job(client, job_id)

        if status == "error":
            raise OstrisTrainingError(_progress_label(job) or "The training job failed.")

        samples, sample_step = list_training_samples(training_folder, name, sample_prompts)

    return {
        "folder": str(folder),
        "total": total_steps or step,
        "processed": step,
        "stats": {
            "step": step,
            "total_steps": total_steps,
            "samples": len(samples),
            "stopped": 1 if status == "stopped" else 0,
        },
        "results": [
            {
                "path": sample["path"],
                "name": sample["name"],
                "status": "sample",
                "description": sample["prompt"],
                "message": f"Step {sample_step}" if sample_step is not None else None,
            }
            for sample in samples
        ],
    }
