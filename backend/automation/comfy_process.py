"""Run every image in a folder through a ComfyUI workflow, staging the results."""

from __future__ import annotations

import argparse
import io
import logging
import threading
import time
import uuid
from collections.abc import Callable
from contextlib import suppress
from datetime import UTC, datetime
from pathlib import Path

import httpx
from PIL import Image, UnidentifiedImageError

from automation.job_runner import CANCELLED, FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from comfy_candidates import (
    candidate_write_path,
    difference_percent,
    has_candidate,
    staging_dir,
    stale_path_for,
    sweep_comfy_temp_files,
    temp_path_for,
    write_candidate_sidecar,
)
from comfy_settings import get_comfy_image_timeout
from constants import COMFY_PROCESS_EXTENSIONS, STAGING_DIR_NAME
from external.comfy_client import (
    COMFY_POLL_INTERVAL_SECONDS,
    COMFY_TRANSFER_TIMEOUT_SECONDS,
    ComfyError,
    ComfyPromptError,
    ComfyUnavailableError,
    delete_queued,
    download_view,
    fetch_history,
    fetch_queue,
    history_error_text,
    history_is_finished,
    history_outputs,
    interrupt,
    submit_prompt,
    upload_image,
)
from external.comfy_workflows import (
    PROMPT_NODE_TITLE,
    ComfyWorkflow,
    ComfyWorkflowError,
    build_comfy_prompt,
    load_comfy_workflow,
)
from file_publish import publish_replacing
from image_io import ImageReadError, load_image_for_edit
from logging_config import configure_logging, log_job_summary
from schemas import ComfyCandidateSidecar

logger = logging.getLogger(__name__)

# Terminal per-file statuses. Omit ``cancelled`` or a cancelled run looks complete.
PROCESSED_STAT_KEYS = (
    "success",
    "skipped",
    "comfy_error",
    "read_error",
    "write_error",
)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

NO_OUTPUT_MESSAGE = "The workflow produced no image"

# One image in ComfyUI at a time so interrupt can only target our own prompt.
_gpu_lock = threading.Lock()


class ComfyProcessCancelled(Exception):
    """Raised when a cancel arrives while an image is in ComfyUI's queue."""


def list_comfy_process_files(folder: Path) -> list[Path]:
    return list_folder_media(folder, COMFY_PROCESS_EXTENSIONS, order="name")


def validate_comfy_process_folder(
    folder: Path,
    *,
    preset: str = "",
    prompt_text: str = "",
    selected_paths: list[Path] | None = None,
    **_ignored: object,
) -> None:
    """Refuse at queue time what would otherwise fail on the first file. Does not probe ComfyUI."""
    if not folder.is_dir():
        raise ValueError(f"Folder not found: {folder}")

    if folder.name == STAGING_DIR_NAME:
        raise ValueError(
            "This is a staging folder. Run the job on the dataset folder above it, or its "
            "candidates would get candidates of their own."
        )

    staging = staging_dir(folder)
    if staging.exists() and not staging.is_dir():
        raise ValueError(
            f"{STAGING_DIR_NAME} exists here as a file, so candidates cannot be written"
        )

    try:
        workflow = load_comfy_workflow(preset)
    except ComfyWorkflowError as exc:
        # ValueError is a 400; ComfyWorkflowError would escape the route as a 500.
        raise ValueError(str(exc)) from exc

    # Refuse rather than drop a prompt when the preset has no prompt node.
    if prompt_text.strip() and workflow.prompt_node is None:
        raise ValueError(
            f'The preset "{preset}" has no node titled "{PROMPT_NODE_TITLE}", so there is '
            f"nowhere to put a prompt. Title one in ComfyUI and re-export it, or clear the "
            f"prompt to run the workflow as saved."
        )

    if not filter_media_list(list_comfy_process_files(folder), selected_paths):
        raise ValueError("No images to process in this folder")


def _request_stop(client: httpx.Client, prompt_id: str) -> None:
    """Take our prompt out of ComfyUI; ``/interrupt`` only after the queue confirms it is ours."""
    try:
        running, pending = fetch_queue(client)
    except ComfyError:
        return

    if prompt_id in running:
        with suppress(ComfyError):
            interrupt(client)
        return

    if prompt_id in pending:
        with suppress(ComfyError):
            delete_queued(client, prompt_id)


def _await_output(
    client: httpx.Client,
    prompt_id: str,
    *,
    should_cancel: ShouldCancel | None,
) -> dict[str, str]:
    """Poll until the prompt finishes; cancel is checked here because one image can take a minute."""
    deadline = time.monotonic() + get_comfy_image_timeout()
    stop_requested = False

    while True:
        entry = fetch_history(client, prompt_id)
        if entry is not None and history_is_finished(entry):
            error = history_error_text(entry)
            if error:
                raise ComfyPromptError(error)

            refs = history_outputs(entry)
            if not refs:
                raise ComfyPromptError(NO_OUTPUT_MESSAGE)
            return refs[-1]

        if not stop_requested and should_cancel and should_cancel():
            stop_requested = True
            _request_stop(client, prompt_id)
            raise ComfyProcessCancelled

        if time.monotonic() > deadline:
            _request_stop(client, prompt_id)
            raise ComfyError(
                f"ComfyUI did not finish this image within {get_comfy_image_timeout():.0f}s"
            )

        time.sleep(COMFY_POLL_INTERVAL_SECONDS)


def _write_candidate(source: Path, data: bytes, destination: Path) -> float:
    """Stage ComfyUI's PNG bytes untouched; accept re-encodes into the source's format."""
    try:
        with Image.open(io.BytesIO(data)) as opened:
            opened.load()
            produced = opened.convert("RGBA")
    except (OSError, UnidentifiedImageError) as exc:
        raise ComfyError(f"ComfyUI returned something that is not an image: {exc}") from exc

    original, _, _ = load_image_for_edit(source)
    difference = difference_percent(original, produced)

    temp_path = temp_path_for(destination)
    try:
        temp_path.write_bytes(data)
        publish_replacing(temp_path, destination, stale_path_for(destination))
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)

    return difference


def _process_one(
    client: httpx.Client,
    media_path: Path,
    *,
    workflow: ComfyWorkflow,
    job_tag: str,
    index: int,
    seed: int | None,
    prompt_text: str,
    client_id: str,
    should_cancel: ShouldCancel | None,
) -> None:
    upload_name = f"{job_tag}_{index:05d}{media_path.suffix.lower()}"
    image_ref = upload_image(client, media_path, name=upload_name)

    prompt = build_comfy_prompt(
        workflow,
        image_ref=image_ref,
        filename_prefix=f"DataForge/{job_tag}/{media_path.stem}",
        seed=seed,
        # Empty box means run the graph as saved, not write "" into the prompt node.
        prompt_text=prompt_text or None,
    )

    with _gpu_lock:
        prompt_id = submit_prompt(client, prompt, client_id=client_id)
        ref = _await_output(client, prompt_id, should_cancel=should_cancel)
        data = download_view(client, ref)

    destination = candidate_write_path(media_path)
    difference = _write_candidate(media_path, data, destination)
    write_candidate_sidecar(
        destination,
        ComfyCandidateSidecar(
            source_name=media_path.name,
            preset=workflow.preset,
            prompt_id=prompt_id,
            seed=seed,
            prompt_text=prompt_text or None,
            difference_percent=difference,
            created_at=datetime.now(tz=UTC).isoformat(),
        ),
    )


def run_comfy_process_job(
    folder: Path,
    *,
    on_progress: ProgressCallback | None = None,
    should_cancel: ShouldCancel | None = None,
    preset: str = "",
    seed: int | None = None,
    prompt_text: str = "",
    overwrite_candidates: bool = False,
    selected_paths: list[Path] | None = None,
) -> dict[str, object]:
    validate_comfy_process_folder(
        folder, preset=preset, prompt_text=prompt_text, selected_paths=selected_paths
    )

    workflow = load_comfy_workflow(preset)
    media_files = filter_media_list(list_comfy_process_files(folder), selected_paths)

    output_dir = staging_dir(folder)
    output_dir.mkdir(exist_ok=True)
    sweep_comfy_temp_files(output_dir)

    stats: dict[str, int] = {"total": len(media_files)}
    job_tag = uuid.uuid4().hex[:8]
    client_id = uuid.uuid4().hex

    client = httpx.Client(timeout=COMFY_TRANSFER_TIMEOUT_SECONDS)
    counter = {"index": 0}

    def process(media_path: Path) -> FileOutcome:
        counter["index"] += 1

        if not overwrite_candidates and has_candidate(media_path):
            return FileOutcome(
                status="skipped",
                stats={"skipped": 1},
                fields={"message": "A candidate is already staged for this image"},
            )

        started = time.monotonic()
        try:
            _process_one(
                client,
                media_path,
                workflow=workflow,
                job_tag=job_tag,
                index=counter["index"],
                seed=seed,
                prompt_text=prompt_text.strip(),
                client_id=client_id,
                should_cancel=should_cancel,
            )
        except ComfyProcessCancelled:
            return FileOutcome(status=CANCELLED, stats={"cancelled": 1}, stop=True)
        except ComfyUnavailableError as exc:
            return FileOutcome(
                status="comfy_error",
                stats={"comfy_error": 1},
                fields={"message": f"ComfyUI is not reachable: {exc}"},
            )
        except ComfyPromptError as exc:
            return FileOutcome(
                status="comfy_error",
                stats={"comfy_error": 1},
                fields={"message": str(exc)},
            )
        except ComfyError as exc:
            return FileOutcome(
                status="comfy_error", stats={"comfy_error": 1}, fields={"message": str(exc)}
            )
        except ImageReadError as exc:
            return FileOutcome(
                status="read_error", stats={"read_error": 1}, fields={"message": str(exc)}
            )
        except OSError as exc:
            return FileOutcome(
                status="write_error", stats={"write_error": 1}, fields={"message": str(exc)}
            )

        elapsed = time.monotonic() - started
        stats["seconds_per_image"] = int(elapsed)
        return FileOutcome(
            status="success",
            stats={"success": 1},
            fields={"preview": str(candidate_write_path(media_path))},
        )

    try:
        return run_media_job(
            folder,
            media_files,
            stats=stats,
            process=process,
            on_progress=on_progress,
            should_cancel=should_cancel,
            processed_stat_keys=PROCESSED_STAT_KEYS,
        )
    finally:
        client.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run a folder's images through a ComfyUI preset")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--preset", required=True)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--overwrite-candidates", action="store_true")
    args = parser.parse_args(argv)

    configure_logging()

    try:
        result = run_comfy_process_job(
            args.folder,
            preset=args.preset,
            seed=args.seed,
            overwrite_candidates=args.overwrite_candidates,
        )
    except ValueError as exc:
        logger.error("%s", exc)
        return 1

    log_job_summary(logger, result)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
