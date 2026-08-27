"""Quick LoRA training, run by the local Ostris AI-Toolkit and tracked here."""

from __future__ import annotations

import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from automation.selection import list_folder_media
from constants import MEDIA_EXTENSIONS
from external.ostris_jobs import (
    OSTRIS_TRAIN_POLL_INTERVAL_SECONDS,
    OSTRIS_TRAINING_TIMEOUT_SECONDS,
    TERMINAL_OSTRIS_STATUSES,
    fetch_ostris_gpu_ids,
    fetch_ostris_job,
    fetch_ostris_job_by_name,
    fetch_ostris_training_folder,
    mark_ostris_job_stopped,
    ostris_job_speed_seconds_per_step,
    ostris_job_total_steps,
    stop_ostris_job_with_checkpoint,
)
from external.ostris_training import (
    DEFAULT_TRAINING_MODEL,
    TRAINING_TEMPLATES,
    OstrisTrainingError,
    build_training_config,
    create_and_start_training,
    list_training_samples,
    load_training_template,
    parse_training_template,
    training_samples_folder,
    validate_lora_name,
)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]


def _clean_prompts(prompts: list[str] | None) -> list[str]:
    return [prompt.strip() for prompt in (prompts or []) if prompt.strip()]


def list_train_lora_media(folder: Path) -> list[Path]:
    return list_folder_media(folder, MEDIA_EXTENSIONS, order="name")


def validate_train_lora_folder(
    folder: Path,
    *,
    lora_name: str = "",
    prompts: list[str] | None = None,
    model: str = DEFAULT_TRAINING_MODEL,
    template: str | None = None,
    **_params: object,
) -> None:
    if not folder.is_dir():
        raise ValueError("Folder not found")

    if not list_train_lora_media(folder):
        raise ValueError("No supported images or videos found in folder")

    validate_lora_name(lora_name.strip())

    if not _clean_prompts(prompts):
        raise ValueError("Add at least one example prompt")

    if model not in TRAINING_TEMPLATES:
        raise ValueError(f'Unknown training model "{model}"')

    if template is not None:
        try:
            parse_training_template(template, source="edited training template")
        except OstrisTrainingError as exc:
            raise ValueError(str(exc)) from exc


def _int_or_none(value: Any) -> int | None:
    return value if isinstance(value, int) and value > 0 else None


def _progress_label(job: dict[str, Any]) -> str:
    info = job.get("info")
    speed = job.get("speed_string")
    parts = [part for part in (info, speed) if isinstance(part, str) and part]
    return " - ".join(parts)


def _progress_stats(job: dict[str, Any], step: int, total_steps: int) -> dict[str, int]:
    stats = {"step": step, "total_steps": total_steps}

    seconds_per_step = ostris_job_speed_seconds_per_step(job)
    if seconds_per_step is not None:
        stats["speed_ms_per_step"] = max(1, round(seconds_per_step * 1000))

    return stats


def _request_stop(client: httpx.Client, job_id: str, status: str) -> None:
    """Stop the run the gentlest way its current state allows."""
    if status == "running":
        # Own client: saving a checkpoint takes far longer than our request timeout.
        stop_ostris_job_with_checkpoint(job_id)
        return
    mark_ostris_job_stopped(client, job_id)


def _job_id(job: dict[str, Any] | None) -> str | None:
    job_id = job.get("id") if job is not None else None
    return job_id if isinstance(job_id, str) and job_id else None


def _training_template(model: str, template: str | None) -> dict[str, Any]:
    """The edited YAML when this run carries one, otherwise the shipped template."""
    if template is None:
        return load_training_template(model)
    return parse_training_template(template, source="edited training template")


def _resolve_training_job(
    client: httpx.Client,
    *,
    name: str,
    folder: Path,
    training_folder: str,
    trigger_word: str,
    prompts: list[str],
    model: str,
    template: str | None,
    attach_only: bool,
) -> tuple[str, dict[str, Any]]:
    """The AI-Toolkit job to track, creating it unless we are re-attaching to a live one."""
    existing = fetch_ostris_job_by_name(client, name)
    existing_id = _job_id(existing)
    if existing is not None and existing_id is not None:
        still_live = existing.get("status") not in TERMINAL_OSTRIS_STATUSES
        if attach_only or still_live:
            return existing_id, existing

    if attach_only:
        raise OstrisTrainingError(f'AI-Toolkit no longer has a training job named "{name}".')

    gpu_ids = fetch_ostris_gpu_ids(client)
    config = build_training_config(
        _training_template(model, template),
        name=name,
        training_folder=training_folder,
        dataset_folder=str(folder),
        trigger_word=trigger_word,
        prompts=prompts,
    )
    job_id = create_and_start_training(client, name=name, gpu_ids=gpu_ids, config=config)

    started = fetch_ostris_job(client, job_id)
    return job_id, started or {"id": job_id, "status": "queued", "step": 0}


@dataclass(frozen=True)
class _TrainingOutcome:
    """How the AI-Toolkit run ended, and how far it got."""

    status: str
    step: int
    total_steps: int
    label: str


def _poll_until_terminal(
    client: httpx.Client,
    job_id: str,
    job: dict[str, Any] | None,
    *,
    name: str,
    samples_folder: str,
    on_progress: ProgressCallback | None,
    should_cancel: ShouldCancel | None,
    poll_interval_seconds: float,
) -> _TrainingOutcome:
    """Follow the run to its end, reporting progress and forwarding a cancel once."""
    stop_requested = False
    total_steps = 0
    step = 0

    while True:
        if job is None:
            raise OstrisTrainingError(f'AI-Toolkit lost the training job "{name}".')

        status = str(job.get("status") or "")
        step = max(step, _int_or_none(job.get("step")) or 0)
        # Ostris often omits top-level total_steps; config train.steps is authoritative.
        total_steps = ostris_job_total_steps(job) or total_steps
        label = _progress_label(job)

        if on_progress:
            on_progress(
                samples_folder,
                label,
                step,
                total_steps,
                _progress_stats(job, step, total_steps),
            )

        if status in TERMINAL_OSTRIS_STATUSES:
            return _TrainingOutcome(status=status, step=step, total_steps=total_steps, label=label)

        if not stop_requested and should_cancel and should_cancel():
            stop_requested = True
            _request_stop(client, job_id, status)

        time.sleep(poll_interval_seconds)
        job = fetch_ostris_job(client, job_id)


def run_train_lora_job(
    folder: Path,
    *,
    lora_name: str = "",
    trigger_word: str = "",
    prompts: list[str] | None = None,
    model: str = DEFAULT_TRAINING_MODEL,
    template: str | None = None,
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
            model=model,
            template=template,
            attach_only=attach_only,
        )

        outcome = _poll_until_terminal(
            client,
            job_id,
            job,
            name=name,
            samples_folder=str(training_samples_folder(training_folder, name)),
            on_progress=on_progress,
            should_cancel=should_cancel,
            poll_interval_seconds=poll_interval_seconds,
        )

        if outcome.status == "error":
            raise OstrisTrainingError(outcome.label or "The training job failed.")

        samples, sample_step = list_training_samples(training_folder, name, sample_prompts)

    return {
        "folder": str(folder),
        "total": outcome.total_steps or outcome.step,
        "processed": outcome.step,
        "stats": {
            "step": outcome.step,
            "total_steps": outcome.total_steps,
            "samples": len(samples),
            "stopped": 1 if outcome.status == "stopped" else 0,
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
