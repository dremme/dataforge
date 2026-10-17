import io
import json
import logging
import tempfile
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response
from pydantic import ValidationError

from color_auto import image_analysis_pixels, suggest_adjust, video_analysis_pixels
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import FfmpegCancelled, run_ffmpeg
from filesystem import normalize_user_path
from image_io import ImageReadError
from media_file_response import MediaFileResponse
from routes._helpers import resolve_folder, resolve_media_file
from schemas import (
    MAX_PROJECT_DIMENSION,
    MIN_PROJECT_DIMENSION,
    AutoAdjustResponse,
    VideoProjectAutoAdjustRequest,
    VideoProjectCompatibleCopyRequest,
    VideoProjectDocument,
    VideoProjectExportRequest,
    VideoProjectExportsResponse,
    VideoProjectExportState,
    VideoProjectFontFamily,
    VideoProjectFontsResponse,
    VideoProjectFrameRequest,
    VideoProjectGrade,
    VideoProjectGradeRequest,
    VideoProjectGradesResponse,
    VideoProjectListResponse,
    VideoProjectSaveRequest,
    VideoProjectSaveResponse,
    VideoProjectSourceInfo,
    VideoProjectTitle,
    VideoProjectVersionDocument,
    VideoProjectVersionRequest,
    VideoProjectVersionsResponse,
    VideoProjectVersionSummary,
)
from system_fonts import installed_families
from thumbnails import ThumbnailError
from video_edit import probe_stream_color
from video_project import (
    ProjectConflictError,
    delete_draft,
    document_for,
    is_draft_file,
    is_project_file,
    list_drafts,
    new_empty_project,
    probe_source_file,
    read_project_file,
    save_project,
    source_kind_for,
    source_states,
    start_document,
)
from video_project_compat import make_compatible_copy
from video_project_export import FFMPEG_MISSING_MESSAGE, export_manager
from video_project_grades import delete_grade, list_grades, save_grade
from video_project_media import filmstrip, waveform
from video_project_render import build_frame, render_title_image
from video_project_versions import (
    delete_project_versions,
    delete_version,
    list_versions,
    read_version,
    record_checkpoint,
    save_named_version,
)

logger = logging.getLogger(__name__)

router = APIRouter()

#: One frame renders only the clips around it, so this is generous.
FRAME_TIMEOUT_SECONDS = 120

_TIMELINE_CACHE = "public, max-age=31536000, immutable"


def _editor_source(path: str) -> Path:
    media = resolve_media_file(path)
    if source_kind_for(media) is None:
        raise HTTPException(
            status_code=400, detail=f"{media.suffix} files cannot be used in the video editor"
        )
    return media


def _project_file(path: str) -> Path:
    project = normalize_user_path(path)
    if not is_project_file(project):
        raise HTTPException(status_code=400, detail="Not a video project file")
    if not project.is_file():
        raise HTTPException(status_code=404, detail="Project not found")
    return project


@router.get("/video-projects/start", response_model=VideoProjectDocument)
def start_video_project(
    path: str = Query(..., description="Absolute path to the video the editor opens on"),
) -> VideoProjectDocument:
    """A new, unsaved project on the video, or the edit an exported video was made from."""
    media = _editor_source(path)
    if source_kind_for(media) != "video":
        raise HTTPException(status_code=400, detail="Only a video can start a project")
    try:
        return start_document(media)
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/video-projects/new", response_model=VideoProjectDocument)
def new_video_project(
    folder: str = Query(..., description="Absolute path to the folder the project works in"),
) -> VideoProjectDocument:
    """An empty, unsaved project; nothing is written until the first edit is saved."""
    return document_for(None, resolve_folder(folder), new_empty_project())


@router.get("/video-projects", response_model=VideoProjectListResponse)
def list_video_projects(
    folder: str = Query(..., description="Absolute path to the folder holding the drafts"),
) -> VideoProjectListResponse:
    return VideoProjectListResponse(projects=list_drafts(resolve_folder(folder)))


@router.get("/video-projects/project", response_model=VideoProjectDocument)
def read_video_project(
    path: str = Query(..., description="Absolute path to a draft"),
) -> VideoProjectDocument:
    project_path = _project_file(path)
    if not is_draft_file(project_path):
        raise HTTPException(status_code=400, detail="Open an export's record from its video")
    try:
        project = read_project_file(project_path)
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return document_for(project_path, project_path.parent, project)


@router.put("/video-projects/project", response_model=VideoProjectSaveResponse)
def save_video_project(body: VideoProjectSaveRequest) -> VideoProjectSaveResponse:
    folder = resolve_folder(body.folder)
    path = normalize_user_path(body.path) if body.path else None
    try:
        saved_path, saved = save_project(folder, path, body.base_revision, body.project)
    except ProjectConflictError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"The project could not be saved: {exc}"
        ) from exc
    try:
        record_checkpoint(saved)
    except Exception:
        # The draft is saved; a missing checkpoint only shortens the version history.
        logger.warning("Could not record a checkpoint of %s", saved_path.name, exc_info=True)
    return VideoProjectSaveResponse(
        path=str(saved_path), revision=saved.revision, updated_at=saved.updated_at
    )


@router.delete("/video-projects/project", status_code=204)
def delete_video_project(
    path: str = Query(..., description="Absolute path to a draft"),
) -> Response:
    project_path = _project_file(path)
    try:
        project_id = read_project_file(project_path).id
    except (ValueError, OSError):
        project_id = None
    try:
        delete_draft(project_path.parent, project_path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    if project_id is not None:
        delete_project_versions(project_id)
    return Response(status_code=204)


@router.get("/video-projects/versions", response_model=VideoProjectVersionsResponse)
def list_video_project_versions(
    project_id: str = Query(..., min_length=1, description="The project's id"),
) -> VideoProjectVersionsResponse:
    """Named versions and automatic checkpoints, newest first."""
    return VideoProjectVersionsResponse(versions=list_versions(project_id))


@router.post("/video-projects/versions", response_model=VideoProjectVersionSummary)
def save_video_project_version(body: VideoProjectVersionRequest) -> VideoProjectVersionSummary:
    return save_named_version(body.project, body.label)


@router.get("/video-projects/versions/{version_id}", response_model=VideoProjectVersionDocument)
def read_video_project_version(
    version_id: str,
    folder: str = Query(..., description="The folder the version would be restored into"),
) -> VideoProjectVersionDocument:
    try:
        project = read_version(version_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if project is None:
        raise HTTPException(status_code=404, detail="Version not found")
    return VideoProjectVersionDocument(
        project=project, sources=source_states(resolve_folder(folder), project)
    )


@router.delete("/video-projects/versions/{version_id}", status_code=204)
def delete_video_project_version(version_id: str) -> Response:
    if not delete_version(version_id):
        raise HTTPException(status_code=404, detail="Version not found")
    return Response(status_code=204)


@router.get("/video-projects/source", response_model=VideoProjectSourceInfo)
def probe_video_project_source(
    path: str = Query(..., description="Absolute path to a file to add or relink"),
) -> VideoProjectSourceInfo:
    media = _editor_source(path)
    try:
        return probe_source_file(media)
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/video-projects/compatible-copy", response_model=VideoProjectSourceInfo)
def make_video_project_compatible_copy(
    body: VideoProjectCompatibleCopyRequest,
) -> VideoProjectSourceInfo:
    """An H.264 copy of a video the preview cannot decode, beside it; the original stays."""
    media = _editor_source(body.path)
    if source_kind_for(media) != "video":
        raise HTTPException(status_code=400, detail="Only a video can be copied this way")
    executable = ffmpeg_path()
    if not executable:
        raise HTTPException(status_code=503, detail="ffmpeg is required to convert a video")
    try:
        return probe_source_file(make_compatible_copy(executable, media))
    except (ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(
            status_code=422, detail=f"{media.name} could not be converted: {exc}"
        ) from exc


@router.post("/video-projects/frame")
def render_video_project_frame(body: VideoProjectFrameRequest) -> Response:
    """The frame at ``time`` drawn by the export's own renderer, at the project's full size,
    so what the export will show can be checked against the browser's preview."""
    folder = resolve_folder(body.folder)
    executable = ffmpeg_path()
    if not executable:
        raise HTTPException(status_code=503, detail="ffmpeg is required to render a frame")
    try:
        with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as workspace:
            output = Path(workspace) / "frame.png"
            command = build_frame(
                body.project,
                folder,
                output,
                body.time,
                executable=executable,
                workspace=Path(workspace),
                probe_color=lambda path: probe_stream_color(executable, path),
            )
            run_ffmpeg(command, timeout=FRAME_TIMEOUT_SECONDS, cwd=Path(workspace))
            picture = output.read_bytes()
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except (RuntimeError, OSError) as exc:
        raise HTTPException(
            status_code=422, detail=f"The frame could not be rendered: {exc}"
        ) from exc
    return Response(content=picture, media_type="image/png", headers={"Cache-Control": "no-store"})


@router.get("/video-projects/grades", response_model=VideoProjectGradesResponse)
def list_video_project_grades() -> VideoProjectGradesResponse:
    """Saved grades, shared by every project."""
    return VideoProjectGradesResponse(grades=list_grades())


@router.post("/video-projects/grades", response_model=VideoProjectGrade)
def save_video_project_grade(body: VideoProjectGradeRequest) -> VideoProjectGrade:
    return save_grade(body.name, body.adjust)


@router.delete("/video-projects/grades/{grade_id}", status_code=204)
def delete_video_project_grade(grade_id: str) -> Response:
    if not delete_grade(grade_id):
        raise HTTPException(status_code=404, detail="Grade not found")
    return Response(status_code=204)


@router.get("/video-projects/fonts", response_model=VideoProjectFontsResponse)
def list_video_project_fonts() -> VideoProjectFontsResponse:
    """The families a title can be set in; read once and kept until a font is installed."""
    return VideoProjectFontsResponse(
        families=[
            VideoProjectFontFamily(family=family, styles=styles)
            for family, styles in installed_families()
        ]
    )


@router.post("/video-projects/auto-adjust", response_model=AutoAdjustResponse)
def auto_adjust_video_project_clip(body: VideoProjectAutoAdjustRequest) -> AutoAdjustResponse:
    """The wand's suggestion for one clip: the file as it is now, over the clip's take and crop.
    Unlike the gallery's wand it reads the current file, not an edit backup, since that is
    what the project composites."""
    media = _editor_source(body.path)
    kind = source_kind_for(media)
    if kind == "audio":
        raise HTTPException(status_code=400, detail="Sound has no colors to adjust")
    try:
        if kind == "image":
            pixels, weights = image_analysis_pixels(media, [], body.crop)
        else:
            pixels, weights = video_analysis_pixels(
                media, [], body.crop, start=body.start, end=body.end, duration=None
            )
        return AutoAdjustResponse(suggestion=suggest_adjust(pixels, weights))
    except (ValueError, ImageReadError, OSError) as exc:
        raise HTTPException(
            status_code=400, detail=f"Could not analyse {media.name}: {exc}"
        ) from exc


@router.get("/video-projects/title")
def render_video_project_title(
    width: int = Query(..., ge=MIN_PROJECT_DIMENSION, le=MAX_PROJECT_DIMENSION),
    height: int = Query(..., ge=MIN_PROJECT_DIMENSION, le=MAX_PROJECT_DIMENSION),
    spec: str = Query(..., description="The title as JSON"),
) -> Response:
    """The exact layer the export overlays, so the preview cannot draw the text differently."""
    try:
        title = VideoProjectTitle.model_validate(json.loads(spec))
    except (ValueError, ValidationError) as exc:
        raise HTTPException(status_code=400, detail="Not a valid title") from exc
    buffer = io.BytesIO()
    render_title_image(title, width, height).save(buffer, format="PNG", optimize=False)
    return Response(
        content=buffer.getvalue(),
        media_type="image/png",
        headers={"Cache-Control": _TIMELINE_CACHE},
    )


def _timeline_picture(build) -> Response:
    executable = ffmpeg_path()
    if not executable:
        raise HTTPException(status_code=503, detail="ffmpeg is required for timeline pictures")
    try:
        picture = build(executable)
    except (ThumbnailError, RuntimeError, OSError, FfmpegCancelled) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return MediaFileResponse(
        picture, media_type="image/webp", headers={"Cache-Control": _TIMELINE_CACHE}
    )


@router.get("/video-projects/filmstrip")
def video_project_filmstrip(
    path: str = Query(..., description="Absolute path to a video"),
    start: float = Query(0.0, ge=0.0),
    end: float = Query(..., gt=0.0),
    count: int = Query(6, ge=1),
    height: int = Query(48, ge=1),
    v: str | None = Query(None, description="Client cache-busting token"),
) -> Response:
    media = _editor_source(path)
    if source_kind_for(media) != "video":
        raise HTTPException(status_code=400, detail="Only a video has a filmstrip")
    return _timeline_picture(
        lambda executable: filmstrip(executable, media, start, max(end, start), count, height)
    )


@router.get("/video-projects/waveform")
def video_project_waveform(
    path: str = Query(..., description="Absolute path to a video or audio file"),
    start: float = Query(0.0, ge=0.0, description="Source seconds the stretch starts at"),
    duration: float = Query(..., gt=0.0, description="Seconds the stretch lasts"),
    width: int = Query(512, ge=1),
    height: int = Query(96, ge=1),
    v: str | None = Query(None, description="Client cache-busting token"),
) -> Response:
    """The sound of one stretch of a file, one lane per channel, at the pixel size drawn."""
    media = _editor_source(path)
    if source_kind_for(media) == "image":
        raise HTTPException(status_code=400, detail="An image has no sound")
    return _timeline_picture(
        lambda executable: waveform(executable, media, start, duration, width, height)
    )


@router.post("/video-projects/exports", response_model=VideoProjectExportState)
def start_video_project_export(body: VideoProjectExportRequest) -> VideoProjectExportState:
    folder = resolve_folder(body.folder)
    project_path = normalize_user_path(body.project_path) if body.project_path else None
    try:
        return export_manager.start(folder, body.project, project_path, body.span)
    except RuntimeError as exc:
        status = 503 if str(exc) == FFMPEG_MISSING_MESSAGE else 500
        raise HTTPException(status_code=status, detail=str(exc)) from exc
    except (ValueError, OSError) as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/video-projects/exports", response_model=VideoProjectExportsResponse)
def list_video_project_exports(
    folder: str | None = Query(None, description="Only exports into this folder"),
) -> VideoProjectExportsResponse:
    target = normalize_user_path(folder) if folder else None
    return VideoProjectExportsResponse(exports=export_manager.list_exports(target))


@router.post("/video-projects/exports/{export_id}/cancel", response_model=VideoProjectExportState)
def cancel_video_project_export(export_id: str) -> VideoProjectExportState:
    state = export_manager.cancel(export_id)
    if state is None:
        raise HTTPException(status_code=404, detail="Export not found")
    return state


@router.delete("/video-projects/exports/{export_id}", status_code=204)
def dismiss_video_project_export(export_id: str) -> Response:
    """Forget a finished export. Its video and snapshot stay where they are."""
    export_manager.dismiss(export_id)
    return Response(status_code=204)
