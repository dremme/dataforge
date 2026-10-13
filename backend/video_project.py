"""Multi-track editor projects: drafts autosaved beside their sources, and the snapshot an export
leaves beside its video.

A project names its sources by filename in its own folder, so moving the whole folder keeps it
working. A source whose size or modification time no longer matches is reported, never replaced.
"""

from __future__ import annotations

import json
import logging
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path

from constants import (
    GALLERY_EXTENSIONS,
    VIDEO_PROJECT_AUDIO_EXTENSIONS,
    VIDEO_PROJECT_DRAFT_TAG,
    VIDEO_PROJECT_IMAGE_EXTENSIONS,
    VIDEO_PROJECT_SUFFIX,
    VIDEO_PROJECT_UNTITLED_NAME,
    VIDEO_PROJECT_VIDEO_EXTENSIONS,
)
from file_write import write_text_atomic
from media_dimensions import media_info
from schemas import (
    VideoProject,
    VideoProjectClip,
    VideoProjectDocument,
    VideoProjectSource,
    VideoProjectSourceInfo,
    VideoProjectSourceKind,
    VideoProjectSourceStatus,
    VideoProjectSummary,
    VideoProjectTrack,
)
from video_edit import probe_source
from video_frames import media_has_audio

logger = logging.getLogger(__name__)

DEFAULT_FRAME_RATE = 30.0
DEFAULT_CANVAS = (1920, 1080)
#: Numbered names tried before giving up; far beyond anything a person makes by hand.
MAX_NUMBERED_NAMES = 9999

UNREADABLE_PROJECT_MESSAGE = "This project file cannot be read"
CONFLICT_MESSAGE = (
    "This project was saved from another window since you opened it, so saving here would "
    "discard those edits"
)


class ProjectConflictError(Exception):
    """A save named an older revision than the one on disk."""


def now_iso() -> str:
    return datetime.now(tz=UTC).isoformat()


def new_id() -> str:
    return uuid.uuid4().hex[:12]


def source_kind_for(path: Path) -> VideoProjectSourceKind | None:
    suffix = path.suffix.lower()
    if suffix in VIDEO_PROJECT_VIDEO_EXTENSIONS:
        return "video"
    if suffix in VIDEO_PROJECT_IMAGE_EXTENSIONS:
        return "image"
    if suffix in VIDEO_PROJECT_AUDIO_EXTENSIONS:
        return "audio"
    return None


def snapshot_path_for(media: Path) -> Path:
    """Keeps the whole video name, like an edit backup, so `x.mp4` and `x.mov` stay apart."""
    return media.with_name(f"{media.name}{VIDEO_PROJECT_SUFFIX}")


def is_project_file(path: Path) -> bool:
    return path.name.lower().endswith(VIDEO_PROJECT_SUFFIX)


def project_stem(path: Path) -> str:
    return path.name[: -len(VIDEO_PROJECT_SUFFIX)]


def is_snapshot_file(path: Path) -> bool:
    """A snapshot's name is a media filename plus the suffix; a draft's never is."""
    return is_project_file(path) and Path(project_stem(path)).suffix.lower() in GALLERY_EXTENSIONS


def is_draft_file(path: Path) -> bool:
    return is_project_file(path) and not is_snapshot_file(path)


def numbered_name(stem: str, index: int, suffix: str) -> str:
    return f"{stem}{suffix}" if index == 1 else f"{stem}-{index}{suffix}"


def allocate_draft_path(folder: Path, stem: str) -> Path:
    base = f"{stem}{VIDEO_PROJECT_DRAFT_TAG}"
    for index in range(1, MAX_NUMBERED_NAMES + 1):
        candidate = folder / numbered_name(base, index, VIDEO_PROJECT_SUFFIX)
        if not candidate.exists():
            return candidate
    raise ValueError("No free name is left for another draft of this video")


def _stat_pair(path: Path) -> tuple[int, int]:
    """Size and modification time in microseconds, the precision a project records."""
    stat = path.stat()
    return stat.st_size, stat.st_mtime_ns // 1000


def probe_source_file(path: Path) -> VideoProjectSourceInfo:
    """Raises ``ValueError`` for an unsupported file and ``OSError`` for an unreadable one."""
    kind = source_kind_for(path)
    if kind is None:
        raise ValueError(f"{path.suffix or 'This'} files cannot be used in the video editor")
    stat = path.stat()
    size, modified_us, mtime_ns = stat.st_size, stat.st_mtime_ns // 1000, stat.st_mtime_ns

    if kind == "image":
        info = media_info(path, "image", mtime_ns, size)
        return VideoProjectSourceInfo(
            path=str(path),
            name=path.name,
            kind=kind,
            size=size,
            modified_us=modified_us,
            width=info.width,
            height=info.height,
        )

    if kind == "audio":
        info = media_info(path, "audio", mtime_ns, size)
        return VideoProjectSourceInfo(
            path=str(path),
            name=path.name,
            kind=kind,
            size=size,
            modified_us=modified_us,
            duration=info.duration,
            has_audio=True,
        )

    info = media_info(path, "video", mtime_ns, size)
    probe = probe_source(path)
    width, height = (info.width, info.height)
    if (width is None or height is None) and probe.size is not None:
        width, height = probe.size
    has_audio = info.has_audio if info.has_audio is not None else media_has_audio(path)
    return VideoProjectSourceInfo(
        path=str(path),
        name=path.name,
        kind=kind,
        size=size,
        modified_us=modified_us,
        duration=info.duration or probe.seconds,
        width=width,
        height=height,
        frame_rate=probe.frame_rate,
        has_audio=bool(has_audio),
    )


def source_from_info(
    info: VideoProjectSourceInfo, source_id: str | None = None
) -> VideoProjectSource:
    return VideoProjectSource(
        id=source_id or new_id(),
        name=info.name,
        kind=info.kind,
        size=info.size,
        modified_us=info.modified_us,
        duration=info.duration,
        width=info.width,
        height=info.height,
        frame_rate=info.frame_rate,
        has_audio=info.has_audio,
    )


def source_state(folder: Path, source: VideoProjectSource) -> VideoProjectSourceStatus:
    path = folder / source.name
    try:
        size, modified_us = _stat_pair(path) if path.is_file() else (None, None)
    except OSError:
        size, modified_us = None, None
    if size is None:
        state = "missing"
    elif size != source.size or modified_us != source.modified_us:
        state = "changed"
    else:
        state = "ok"
    return VideoProjectSourceStatus(source_id=source.id, state=state, path=str(path))


def source_states(folder: Path, project: VideoProject) -> list[VideoProjectSourceStatus]:
    return [source_state(folder, source) for source in project.sources]


def used_source_ids(project: VideoProject) -> set[str]:
    return {clip.source_id for clip in project.clips if clip.source_id is not None}


def project_duration(project: VideoProject) -> float:
    return max((clip.end for clip in project.clips), default=0.0)


def _even(value: int) -> int:
    return max(2, value // 2 * 2)


def default_tracks() -> list[VideoProjectTrack]:
    """Two of each kind, top to bottom as displayed: V2 above V1, then A1 and A2."""
    return [
        VideoProjectTrack(id=new_id(), kind="video", name="V2"),
        VideoProjectTrack(id=new_id(), kind="video", name="V1"),
        VideoProjectTrack(id=new_id(), kind="audio", name="A1"),
        VideoProjectTrack(id=new_id(), kind="audio", name="A2"),
    ]


def new_project_for_video(media: Path) -> VideoProject:
    """The selected file as it is now, at 00:00 on V1, with its sound linked on A1."""
    info = probe_source_file(media)
    if info.kind != "video":
        raise ValueError("Only a video can start a project")
    if info.duration is None:
        raise ValueError("The video's length could not be read, so it cannot be placed")

    source = source_from_info(info)
    tracks = default_tracks()
    v1 = tracks[1]
    a1 = tracks[2]
    link_id = new_id() if info.has_audio else None

    clips = [
        VideoProjectClip(
            id=new_id(),
            track_id=v1.id,
            kind="video",
            source_id=source.id,
            start=0.0,
            duration=info.duration,
            link_id=link_id,
        )
    ]
    if info.has_audio:
        clips.append(
            VideoProjectClip(
                id=new_id(),
                track_id=a1.id,
                kind="audio",
                source_id=source.id,
                start=0.0,
                duration=info.duration,
                link_id=link_id,
            )
        )

    width, height = (info.width, info.height) if info.width and info.height else DEFAULT_CANVAS
    stamp = now_iso()
    return VideoProject(
        id=new_id(),
        name=f"{media.stem} edit",
        created_at=stamp,
        updated_at=stamp,
        width=_even(width),
        height=_even(height),
        frame_rate=round(info.frame_rate or DEFAULT_FRAME_RATE, 3),
        initial_source_id=source.id,
        sources=[source],
        tracks=tracks,
        clips=clips,
    )


def new_empty_project() -> VideoProject:
    """No media yet: the default canvas and rate until the first video sets its own."""
    stamp = now_iso()
    return VideoProject(
        id=new_id(),
        name=VIDEO_PROJECT_UNTITLED_NAME,
        created_at=stamp,
        updated_at=stamp,
        width=DEFAULT_CANVAS[0],
        height=DEFAULT_CANVAS[1],
        frame_rate=DEFAULT_FRAME_RATE,
        tracks=default_tracks(),
    )


def read_project_file(path: Path) -> VideoProject:
    """Raises ``ValueError`` for a file that is not a readable project, ``OSError`` if unreadable."""
    raw = path.read_text(encoding="utf-8")
    try:
        return VideoProject.model_validate(json.loads(raw))
    except ValueError as exc:
        logger.warning("Unreadable video project %s", path.name, exc_info=True)
        raise ValueError(UNREADABLE_PROJECT_MESSAGE) from exc


def serialize_project(project: VideoProject) -> str:
    return json.dumps(project.model_dump(mode="json"), indent=2)


def document_for(path: Path | None, folder: Path, project: VideoProject) -> VideoProjectDocument:
    return VideoProjectDocument(
        path=str(path) if path is not None else None,
        folder=str(folder),
        project=project,
        sources=source_states(folder, project),
    )


def start_document(media: Path) -> VideoProjectDocument:
    """An exported video reopens its recorded edit as a fresh, unsaved draft; any other video
    starts a new project. Nothing is written until the first edit is saved."""
    snapshot = snapshot_path_for(media)
    if snapshot.is_file():
        recorded = read_project_file(snapshot)
        stamp = now_iso()
        project = recorded.model_copy(
            update={"id": new_id(), "revision": 0, "created_at": stamp, "updated_at": stamp}
        )
        document = document_for(None, media.parent, project)
        document.opened_from_export = str(media)
        return document
    return document_for(None, media.parent, new_project_for_video(media))


_save_lock = threading.Lock()


def _draft_stem(project: VideoProject) -> str:
    initial = next((s for s in project.sources if s.id == project.initial_source_id), None)
    if initial is not None:
        return Path(initial.name).stem
    cleaned = "".join(ch if ch.isalnum() or ch in "-_ " else "-" for ch in project.name).strip()
    return cleaned or "project"


def checked_draft_path(folder: Path, path: Path) -> Path:
    """Saving and deleting reach drafts in the project's own folder, never a snapshot."""
    if path.parent != folder:
        raise ValueError("A draft is saved in the folder of its sources")
    if not is_draft_file(path):
        raise ValueError("Only an editor draft can be changed; an export's record stays as made")
    return path


def save_project(
    folder: Path, path: Path | None, base_revision: int | None, project: VideoProject
) -> tuple[Path, VideoProject]:
    """Write the next revision. A draft whose revision on disk is not ``base_revision`` was saved
    from somewhere else, and is refused rather than overwritten."""
    with _save_lock:
        if path is None:
            target = allocate_draft_path(folder, _draft_stem(project))
            revision = 1
        else:
            target = checked_draft_path(folder, path)
            if target.exists():
                current = read_project_file(target)
                if current.id != project.id or current.revision != base_revision:
                    raise ProjectConflictError(CONFLICT_MESSAGE)
                revision = current.revision + 1
            else:
                revision = (base_revision or 0) + 1

        saved = project.model_copy(update={"revision": revision, "updated_at": now_iso()})
        write_text_atomic(target, serialize_project(saved))
    return target, saved


def list_drafts(folder: Path) -> list[VideoProjectSummary]:
    summaries: list[VideoProjectSummary] = []
    try:
        entries = [entry for entry in folder.iterdir() if is_draft_file(entry)]
    except OSError:
        return []
    for entry in entries:
        try:
            project = read_project_file(entry)
        except (OSError, ValueError):
            continue
        initial = next((s for s in project.sources if s.id == project.initial_source_id), None)
        summaries.append(
            VideoProjectSummary(
                path=str(entry),
                name=project.name,
                updated_at=project.updated_at,
                duration=project_duration(project),
                clip_count=len(project.clips),
                initial_source_name=initial.name if initial else None,
                initial_source_path=(
                    str(folder / initial.name)
                    if initial and (folder / initial.name).is_file()
                    else None
                ),
            )
        )
    summaries.sort(key=lambda summary: summary.updated_at, reverse=True)
    return summaries


def delete_draft(folder: Path, path: Path) -> None:
    """Only the draft's own file; its sources and earlier exports are not touched."""
    target = checked_draft_path(folder, path)
    with _save_lock:
        target.unlink()
