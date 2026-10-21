"""Exports run on their own thread, outside the per-folder job queue, so leaving the editor or
starting a caption job does not stop them. Every change is broadcast to all tabs.

An export never replaces anything. Its name is checked against the folder's files and every
sidecar a media file of that name would claim, and a numbered name is taken on any collision.
The snapshot and caption are written before the video appears, and removed again if it cannot.
An export of a span writes neither: it is a check of a passage, and its snapshot would not be the
edit it shows.
"""

from __future__ import annotations

import logging
import math
import os
import re
import tempfile
import threading
import uuid
from contextlib import suppress
from dataclasses import dataclass, field
from pathlib import Path
from time import monotonic

import events
import notifications
from audio_effects import audio_proxy, needs_proxy
from audio_level import build_file_measure, parse_loudness
from captions import caption_path_for
from constants import (
    GALLERY_EXTENSIONS,
    VIDEO_PROJECT_EXPORT_EXTENSION,
    VIDEO_PROJECT_EXPORT_TAG,
    VIDEO_PROJECT_EXPORT_TEMP_SUFFIX,
)
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import FfmpegCancelled, run_ffmpeg
from file_write import copy_file_atomic, write_text_atomic
from media_group import media_group_paths
from schemas import (
    NotificationVariant,
    VideoProject,
    VideoProjectClip,
    VideoProjectExportEvent,
    VideoProjectExportSpan,
    VideoProjectExportState,
    VideoProjectExportStatus,
)
from video_edit import probe_stream_color
from video_project import (
    MAX_NUMBERED_NAMES,
    now_iso,
    numbered_name,
    serialize_project,
    snapshot_path_for,
    source_states,
    used_source_ids,
)
from video_project_render import SoundSource, build_mix_measure, build_render

logger = logging.getLogger(__name__)


def clip_sound_source(executable: str) -> SoundSource:
    """A clip with noise reduction reads the proxy its preview played, so both hear one render."""

    def sound(path: Path, clip: VideoProjectClip) -> Path:
        strength = clip.audio_effects.noise_reduction
        if not needs_proxy(strength):
            return path
        return audio_proxy(executable, path, noise_reduction=strength)

    return sound


FFMPEG_MISSING_MESSAGE = "ffmpeg is required to export a video"
EXPORT_TIMEOUT_SECONDS = 6 * 3600
EVENT_MIN_INTERVAL_SECONDS = 0.25
#: Finished exports kept for a tab that comes back to ask how they went.
MAX_FINISHED_EXPORTS = 20
#: Added to the default name of an export of a span, so it is not taken for the whole edit.
RANGE_EXPORT_TAG = "-range"

_UNSAFE_NAME = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


@dataclass
class _Export:
    state: VideoProjectExportState
    cancel: threading.Event = field(default_factory=threading.Event)
    published_at: float = 0.0


def sanitize_output_stem(requested: str, fallback: str) -> str:
    """The stem of a requested filename; any extension given is dropped, the export is MP4."""
    name = _UNSAFE_NAME.sub("-", requested.strip()).strip(" .")
    stem = Path(name).stem if Path(name).suffix.lower() in GALLERY_EXTENSIONS else name
    return stem.strip(" .") or fallback


def default_output_stem(project: VideoProject) -> str:
    initial = next((s for s in project.sources if s.id == project.initial_source_id), None)
    base = (
        Path(initial.name).stem if initial is not None else sanitize_output_stem(project.name, "")
    )
    return f"{base or 'video'}{VIDEO_PROJECT_EXPORT_TAG}"


def name_is_taken(folder: Path, name: str, reserved: set[str]) -> bool:
    """Taken by a file, by any sidecar such a file would own, or by another file of its stem,
    which would share its caption."""
    if os.path.normcase(name) in reserved:
        return True
    target = folder / name
    if target.exists() or snapshot_path_for(target).exists():
        return True
    if len(media_group_paths(target)) > 1:
        return True
    stem = os.path.normcase(target.stem)
    try:
        entries = list(folder.iterdir())
    except OSError:
        return True
    return any(
        os.path.normcase(entry.stem) == stem and entry.suffix.lower() in GALLERY_EXTENSIONS
        for entry in entries
    )


def allocate_output_name(folder: Path, stem: str, reserved: set[str]) -> str:
    for index in range(1, MAX_NUMBERED_NAMES + 1):
        name = numbered_name(stem, index, VIDEO_PROJECT_EXPORT_EXTENSION)
        if not name_is_taken(folder, name, reserved):
            return name
    raise ValueError("No free name is left for another export of this project")


def check_sources(folder: Path, project: VideoProject) -> None:
    """Refuses a project whose timeline uses a missing or changed file; an export that left
    them out would look complete."""
    used = used_source_ids(project)
    names = {source.id: source.name for source in project.sources}
    problems = [
        f"{names[status.source_id]} is {status.state}"
        for status in source_states(folder, project)
        if status.source_id in used and status.state != "ok"
    ]
    if problems:
        raise ValueError(
            "Relink or accept these sources before exporting: " + "; ".join(sorted(problems))
        )


def sweep_export_leftovers(folder: Path, running_outputs: set[str]) -> None:
    """A temp file whose export is no longer running was left by a crash or a hard kill."""
    with suppress(OSError):
        for leftover in folder.glob(f"*{VIDEO_PROJECT_EXPORT_TEMP_SUFFIX}"):
            owner = leftover.with_name(leftover.name.removesuffix(VIDEO_PROJECT_EXPORT_TEMP_SUFFIX))
            if os.path.normcase(str(owner)) not in running_outputs:
                with suppress(OSError):
                    leftover.unlink(missing_ok=True)


def publish_new_file(temp_path: Path, final_path: Path) -> None:
    """Never replaces: a hard link fails on an existing name, and so does a Windows rename."""
    if os.name == "nt":
        os.rename(temp_path, final_path)
        return
    os.link(temp_path, final_path)
    temp_path.unlink()


class ExportManager:
    def __init__(self) -> None:
        self._exports: dict[str, _Export] = {}
        self._lock = threading.Lock()

    def start(
        self,
        folder: Path,
        project: VideoProject,
        project_path: Path | None,
        span: VideoProjectExportSpan | None = None,
    ) -> VideoProjectExportState:
        executable = ffmpeg_path()
        if not executable:
            raise RuntimeError(FFMPEG_MISSING_MESSAGE)
        if not project.clips:
            raise ValueError("The timeline is empty, so there is nothing to export")
        check_sources(folder, project)

        fallback = default_output_stem(project) + (RANGE_EXPORT_TAG if span else "")
        stem = sanitize_output_stem(project.export.filename, fallback)
        with self._lock:
            sweep_export_leftovers(folder, self._running_outputs())
            reserved = {
                os.path.normcase(record.state.output_name)
                for record in self._exports.values()
                if record.state.status == "running" and record.state.folder == str(folder)
            }
            name = allocate_output_name(folder, stem, reserved)
            state = VideoProjectExportState(
                id=uuid.uuid4().hex,
                folder=str(folder),
                status="running",
                output_path=str(folder / name),
                output_name=name,
                project_name=project.name,
                project_path=str(project_path) if project_path else None,
                started_at=now_iso(),
            )
            record = _Export(state=state)
            self._exports[state.id] = record
            self._prune_finished()

        frozen = project.model_copy(
            deep=True, update={"export": project.export.model_copy(update={"filename": name})}
        )
        self._publish(record, force=True)
        threading.Thread(
            target=self._run,
            args=(record, folder, frozen, executable, span),
            name=f"video-export-{state.id[:8]}",
            daemon=True,
        ).start()
        return state.model_copy()

    def _running_outputs(self) -> set[str]:
        return {
            os.path.normcase(record.state.output_path)
            for record in self._exports.values()
            if record.state.status == "running"
        }

    def list_exports(self, folder: Path | None = None) -> list[VideoProjectExportState]:
        with self._lock:
            states = [record.state.model_copy() for record in self._exports.values()]
        if folder is not None:
            states = [state for state in states if state.folder == str(folder)]
        return sorted(states, key=lambda state: state.started_at, reverse=True)

    def cancel(self, export_id: str) -> VideoProjectExportState | None:
        with self._lock:
            record = self._exports.get(export_id)
        if record is None:
            return None
        record.cancel.set()
        return record.state.model_copy()

    def dismiss(self, export_id: str) -> bool:
        """Forget a finished export; a running one has to be cancelled first."""
        with self._lock:
            record = self._exports.get(export_id)
            if record is None or record.state.status == "running":
                return False
            del self._exports[export_id]
            return True

    def _prune_finished(self) -> None:
        finished = [r for r in self._exports.values() if r.state.status != "running"]
        finished.sort(key=lambda r: r.state.started_at)
        for record in finished[: max(0, len(finished) - MAX_FINISHED_EXPORTS)]:
            self._exports.pop(record.state.id, None)

    def _publish(self, record: _Export, *, force: bool = False) -> None:
        now = monotonic()
        if not force and now - record.published_at < EVENT_MIN_INTERVAL_SECONDS:
            return
        record.published_at = now
        events.publish(VideoProjectExportEvent(export=record.state.model_copy()).model_dump())

    def _finish(
        self, record: _Export, status: VideoProjectExportStatus, error: str | None = None
    ) -> None:
        with self._lock:
            record.state.status = status
            record.state.error = error
            record.state.finished_at = now_iso()
            if status == "completed":
                record.state.progress = 1.0
        self._publish(record, force=True)

        # A cancel was the user's own doing, so it is not announced.
        name = record.state.output_name
        outcome: tuple[str, NotificationVariant] | None = None
        if status == "completed":
            outcome = (f"Exported {name}", "success")
        elif status == "failed":
            outcome = (f"Export of {name} failed: {error}", "danger")
        if outcome is not None:
            with suppress(Exception):
                notifications.record_notification(*outcome, source="job")

    def _measure(self, record: _Export, executable: str, media: Path) -> None:
        """What the delivered file measures, not what the settings meant it to; a file that
        cannot be measured is still a finished export."""
        try:
            loudness = parse_loudness(
                run_ffmpeg(
                    build_file_measure(executable, media),
                    should_cancel=record.cancel.is_set,
                    timeout=EXPORT_TIMEOUT_SECONDS,
                )
            )
        except FfmpegCancelled:
            raise
        except Exception:
            logger.warning("Could not measure the loudness of %s", media.name, exc_info=True)
            return
        if loudness is None:
            return
        with self._lock:
            record.state.loudness_lufs = _finite(loudness.integrated_lufs)
            record.state.true_peak_db = _finite(loudness.true_peak_db)

    def _run(
        self,
        record: _Export,
        folder: Path,
        project: VideoProject,
        executable: str,
        span: VideoProjectExportSpan | None,
    ) -> None:
        output = Path(record.state.output_path)
        temp_path = output.with_name(f"{output.name}{VIDEO_PROJECT_EXPORT_TEMP_SUFFIX}")

        def on_progress(seconds: float) -> None:
            duration = max(plan_duration[0], 1e-6)
            record.state.progress = min(0.99, max(0.0, seconds / duration))
            self._publish(record)

        plan_duration = [0.0]
        sound_source = clip_sound_source(executable)
        try:
            with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as workspace:
                measured = None
                if project.export.audio_level == "normalize":
                    log = run_ffmpeg(
                        build_mix_measure(
                            project,
                            folder,
                            executable=executable,
                            workspace=Path(workspace),
                            span=span,
                            sound_source=sound_source,
                        ),
                        should_cancel=record.cancel.is_set,
                        timeout=EXPORT_TIMEOUT_SECONDS,
                        cwd=Path(workspace),
                    )
                    loudness = parse_loudness(log)
                    if loudness is None:
                        raise RuntimeError("The mix's loudness could not be measured")
                    measured = loudness.integrated_lufs
                plan = build_render(
                    project,
                    folder,
                    temp_path,
                    settings=project.export,
                    executable=executable,
                    workspace=Path(workspace),
                    probe_color=lambda path: probe_stream_color(executable, path),
                    measured_lufs=measured,
                    span=span,
                    sound_source=sound_source,
                )
                plan_duration[0] = plan.duration
                run_ffmpeg(
                    plan.command,
                    should_cancel=record.cancel.is_set,
                    on_progress=on_progress,
                    timeout=EXPORT_TIMEOUT_SECONDS,
                    cwd=Path(workspace),
                )
            if record.cancel.is_set():
                raise FfmpegCancelled
            self._measure(record, executable, temp_path)
            if span is None:
                publish_export(folder, project, temp_path, output)
            else:
                publish_new_file(temp_path, output)
        except FfmpegCancelled:
            self._finish(record, "cancelled")
        except Exception as exc:
            logger.warning("Export of %s failed", output.name, exc_info=True)
            self._finish(record, "failed", str(exc) or exc.__class__.__name__)
        else:
            self._finish(record, "completed")
        finally:
            with suppress(OSError):
                temp_path.unlink(missing_ok=True)


def _finite(value: float) -> float | None:
    """Silence measures -inf, which JSON cannot carry; it reads as no measurement."""
    return value if math.isfinite(value) else None


def publish_export(folder: Path, project: VideoProject, temp_path: Path, output: Path) -> None:
    """Snapshot, then the caption if asked for, then the video. A failure takes back what was
    written, so no video appears without its snapshot."""
    snapshot = snapshot_path_for(output)
    caption = caption_path_for(output)
    written: list[Path] = []
    try:
        if snapshot.exists():
            raise FileExistsError(f"{snapshot.name} already exists")
        write_text_atomic(snapshot, serialize_project(project))
        written.append(snapshot)

        if project.export.copy_caption:
            initial = next((s for s in project.sources if s.id == project.initial_source_id), None)
            source_caption = caption_path_for(folder / initial.name) if initial else None
            if source_caption is not None and source_caption.is_file():
                if not copy_file_atomic(source_caption, caption, overwrite=False):
                    raise FileExistsError(f"{caption.name} already exists")
                written.append(caption)

        publish_new_file(temp_path, output)
    except Exception:
        for path in written:
            with suppress(OSError):
                path.unlink(missing_ok=True)
        raise


export_manager = ExportManager()
