"""Run every image in a folder through a ComfyUI workflow, staging the results.

Upscaling, watermark removal and defect repair all have the same shape: one graph, one
image at a time, and a result nobody should trust sight unseen. So this job never writes
into the dataset. Each result lands in ``<folder>/staging/`` under the source's own name,
beside a record of what produced it, and the review queue decides what becomes real.

The graph itself stays in ComfyUI, where it is authored and where it belongs. A preset is
an API-format export with its input and output nodes titled; see ``external.comfy_workflows``.
"""

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
    candidate_path_for,
    difference_percent,
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
from image_io import ImageReadError, load_image_for_edit, save_image_preserving_format
from logging_config import configure_logging, log_job_summary
from schemas import ComfyCandidateSidecar

logger = logging.getLogger(__name__)

#: Every terminal outcome one file can reach, summed into the job's ``processed`` count.
#: A run that handled every file has to end at ``total``, so each new ``FileOutcome``
#: status belongs here - ``skipped`` included, because the job looked at that file and
#: decided there was nothing to do, which is handled rather than pending. Leaving it out
#: is what stalled a 76-image run at 74/76.
#:
#: ``cancelled`` is deliberately absent: it also counts the files that were never
#: started, so counting it would report a cancelled run as complete. And the keys are
#: listed rather than falling back to the number of results because ``stats`` also
#: carries the ``seconds_per_image`` gauge, which is not a count of anything.
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

# ComfyUI runs one graph at a time on one GPU. Holding this across submit-and-wait keeps
# at most one DataForge image in its queue, so two jobs on two folders interleave whole
# images rather than piling up behind each other with meaningless ETAs - and so the
# interrupt below can only ever be aimed at our own prompt.
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
    """Refuse at queue time what would otherwise fail on the first file.

    Deliberately does not probe ComfyUI. Starting ComfyUI and opening this dialog race
    each other, and a job that fails on file one with the reason attached is already
    loud enough - unlike ``train_lora``, nothing here has to reach a remote service in
    order to *create* anything.
    """
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
        # ValueError is what queue_job lets through as a 400; a ComfyWorkflowError would
        # escape the route as a 500 and lose the message that names the fix.
        raise ValueError(str(exc)) from exc

    # Refuse rather than drop it. `build_comfy_prompt` has nowhere to put the text when
    # the preset carries no prompt node, and a run that quietly ignored what the user
    # typed would look like the prompt simply had no effect on the model.
    if prompt_text.strip() and workflow.prompt_node is None:
        raise ValueError(
            f'The preset "{preset}" has no node titled "{PROMPT_NODE_TITLE}", so there is '
            f"nowhere to put a prompt. Title one in ComfyUI and re-export it, or clear the "
            f"prompt to run the workflow as saved."
        )

    if not filter_media_list(list_comfy_process_files(folder), selected_paths):
        raise ValueError("No images to process in this folder")


def _request_stop(client: httpx.Client, prompt_id: str) -> None:
    """Take our prompt out of ComfyUI, without touching anyone else's.

    ``/interrupt`` has no prompt argument: it kills whatever is executing right now,
    which may be another job's image or the user's own work in the ComfyUI tab. So the
    queue is read first, and the blunt call is only made once our prompt is confirmed to
    be the one running.
    """
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
    """Poll until the prompt finishes, and return the ref for the image it wrote.

    Cancellation is checked here rather than only between files: at a minute or more per
    image, ``run_media_job``'s between-files check would leave a cancelled job looking
    dead for the length of whatever is in flight.
    """
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
            # Last wins: a graph that previews an intermediate step and saves the final
            # one lists them in execution order.
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
    """Save ComfyUI's bytes under the source's name, in the source's format.

    Re-encoded rather than written through, because the candidate must be able to stand
    in for the source: the review queue, the accept, and every full-filename sidecar all
    pair the two by name, and a ``photo.jpg`` whose candidate is a PNG would orphan the
    caption, issue and duplicate records the moment it was accepted.

    Returns how far the result moved from the source, for the sidecar. Scored here rather
    than anywhere tidier because this is the one moment both images are decoded and in
    hand - the source was already being read for its mode and EXIF, and its pixels were
    being thrown away. Doing it later means opening two files again, one of them an
    upscale.
    """
    try:
        with Image.open(io.BytesIO(data)) as opened:
            opened.load()
            produced = opened.convert("RGBA")
    except (OSError, UnidentifiedImageError) as exc:
        raise ComfyError(f"ComfyUI returned something that is not an image: {exc}") from exc

    # The mode and EXIF go to the saved file; the pixels come from ComfyUI and the
    # original's are only compared against.
    original, source_mode, exif = load_image_for_edit(source)
    difference = difference_percent(original, produced)

    temp_path = temp_path_for(destination)
    try:
        save_image_preserving_format(
            produced,
            temp_path,
            suffix=destination.suffix,
            source_mode=source_mode,
            exif=exif,
        )
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
        # An empty box means "run the graph as saved", which is not the same request as
        # writing an empty prompt into it, so it stays None rather than "".
        prompt_text=prompt_text or None,
    )

    with _gpu_lock:
        prompt_id = submit_prompt(client, prompt, client_id=client_id)
        ref = _await_output(client, prompt_id, should_cancel=should_cancel)
        data = download_view(client, ref)

    destination = candidate_path_for(media_path)
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

    # One client for the whole run, so three hundred images share one connection pool.
    client = httpx.Client(timeout=COMFY_TRANSFER_TIMEOUT_SECONDS)
    counter = {"index": 0}

    def process(media_path: Path) -> FileOutcome:
        counter["index"] += 1

        if not overwrite_candidates and candidate_path_for(media_path).is_file():
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
            # The dead `preview` field on JobFileResult, finally carrying something: it
            # gives the results panel a thumbnail of what was staged for free.
            fields={"preview": str(candidate_path_for(media_path))},
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
