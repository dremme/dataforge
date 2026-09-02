"""Build and launch Ostris AI-Toolkit training jobs from a YAML template."""

from __future__ import annotations

import re
from copy import deepcopy
from pathlib import Path
from typing import Any

import httpx
import yaml

from constants import MEDIA_EXTENSIONS, VIDEO_EXTENSIONS
from external.ostris_jobs import (
    OSTRIS_REQUEST_TIMEOUT_SECONDS,
    create_ostris_job,
    fetch_ostris_job_by_name,
    fetch_ostris_training_folder,
    job_sample_prompts,
    queue_ostris_job,
    start_ostris_queue,
)

TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "ostris-templates"

DEFAULT_TRAINING_MODEL = "krea2_turbo"

TRAINING_TEMPLATES: dict[str, str] = {
    "krea2_turbo": "krea2-turbo.yml",
    "h3_fl2va": "h3-fl2va.yml",
    "h3_ref2va": "h3-ref2va.yml",
}

SAMPLES_DIR_NAME = "samples"

MAX_TEMPLATE_TEXT_LENGTH = 256 * 1024

MAX_LORA_NAME_LENGTH = 80
INVALID_NAME_CHARACTERS = frozenset('<>:"/\\|?*')

# Ostris writes samples as "<epoch millis>__<step zero-padded to 9>_<prompt index>.<ext>".
_SAMPLE_FILENAME = re.compile(r"^\d+__(\d+)_(\d+)$")


def _sample_preference(path: Path) -> tuple[int, int, str]:
    suffix = path.suffix.lower()
    if suffix == ".mp4":
        return (0, 0, suffix)
    if suffix in VIDEO_EXTENSIONS:
        return (0, 1, suffix)
    return (1, 0, suffix)


class OstrisTrainingError(Exception):
    pass


def validate_lora_name(name: str) -> None:
    """Reject names that cannot become a folder under the training folder."""
    if not name:
        raise ValueError("Enter a name for the LoRA")
    if len(name) > MAX_LORA_NAME_LENGTH:
        raise ValueError(f"The LoRA name can be at most {MAX_LORA_NAME_LENGTH} characters")
    if name in {".", ".."} or any(character in INVALID_NAME_CHARACTERS for character in name):
        raise ValueError('The LoRA name cannot contain < > : " / \\ | ? *')


def _process_config(config: dict[str, Any], source: str = "training template") -> dict[str, Any]:
    process = config.get("config", {}).get("process") if isinstance(config, dict) else None
    if not isinstance(process, list) or not process or not isinstance(process[0], dict):
        raise OstrisTrainingError(f"The {source} has no process configuration.")
    return process[0]


def read_training_template_text(model: str = DEFAULT_TRAINING_MODEL) -> str:
    """The template exactly as it sits on disk; parsing and re-dumping would drop comments."""
    filename = TRAINING_TEMPLATES.get(model)
    if filename is None:
        raise OstrisTrainingError(f'Unknown training model "{model}".')

    try:
        return (TEMPLATES_DIR / filename).read_text(encoding="utf-8")
    except OSError as exc:
        raise OstrisTrainingError(f"Could not read the training template {filename}.") from exc


def parse_training_template(raw: str, *, source: str = "training template") -> dict[str, Any]:
    """Parse template YAML and check it has the shape ``build_training_config`` fills."""
    if len(raw) > MAX_TEMPLATE_TEXT_LENGTH:
        raise OstrisTrainingError(
            f"The {source} is larger than {MAX_TEMPLATE_TEXT_LENGTH // 1024} KB."
        )

    try:
        template = yaml.safe_load(raw)
    except yaml.YAMLError as exc:
        raise OstrisTrainingError(f"The {source} is not valid YAML: {exc}") from exc

    if not isinstance(template, dict):
        raise OstrisTrainingError(f"The {source} is not a mapping.")

    process = _process_config(template, source)

    datasets = process.get("datasets")
    if not isinstance(datasets, list) or not datasets or not isinstance(datasets[0], dict):
        raise OstrisTrainingError(f"The {source} has no dataset configuration.")

    if not isinstance(process.get("sample"), dict):
        raise OstrisTrainingError(f"The {source} has no sample configuration.")

    return template


def load_training_template(model: str = DEFAULT_TRAINING_MODEL) -> dict[str, Any]:
    filename = TRAINING_TEMPLATES.get(model)
    if filename is None:
        raise OstrisTrainingError(f'Unknown training model "{model}".')

    return parse_training_template(read_training_template_text(model), source=filename)


def build_training_config(
    template: dict[str, Any],
    *,
    name: str,
    training_folder: str,
    dataset_folder: str,
    trigger_word: str = "",
    prompts: list[str],
) -> dict[str, Any]:
    """Fill the template's placeholders, leaving every other setting untouched."""
    config = deepcopy(template)
    process = _process_config(config)

    config["config"]["name"] = name
    process["training_folder"] = training_folder
    process["trigger_word"] = trigger_word.strip() or None

    datasets = process.get("datasets")
    if not isinstance(datasets, list) or not datasets or not isinstance(datasets[0], dict):
        raise OstrisTrainingError("The training template has no dataset configuration.")
    datasets[0]["folder_path"] = dataset_folder

    sample = process.get("sample")
    if not isinstance(sample, dict):
        raise OstrisTrainingError("The training template has no sample configuration.")
    sample["samples"] = [{"prompt": prompt} for prompt in prompts]

    meta = config.get("meta")
    if isinstance(meta, dict):
        meta["name"] = name

    return config


def create_and_start_training(
    client: httpx.Client,
    *,
    name: str,
    gpu_ids: str,
    config: dict[str, Any],
) -> str:
    """Create the job, queue it, and make sure its GPU queue is running. Returns the job id."""
    response = create_ostris_job(client, name=name, gpu_ids=gpu_ids, job_config=config)
    if response.status_code == 409:
        raise OstrisTrainingError(f'A training job named "{name}" already exists in AI-Toolkit.')
    response.raise_for_status()

    payload = response.json()
    job_id = payload.get("id") if isinstance(payload, dict) else None
    if not isinstance(job_id, str) or not job_id:
        raise OstrisTrainingError("AI-Toolkit did not return an id for the new training job.")

    queue_ostris_job(client, job_id)
    start_ostris_queue(client, gpu_ids)
    return job_id


def training_samples_folder(training_folder: str, name: str) -> Path:
    return Path(training_folder) / name / SAMPLES_DIR_NAME


def list_training_samples(
    training_folder: str,
    name: str,
    prompts: list[str] | None = None,
) -> tuple[list[dict[str, Any]], int | None]:
    """The samples from the most recent step, in prompt order, with their prompts attached."""
    samples_folder = training_samples_folder(training_folder, name)
    try:
        entries = [entry for entry in samples_folder.iterdir() if entry.is_file()]
    except OSError:
        return [], None

    grouped: dict[tuple[int, int], list[Path]] = {}
    for entry in entries:
        if entry.suffix.lower() not in MEDIA_EXTENSIONS:
            continue
        match = _SAMPLE_FILENAME.match(entry.stem)
        if match is None:
            continue
        key = (int(match.group(1)), int(match.group(2)))
        grouped.setdefault(key, []).append(entry)

    if not grouped:
        return [], None

    latest_step = max(step for step, _ in grouped)
    latest = sorted(
        (
            (step, index, min(paths, key=_sample_preference))
            for (step, index), paths in grouped.items()
            if step == latest_step
        ),
        key=lambda item: item[1],
    )

    prompt_list = prompts or []
    samples = [
        {
            "path": str(path),
            "name": path.name,
            "step": step,
            "prompt": prompt_list[index] if index < len(prompt_list) else "",
        }
        for step, index, path in latest
    ]
    return samples, latest_step


def fetch_training_samples(name: str) -> tuple[list[dict[str, Any]], int | None, bool]:
    """Latest samples for a training run, degrading quietly when AI-Toolkit is offline."""
    try:
        with httpx.Client(timeout=OSTRIS_REQUEST_TIMEOUT_SECONDS) as client:
            training_folder = fetch_ostris_training_folder(client)
            if training_folder is None:
                return [], None, True
            raw_job = fetch_ostris_job_by_name(client, name)
    except (httpx.HTTPError, ValueError, TypeError):
        return [], None, False

    prompts = job_sample_prompts(raw_job) if raw_job is not None else []
    samples, step = list_training_samples(training_folder, name, prompts)
    return samples, step, True
