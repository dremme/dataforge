"""Run every file in a folder through a ComfyUI workflow, staging the results for review."""

from __future__ import annotations

import argparse
import logging
import threading
import time
import uuid
from collections.abc import Callable, Iterator
from contextlib import contextmanager, suppress
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import httpx
from PIL import Image, UnidentifiedImageError

from automation.job_runner import CANCELLED, FileOutcome, run_media_job
from automation.selection import filter_media_list, list_folder_media
from comfy_candidates import (
    candidate_write_path,
    difference_percent,
    discard_stale_candidate,
    has_candidate,
    staging_dir,
    stale_path_for,
    sweep_comfy_temp_files,
    temp_path_for,
    validate_candidate_destination,
    write_candidate_sidecar,
)
from comfy_settings import get_comfy_media_timeout
from constants import (
    COMFY_CANDIDATE_SUFFIXES,
    COMFY_PROCESS_EXTENSIONS,
    MOTION_EXTENSIONS,
    STAGING_DIR_NAME,
)
from external.comfy_client import (
    COMFY_POLL_INTERVAL_SECONDS,
    COMFY_TRANSFER_TIMEOUT_SECONDS,
    ComfyError,
    ComfyPromptError,
    ComfyUnavailableError,
    delete_queued,
    download_view_to,
    fetch_history,
    fetch_queue,
    history_error_text,
    history_is_finished,
    history_outputs,
    interrupt,
    submit_prompt,
    upload_media,
)
from external.comfy_workflows import (
    PROMPT_NODE_TITLE,
    ComfyWorkflow,
    ComfyWorkflowError,
    build_comfy_prompt,
    load_comfy_workflow,
)
from file_publish import publish_replacing
from folder_scan import get_media_type
from image_io import ImageReadError, load_image_for_edit
from logging_config import configure_logging, log_job_summary
from media_dimensions import media_info
from schemas import ComfyCandidateSidecar
from video_edit import SourceProbe, probe_source
from video_frames import (
    media_first_frame,
    media_has_audio,
    source_frame_rate,
    validate_candidate_media,
)

logger = logging.getLogger(__name__)

ProgressCallback = Callable[[str, str, int, int, dict[str, int]], None]
ShouldCancel = Callable[[], bool]

# Terminal per-file statuses. Omit ``cancelled`` or a cancelled run looks complete.
PROCESSED_STAT_KEYS = (
    "success",
    "skipped",
    "comfy_error",
    "read_error",
    "write_error",
)

NO_OUTPUT_MESSAGE = "The workflow produced no output"

#: Container rounding and a re-encode move the last frame; inside this, two clips match.
CANDIDATE_DURATION_TOLERANCE_SECONDS = 0.25
CANDIDATE_DURATION_TOLERANCE_FRACTION = 0.02


class ComfyProcessCancelled(Exception):
    """Raised when a cancel arrives while a file is in ComfyUI's queue."""


class CandidateConflictError(Exception):
    """The name this candidate would take is claimed by another source in the folder."""


# One file in ComfyUI at a time so interrupt can only target our own prompt.
_gpu_lock = threading.Lock()


@contextmanager
def _gpu_slot(should_cancel: ShouldCancel | None) -> Iterator[None]:
    """Wait for the slot in polls, not one blocking acquire: a whole video file can hold it for an
    hour, and a thread parked in ``acquire`` never looks at ``should_cancel`` again."""
    while not _gpu_lock.acquire(timeout=COMFY_POLL_INTERVAL_SECONDS):
        if should_cancel and should_cancel():
            raise ComfyProcessCancelled

    try:
        yield
    finally:
        _gpu_lock.release()


@dataclass(frozen=True, slots=True)
class CandidateFacts:
    """What review needs to judge a candidate, measured while both files are already open."""

    difference_percent: float | None = None
    frame_rate: float | None = None
    source_frame_rate: float | None = None
    frame_count: int | None = None
    source_frame_count: int | None = None
    duration_seconds: float | None = None
    source_duration_seconds: float | None = None
    length_mismatch: bool = False
    dropped_audio: bool = False


def list_comfy_process_files(folder: Path) -> list[Path]:
    return list_folder_media(folder, COMFY_PROCESS_EXTENSIONS, order="name")


def _is_motion(suffix: str) -> bool:
    return suffix.lower() in MOTION_EXTENSIONS


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
        raise ValueError("No media to process in this folder")


def _request_stop(client: httpx.Client, prompt_id: str) -> None:
    try:
        running, pending = fetch_queue(client)
    except ComfyError:
        return

    if prompt_id in running:
        with suppress(ComfyError):
            interrupt(client, prompt_id)
        return

    if prompt_id in pending:
        with suppress(ComfyError):
            delete_queued(client, prompt_id)


def _await_output(
    client: httpx.Client,
    prompt_id: str,
    *,
    output_node: str,
    timeout: float,
    should_cancel: ShouldCancel | None,
) -> dict[str, str]:
    """Poll until the prompt finishes; cancel is checked here because one file can take an hour."""
    deadline = time.monotonic() + timeout
    stop_requested = False

    while True:
        entry = fetch_history(client, prompt_id)
        if entry is not None and history_is_finished(entry):
            error = history_error_text(entry)
            if error:
                raise ComfyPromptError(error)

            # This node only: a graph that also wrote a preview would otherwise stage the preview.
            refs = history_outputs(entry, node_id=output_node)
            if not refs:
                raise ComfyPromptError(NO_OUTPUT_MESSAGE)
            return refs[-1]

        if not stop_requested and should_cancel and should_cancel():
            stop_requested = True
            _request_stop(client, prompt_id)
            raise ComfyProcessCancelled

        if time.monotonic() > deadline:
            _request_stop(client, prompt_id)
            raise ComfyError(f"ComfyUI did not finish this file within {timeout:.0f}s")

        time.sleep(COMFY_POLL_INTERVAL_SECONDS)


def _publish(temp_path: Path, destination: Path) -> None:
    try:
        publish_replacing(temp_path, destination, stale_path_for(destination))
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)


def _stage_image_candidate(source: Path, temp_path: Path, destination: Path) -> CandidateFacts:
    """Stage ComfyUI's PNG bytes untouched; accept publishes them in that same format."""
    try:
        try:
            with Image.open(temp_path) as opened:
                opened.load()
                produced = opened.convert("RGBA")
        except (OSError, UnidentifiedImageError) as exc:
            raise ComfyError(f"ComfyUI returned something that is not an image: {exc}") from exc

        original, _, _ = load_image_for_edit(source)
        facts = CandidateFacts(difference_percent=difference_percent(original, produced))
        _publish(temp_path, destination)
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)

    return facts


def _frame_count(probe: SourceProbe) -> int | None:
    """Frames from rate and length, which is what the probe measures; it counts neither directly."""
    if probe.frame_rate is None or probe.seconds is None:
        return None
    return round(probe.seconds * probe.frame_rate)


def _lengths_disagree(produced: float | None, original: float | None) -> bool:
    """Both known and apart by more than rounding. Unknown never flags: review would cry wolf."""
    if produced is None or original is None:
        return False
    tolerance = max(
        CANDIDATE_DURATION_TOLERANCE_SECONDS,
        original * CANDIDATE_DURATION_TOLERANCE_FRACTION,
    )
    return abs(produced - original) > tolerance


def _has_audio(media: Path, *, suffix: str | None = None) -> bool | None:
    try:
        stat = media.stat()
    except OSError:
        return None
    known = media_info(media, "video", stat.st_mtime_ns, stat.st_size).has_audio
    return known if known is not None else media_has_audio(media, suffix=suffix)


def _measure_video_candidate(
    source: Path, candidate: Path, *, suffix: str | None = None
) -> CandidateFacts:
    """Everything review needs, measured before publishing so a bad clip never becomes a candidate.

    ``suffix`` is the format ComfyUI produced: the file is still named ``.comfy-tmp`` here, which
    the suffix-gated readers would otherwise take for neither a video nor an image.
    """
    produced = probe_source(candidate)
    original = probe_source(source)

    before = media_first_frame(source)
    after = media_first_frame(candidate, suffix=suffix)
    difference = (
        difference_percent(before, after) if before is not None and after is not None else None
    )

    return CandidateFacts(
        difference_percent=difference,
        frame_rate=produced.frame_rate,
        source_frame_rate=original.frame_rate,
        frame_count=_frame_count(produced),
        source_frame_count=_frame_count(original),
        duration_seconds=produced.seconds,
        source_duration_seconds=original.seconds,
        length_mismatch=_lengths_disagree(produced.seconds, original.seconds),
        dropped_audio=_has_audio(source) is True and _has_audio(candidate, suffix=suffix) is False,
    )


def _stage_video_candidate(
    source: Path, temp_path: Path, destination: Path, *, suffix: str
) -> CandidateFacts:
    """Validate and measure before publishing, so a bad clip never replaces a staged candidate."""
    try:
        try:
            validate_candidate_media(temp_path, suffix=suffix)
            facts = _measure_video_candidate(source, temp_path, suffix=suffix)
        except ValueError as error:
            raise ComfyError(str(error)) from error

        _publish(temp_path, destination)
    finally:
        with suppress(OSError):
            temp_path.unlink(missing_ok=True)

    return facts


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
) -> Path:
    media_type = get_media_type(media_path)
    upload_name = f"{job_tag}_{index:05d}{media_path.suffix.lower()}"
    # Measured before the upload: a rate the graph never reads costs nothing to have missed.
    frame_rate = source_frame_rate(media_path)
    media_ref = upload_media(client, media_path, name=upload_name)

    prompt = build_comfy_prompt(
        workflow,
        media_ref=media_ref,
        filename_prefix=f"DataForge/{job_tag}/{media_path.stem}",
        seed=seed,
        # Empty box means run the graph as saved, not write "" into the prompt node.
        prompt_text=prompt_text or None,
        frame_rate=frame_rate,
    )

    with _gpu_slot(should_cancel):
        prompt_id = submit_prompt(client, prompt, client_id=client_id)
        ref = _await_output(
            client,
            prompt_id,
            output_node=workflow.output_node,
            timeout=get_comfy_media_timeout(media_type),
            should_cancel=should_cancel,
        )

        suffix = Path(ref["filename"]).suffix.lower()
        if suffix not in COMFY_CANDIDATE_SUFFIXES:
            staged = ", ".join(COMFY_CANDIDATE_SUFFIXES)
            raise ComfyError(
                f'The workflow returned a "{suffix}" file, which cannot be staged. '
                f"Set the output node's format to one of {staged}."
            )

        destination = candidate_write_path(media_path, suffix)
        # Before the transfer: a contested name is worth catching without downloading a clip first.
        try:
            validate_candidate_destination(media_path, destination)
        except ValueError as error:
            raise CandidateConflictError(str(error)) from error

        temp_path = temp_path_for(destination)
        download_view_to(client, ref, temp_path)

    if _is_motion(suffix):
        facts = _stage_video_candidate(media_path, temp_path, destination, suffix=suffix)
    else:
        facts = _stage_image_candidate(media_path, temp_path, destination)

    discard_stale_candidate(media_path, keeping=destination)
    write_candidate_sidecar(
        destination,
        # Splatted: every field measured is a field recorded, with no third place to keep in step.
        ComfyCandidateSidecar(
            source_name=media_path.name,
            preset=workflow.preset,
            prompt_id=prompt_id,
            seed=seed,
            prompt_text=prompt_text or None,
            created_at=datetime.now(tz=UTC).isoformat(),
            **asdict(facts),
        ),
    )

    return destination


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
                fields={"message": "A candidate is already staged for this file"},
            )

        try:
            destination = _process_one(
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
        except CandidateConflictError as exc:
            return FileOutcome(
                status="write_error", stats={"write_error": 1}, fields={"message": str(exc)}
            )
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

        return FileOutcome(
            status="success",
            stats={"success": 1},
            # The destination that was written, not the default: a video candidate is not a PNG.
            fields={"preview": str(destination)},
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
    parser = argparse.ArgumentParser(description="Run a folder's media through a ComfyUI preset")
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

    log_job_summary(logger, result, stat_keys=PROCESSED_STAT_KEYS)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
