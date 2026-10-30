from collections.abc import Callable, Mapping
from functools import partial
from pathlib import Path
from time import monotonic

from fastapi import APIRouter, HTTPException, Query, Response

import events
from audio_edit import FFMPEG_MISSING_MESSAGE as AUDIO_FFMPEG_MISSING_MESSAGE
from audio_edit import apply_audio_edit, measure_loudness, read_audio_edit_spec, revert_audio_edit
from audio_edit import expected_output_seconds as expected_audio_seconds
from audio_edit import is_identity_spec as is_identity_audio_spec
from audio_effects import audio_proxy, needs_proxy, probe_audio
from audio_info import audio_duration
from color_auto import image_analysis_pixels, suggest_adjust, video_analysis_pixels
from comfy_candidates import (
    NoCandidateError,
    accept_candidate,
    describe_candidate_state,
    reject_candidate,
)
from constants import AUDIO_PITCH_MAX_SEMITONES, GALLERY_EXTENSIONS, MEDIA_MIME_TYPES
from edit_sidecars import has_backup, original_path_for
from ffmpeg_bin import ffmpeg_path
from ffmpeg_run import FfmpegCancelled
from filesystem import MediaPreviewError, normalize_user_path, open_file_in_default_viewer
from gif_frames import (
    GifFrameError,
    GifFrameUnavailableError,
    extract_gif_frame,
    gif_frame_count,
)
from gif_to_mp4 import (
    FFMPEG_MISSING_MESSAGE as GIF_TO_MP4_FFMPEG_MISSING_MESSAGE,
)
from gif_to_mp4 import (
    convert_gif_to_mp4,
    mp4_target_for,
    read_gif_to_mp4_state,
)
from image_edit import apply_image_edit, read_image_edit_spec, revert_image_edit
from image_edit import is_identity_spec as is_identity_image_spec
from image_io import ImageReadError
from media_claims import MediaBusyError, cancel
from media_delete import (
    MediaReappearedError,
    delete_leftovers,
    delete_media_with_sidecars,
    restore_media_with_sidecars,
)
from media_file_response import MediaFileResponse
from media_rename import rename_media_file
from media_transfer import TransferMode, preview_media_transfer, transfer_media_batch
from routes._helpers import (
    resolve_candidate_media,
    resolve_candidate_source,
    resolve_editable_audio,
    resolve_editable_image,
    resolve_editable_video,
    resolve_folder,
    resolve_gif_file,
    resolve_image_file,
    resolve_media_file,
    resolve_optional_gif_file,
    resolve_optional_media_file,
    resolve_sounding_file,
)
from schemas import (
    AudioEditEvent,
    AudioEditResponse,
    AudioEditSpec,
    AudioEditStateResponse,
    AudioLoudnessResponse,
    AutoAdjustResponse,
    ComfyCandidateBatchRequest,
    ComfyCandidateBatchResponse,
    ComfyCandidateFailure,
    ComfyCandidateResponse,
    ComfyCandidateStateResponse,
    GifInfoResponse,
    GifToMp4Response,
    GifToMp4StateResponse,
    ImageEditResponse,
    ImageEditSpec,
    ImageEditStateResponse,
    MediaCleanupRequest,
    MediaDeleteResponse,
    MediaOpenResponse,
    MediaRestoreRequest,
    MediaRestoreResponse,
    MediaTransferPreviewRequest,
    MediaTransferPreviewResponse,
    MediaTransferRequest,
    MediaTransferResponse,
    RenameResponse,
    VideoEditEvent,
    VideoEditResponse,
    VideoEditSpec,
    VideoEditStateResponse,
)
from thumbnails import (
    DEFAULT_THUMBNAIL_WIDTH,
    MAX_THUMBNAIL_WIDTH,
    MIN_THUMBNAIL_WIDTH,
    ThumbnailError,
    ThumbnailUnavailableError,
    get_or_create_thumbnail,
)
from video_edit import (
    FFMPEG_MISSING_MESSAGE,
    apply_video_edit,
    expected_output_seconds,
    is_identity_spec,
    probe_source,
    read_edit_spec,
    revert_video_edit,
)

router = APIRouter()

_ORIGINAL_DESCRIPTION = (
    "Serve the untouched original kept beside an edited file, so the editor can work "
    "against the source its spec is expressed in rather than the last render"
)

_OPTIONAL_DESCRIPTION = (
    "Treat a file that is gone as normal: answer 204 rather than 404, "
    "so the browser does not log the failed load"
)


def _gone() -> Response:
    """A 404 on `<img>` cannot be silenced, so an `optional` request gets a 204 instead."""
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


def _served_file(
    path: str,
    optional: bool,
    required: Callable[[str], Path],
    when_present: Callable[[str], Path | None],
) -> Path | None:
    """The requested file, or ``None`` when an ``optional`` request finds it gone."""
    return when_present(path) if optional else required(path)


def _cache_control(version: str | None) -> str:
    """A versioned URL can be cached hard; without one, revalidate or browsers keep old bytes."""
    return "public, max-age=31536000, immutable" if version else "no-cache, must-revalidate"


ErrorStatus = int | tuple[int, str]


def _http_error(
    exc: Exception,
    statuses: Mapping[type[Exception], ErrorStatus],
    *,
    missing_tool: str | None = None,
) -> HTTPException:
    """The first matching entry wins; ``missing_tool`` is the RuntimeError text that means 503."""
    if missing_tool is not None and isinstance(exc, RuntimeError) and str(exc) == missing_tool:
        return HTTPException(status_code=503, detail=str(exc))
    for kind, status in statuses.items():
        if isinstance(exc, kind):
            code, detail = status if isinstance(status, tuple) else (status, str(exc))
            return HTTPException(status_code=code, detail=detail)
    return HTTPException(status_code=500, detail=str(exc))


_GIF_TO_MP4_ERRORS: dict[type[Exception], ErrorStatus] = {
    FfmpegCancelled: (409, "The conversion was cancelled"),
}
_RENDER_EDIT_ERRORS: dict[type[Exception], ErrorStatus] = {
    FfmpegCancelled: (409, "The edit was cancelled"),
    ValueError: 400,
}
_IMAGE_EDIT_ERRORS: dict[type[Exception], ErrorStatus] = {ValueError: 400}
_CANDIDATE_ERRORS: dict[type[Exception], ErrorStatus] = {
    NoCandidateError: 404,
    ValueError: 409,
}


@router.get("/media")
def serve_media(
    path: str = Query(..., description="Absolute path to image or video file"),
    v: str | None = Query(
        None,
        description="Client cache-busting token derived from file metadata",
    ),
    optional: bool = Query(False, description=_OPTIONAL_DESCRIPTION),
    original: bool = Query(False, description=_ORIGINAL_DESCRIPTION),
) -> Response:
    file_path = _served_file(path, optional, resolve_media_file, resolve_optional_media_file)
    if file_path is None:
        return _gone()

    # Content type comes from the media path; the backup suffix is deliberately non-media.
    served_path = original_path_for(file_path) if original else file_path

    # MediaFileResponse: share-delete open + cancel on disconnect so Windows cannot lock deletes.
    return MediaFileResponse(
        served_path,
        media_type=MEDIA_MIME_TYPES.get(file_path.suffix.lower()),
        headers={"Cache-Control": _cache_control(v)},
    )


@router.post("/media/open", response_model=MediaOpenResponse)
def open_media_in_viewer(
    path: str = Query(..., description="Absolute path to image file"),
) -> MediaOpenResponse:
    file_path = resolve_image_file(path)

    try:
        open_file_in_default_viewer(file_path)
    except MediaPreviewError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return MediaOpenResponse(path=str(file_path))


@router.delete("/media", response_model=MediaDeleteResponse)
def delete_media(
    path: str = Query(..., description="Absolute path to image or video file"),
) -> MediaDeleteResponse:
    file_path = resolve_media_file(path)

    try:
        result = delete_media_with_sidecars(file_path)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return MediaDeleteResponse.model_validate(result)


@router.post("/media/cleanup", response_model=MediaDeleteResponse)
def clean_up_after_delete(body: MediaCleanupRequest) -> MediaDeleteResponse:
    """Retry deleting what a deleted file left behind, such as a caption another program held."""
    requested = Path(body.path)
    folder = resolve_folder(str(requested.parent))
    media = folder / requested.name
    if media.suffix.lower() not in GALLERY_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Not a supported media file")
    try:
        files = [normalize_user_path(raw) for raw in body.files]
        return MediaDeleteResponse.model_validate(delete_leftovers(media, files))
    except MediaReappearedError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/media/restore", response_model=MediaRestoreResponse)
def restore_deleted_media(body: MediaRestoreRequest) -> MediaRestoreResponse:
    """Bring a deleted file and its own sidecars back from the Recycle Bin."""
    requested = Path(body.path)
    folder = resolve_folder(str(requested.parent))
    media = folder / requested.name
    if media.suffix.lower() not in GALLERY_EXTENSIONS:
        raise HTTPException(status_code=400, detail="Not a supported media file")
    try:
        files = [normalize_user_path(raw) for raw in body.files]
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return MediaRestoreResponse.model_validate(restore_media_with_sidecars(media, files))


@router.post("/media/rename", response_model=RenameResponse)
def rename_media(
    path: str = Query(..., description="Absolute path to image, video or audio file"),
    name: str = Query(..., description="New file name without its extension"),
) -> RenameResponse:
    return RenameResponse.model_validate(rename_media_file(resolve_media_file(path), name))


def _resolve_transfer_sources(paths: list[str]) -> tuple[list[Path], list[dict[str, str]]]:
    source_paths: list[Path] = []
    missing: list[dict[str, str]] = []

    for path in paths:
        resolved = resolve_optional_media_file(path)
        if resolved is None:
            missing.append({"path": path, "detail": "Media file not found"})
            continue
        source_paths.append(resolved)

    return source_paths, missing


def _transfer(
    destination: str,
    paths: list[str],
    *,
    mode: TransferMode,
    overwrite: bool,
) -> MediaTransferResponse:
    folder = resolve_folder(destination)

    if not paths:
        raise HTTPException(status_code=400, detail="No files were provided")

    source_paths, missing = _resolve_transfer_sources(paths)
    result = transfer_media_batch(folder, source_paths, mode=mode, overwrite=overwrite)
    result["failed"] = [*result["failed"], *missing]
    return MediaTransferResponse.model_validate(result)


@router.post("/media/move/preview", response_model=MediaTransferPreviewResponse)
@router.post("/media/copy/preview", response_model=MediaTransferPreviewResponse)
def preview_transfer_media(
    destination: str = Query(..., description="Absolute path to destination folder"),
    body: MediaTransferPreviewRequest = ...,
) -> MediaTransferPreviewResponse:
    """Move and copy collide on the same names, so both previews are one question."""
    source_paths, _missing = _resolve_transfer_sources(body.paths)
    return MediaTransferPreviewResponse.model_validate(
        preview_media_transfer(resolve_folder(destination), source_paths)
    )


@router.post("/media/move", response_model=MediaTransferResponse)
def move_media(
    destination: str = Query(..., description="Absolute path to destination folder"),
    overwrite: bool = Query(
        False,
        description="Replace files that already exist in the destination folder",
    ),
    body: MediaTransferRequest = ...,
) -> MediaTransferResponse:
    return _transfer(destination, body.paths, mode="move", overwrite=overwrite)


@router.post("/media/copy", response_model=MediaTransferResponse)
def copy_media(
    destination: str = Query(..., description="Absolute path to destination folder"),
    overwrite: bool = Query(
        False,
        description="Replace files that already exist in the destination folder",
    ),
    body: MediaTransferRequest = ...,
) -> MediaTransferResponse:
    return _transfer(destination, body.paths, mode="copy", overwrite=overwrite)


@router.get("/gif-info", response_model=GifInfoResponse)
def serve_gif_info(
    path: str = Query(..., description="Absolute path to a GIF file"),
) -> GifInfoResponse:
    file_path = resolve_gif_file(path)

    frame_count = gif_frame_count(file_path)
    if frame_count is None:
        raise HTTPException(status_code=400, detail="Failed to read GIF")

    return GifInfoResponse(frame_count=frame_count)


@router.get("/gif-frame")
def serve_gif_frame(
    path: str = Query(..., description="Absolute path to a GIF file"),
    frame: int = Query(0, ge=0, description="Zero-based frame index"),
    v: str | None = Query(
        None,
        description="Client cache-busting token derived from file metadata",
    ),
    optional: bool = Query(False, description=_OPTIONAL_DESCRIPTION),
) -> Response:
    """One GIF frame as a JPEG; not written to the thumbnail cache."""
    file_path = _served_file(path, optional, resolve_gif_file, resolve_optional_gif_file)
    if file_path is None:
        return _gone()

    try:
        data = extract_gif_frame(file_path, frame)
    except GifFrameUnavailableError as exc:
        if optional:
            return _gone()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except GifFrameError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to extract GIF frame: {exc}") from exc

    return Response(
        content=data, media_type="image/jpeg", headers={"Cache-Control": _cache_control(v)}
    )


@router.get("/media/gif-to-mp4", response_model=GifToMp4StateResponse)
def read_gif_to_mp4(
    path: str = Query(..., description="Absolute path to a GIF file"),
) -> GifToMp4StateResponse:
    """What the convert button needs to know before it writes anything."""
    return read_gif_to_mp4_state(resolve_gif_file(path))


@router.post("/media/gif-to-mp4", response_model=GifToMp4Response)
def convert_gif(
    path: str = Query(..., description="Absolute path to a GIF file"),
    overwrite: bool = Query(False, description="Replace an MP4 that already holds the name"),
) -> GifToMp4Response:
    """Write the GIF out as an MP4 beside it, at the fixed conversion frame rate."""
    media = resolve_gif_file(path)
    target = mp4_target_for(media)

    if not overwrite and target.exists():
        raise HTTPException(status_code=409, detail=f"{target.name} already exists in this folder")

    try:
        return convert_gif_to_mp4(media)
    except (FfmpegCancelled, RuntimeError, OSError) as exc:
        raise _http_error(
            exc, _GIF_TO_MP4_ERRORS, missing_tool=GIF_TO_MP4_FFMPEG_MISSING_MESSAGE
        ) from exc


@router.get("/thumbnail")
def serve_thumbnail(
    path: str = Query(..., description="Absolute path to image or video file"),
    w: int = Query(
        DEFAULT_THUMBNAIL_WIDTH,
        ge=MIN_THUMBNAIL_WIDTH,
        le=MAX_THUMBNAIL_WIDTH,
        description="Maximum thumbnail width in pixels",
    ),
    optional: bool = Query(False, description=_OPTIONAL_DESCRIPTION),
) -> Response:
    """Always cached hard: the cache key already changes with the source file."""
    file_path = _served_file(path, optional, resolve_media_file, resolve_optional_media_file)
    if file_path is None:
        return _gone()

    try:
        thumbnail_path = get_or_create_thumbnail(file_path, w)
    except ThumbnailUnavailableError as exc:
        # Same bargain as a missing file: the caller opted out of being told loudly.
        if optional:
            return _gone()
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ThumbnailError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate thumbnail: {exc}",
        ) from exc

    # MediaFileResponse: cache pruning deletes these .webp files mid-stream.
    return MediaFileResponse(
        thumbnail_path,
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


EDIT_EVENT_MIN_INTERVAL_SECONDS = 0.25


def _edit_progress(tab: str, event: Callable[[float], dict[str, object]]):
    """Throttled, and addressed to the tab that asked; ``None`` without one."""
    if not tab:
        return None

    last_published = 0.0

    def publish(seconds: float) -> None:
        nonlocal last_published
        now = monotonic()
        if now - last_published < EDIT_EVENT_MIN_INTERVAL_SECONDS:
            return

        last_published = now
        events.publish_to_tabs([tab], event(seconds))

    return publish


def _video_edit_progress(media: Path, tab: str, duration: float | None):
    return _edit_progress(
        tab,
        lambda seconds: VideoEditEvent(
            path=str(media), seconds=seconds, duration=duration
        ).model_dump(),
    )


@router.get("/media/video-edit", response_model=VideoEditStateResponse)
def read_video_edit(
    path: str = Query(..., description="Absolute path to a video file"),
) -> VideoEditStateResponse:
    """What the editor needs to re-open on a file it has already changed."""
    media = resolve_editable_video(path)

    # The editor plays the original, so probe the file it shows: its rate is the grid the
    # trim handles snap to.
    return VideoEditStateResponse(
        path=str(media),
        has_backup=has_backup(media),
        frame_rate=probe_source(original_path_for(media)).frame_rate,
        spec=read_edit_spec(media),
    )


@router.post("/media/video-edit", response_model=VideoEditResponse)
def edit_video(
    path: str = Query(..., description="Absolute path to a video file"),
    tab: str = Query("", description="Client tab id, so progress reaches the right stream"),
    body: VideoEditSpec = ...,
) -> VideoEditResponse:
    """Render the spec from the untouched original and put it back under the same name."""
    media = resolve_editable_video(path)

    if is_identity_spec(body):
        raise HTTPException(status_code=400, detail="This edit would not change the video")

    # The render reads the backup once it exists, so probe the same file apply_video_edit will,
    # and hand the result on: an untrimmed retime has no end without it, and the bar goes blank.
    probe = probe_source(original_path_for(media))
    on_progress = _video_edit_progress(media, tab, expected_output_seconds(body, probe.seconds))

    try:
        return apply_video_edit(media, body, on_progress=on_progress, probe=probe)
    except (FfmpegCancelled, ValueError, RuntimeError, OSError) as exc:
        raise _http_error(exc, _RENDER_EDIT_ERRORS, missing_tool=FFMPEG_MISSING_MESSAGE) from exc


@router.post("/media/video-edit/auto", response_model=AutoAdjustResponse)
def auto_adjust_video(
    path: str = Query(..., description="Absolute path to a video file"),
    body: VideoEditSpec = ...,
) -> AutoAdjustResponse:
    """Suggest Adjust positions for the kept range and crop. Takes no render slot: it only reads."""
    source = original_path_for(resolve_editable_video(path))

    try:
        pixels, weights = video_analysis_pixels(
            source,
            body.masks,
            body.crop,
            start=body.trim_start,
            end=body.trim_end,
            duration=probe_source(source).seconds,
        )
        return AutoAdjustResponse(suggestion=suggest_adjust(pixels, weights))
    except (ValueError, OSError) as exc:
        raise _http_error(exc, _RENDER_EDIT_ERRORS) from exc


@router.post("/media/video-edit/cancel", status_code=204)
def cancel_video_edit(
    path: str = Query(..., description="Absolute path to a video file"),
) -> Response:
    """Stop an in-flight render. Silent when there is none: it may have just finished."""
    cancel(resolve_editable_video(path), "render")

    return Response(status_code=204)


@router.post("/media/video-edit/revert", response_model=VideoEditResponse)
def revert_video(
    path: str = Query(..., description="Absolute path to a video file"),
) -> VideoEditResponse:
    media = resolve_editable_video(path)

    try:
        return revert_video_edit(media)
    except (ValueError, OSError) as exc:
        raise _http_error(exc, _RENDER_EDIT_ERRORS) from exc


@router.get("/media/audio-edit", response_model=AudioEditStateResponse)
def read_audio_edit(
    path: str = Query(..., description="Absolute path to an audio file"),
) -> AudioEditStateResponse:
    """What the editor needs to re-open on a file it has already changed."""
    media = resolve_editable_audio(path)

    # The editor plays the original, and trims are measured against it.
    try:
        duration = audio_duration(original_path_for(media))
    except OSError:
        duration = None
    return AudioEditStateResponse(
        path=str(media),
        has_backup=has_backup(media),
        duration=duration,
        spec=read_audio_edit_spec(media),
    )


@router.post("/media/audio-edit", response_model=AudioEditResponse)
def edit_audio(
    path: str = Query(..., description="Absolute path to an audio file"),
    tab: str = Query("", description="Client tab id, so progress reaches the right stream"),
    body: AudioEditSpec = ...,
) -> AudioEditResponse:
    """Render the spec from the untouched original and put it back under the same name."""
    media = resolve_editable_audio(path)

    if is_identity_audio_spec(body):
        raise HTTPException(status_code=400, detail="This edit would not change the sound")

    executable = ffmpeg_path()
    if not executable:
        raise HTTPException(status_code=503, detail=AUDIO_FFMPEG_MISSING_MESSAGE)
    probe = probe_audio(executable, original_path_for(media))
    duration = expected_audio_seconds(body, probe.duration)
    on_progress = _edit_progress(
        tab,
        lambda seconds: AudioEditEvent(
            path=str(media), seconds=seconds, duration=duration
        ).model_dump(),
    )

    try:
        return apply_audio_edit(media, body, ffmpeg=executable, on_progress=on_progress)
    except (FfmpegCancelled, ValueError, RuntimeError, OSError) as exc:
        raise _http_error(
            exc, _RENDER_EDIT_ERRORS, missing_tool=AUDIO_FFMPEG_MISSING_MESSAGE
        ) from exc


@router.post("/media/audio-edit/loudness", response_model=AudioLoudnessResponse)
def measure_audio_loudness(
    path: str = Query(..., description="Absolute path to an audio file"),
    body: AudioEditSpec = ...,
) -> AudioLoudnessResponse:
    """The loudness of the sound as the spec shapes it, before its level stage, so the preview
    plays a normalize at the gain the render will use. Takes no render slot: it only reads."""
    source = original_path_for(resolve_editable_audio(path))

    try:
        return AudioLoudnessResponse(integrated_lufs=measure_loudness(source, body))
    except (ThumbnailError, ValueError, RuntimeError, OSError) as exc:
        raise _http_error(
            exc, _RENDER_EDIT_ERRORS, missing_tool=AUDIO_FFMPEG_MISSING_MESSAGE
        ) from exc


@router.post("/media/audio-edit/cancel", status_code=204)
def cancel_audio_edit(
    path: str = Query(..., description="Absolute path to an audio file"),
) -> Response:
    """Stop an in-flight render. Silent when there is none: it may have just finished."""
    cancel(resolve_editable_audio(path), "render")

    return Response(status_code=204)


@router.post("/media/audio-edit/revert", response_model=AudioEditResponse)
def revert_audio(
    path: str = Query(..., description="Absolute path to an audio file"),
) -> AudioEditResponse:
    media = resolve_editable_audio(path)

    try:
        return revert_audio_edit(media)
    except (ValueError, OSError) as exc:
        raise _http_error(exc, _RENDER_EDIT_ERRORS) from exc


def _audio_proxy_file(path: str, original: bool, noise_reduction: float, pitch: int) -> Path:
    media = resolve_sounding_file(path)
    if not needs_proxy(noise_reduction, pitch):
        raise HTTPException(status_code=400, detail="This sound needs no proxy")
    executable = ffmpeg_path()
    if not executable:
        raise HTTPException(status_code=503, detail=AUDIO_FFMPEG_MISSING_MESSAGE)
    source = original_path_for(media) if original else media
    try:
        return audio_proxy(executable, source, noise_reduction=noise_reduction, pitch=pitch)
    except (ThumbnailError, FfmpegCancelled, ValueError, RuntimeError, OSError) as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


_PROXY_NOISE_DESCRIPTION = "Noise reduction strength, 0 to 1"
_PROXY_PITCH_DESCRIPTION = "Pitch move in semitones"


@router.get("/media/audio-proxy")
def serve_audio_proxy(
    path: str = Query(..., description="Absolute path to an audio or video file"),
    noise_reduction: float = Query(0.0, ge=0.0, le=1.0, description=_PROXY_NOISE_DESCRIPTION),
    pitch: int = Query(
        0,
        ge=-AUDIO_PITCH_MAX_SEMITONES,
        le=AUDIO_PITCH_MAX_SEMITONES,
        description=_PROXY_PITCH_DESCRIPTION,
    ),
    original: bool = Query(False, description=_ORIGINAL_DESCRIPTION),
    v: str | None = Query(None, description="Client cache-busting token"),
) -> Response:
    """The file's sound with its noise reduced and pitch moved, for the preview to play."""
    proxy = _audio_proxy_file(path, original, noise_reduction, pitch)
    # MediaFileResponse: cache pruning deletes these files mid-stream.
    return MediaFileResponse(
        proxy, media_type="audio/flac", headers={"Cache-Control": _cache_control(v)}
    )


@router.post("/media/audio-proxy", status_code=204)
def prepare_audio_proxy(
    path: str = Query(..., description="Absolute path to an audio or video file"),
    noise_reduction: float = Query(0.0, ge=0.0, le=1.0, description=_PROXY_NOISE_DESCRIPTION),
    pitch: int = Query(
        0,
        ge=-AUDIO_PITCH_MAX_SEMITONES,
        le=AUDIO_PITCH_MAX_SEMITONES,
        description=_PROXY_PITCH_DESCRIPTION,
    ),
    original: bool = Query(False, description=_ORIGINAL_DESCRIPTION),
) -> Response:
    """Render the proxy now and answer once it is ready, so the preview switches to it without a
    stall."""
    _audio_proxy_file(path, original, noise_reduction, pitch)
    return Response(status_code=204)


@router.get("/media/image-edit", response_model=ImageEditStateResponse)
def read_image_edit(
    path: str = Query(..., description="Absolute path to an image file"),
) -> ImageEditStateResponse:
    """What the editor needs to re-open on a file it has already changed."""
    media = resolve_editable_image(path)

    return ImageEditStateResponse(
        path=str(media),
        has_backup=has_backup(media),
        spec=read_image_edit_spec(media),
    )


@router.post("/media/image-edit", response_model=ImageEditResponse)
def edit_image(
    path: str = Query(..., description="Absolute path to an image file"),
    body: ImageEditSpec = ...,
) -> ImageEditResponse:
    """Render the spec from the untouched original and put it back under the same name."""
    media = resolve_editable_image(path)

    if is_identity_image_spec(body):
        raise HTTPException(status_code=400, detail="This edit would not change the image")

    try:
        return apply_image_edit(media, body)
    except (ValueError, ImageReadError, OSError) as exc:
        raise _http_error(exc, _IMAGE_EDIT_ERRORS) from exc


@router.post("/media/image-edit/auto", response_model=AutoAdjustResponse)
def auto_adjust_image(
    path: str = Query(..., description="Absolute path to an image file"),
    body: ImageEditSpec = ...,
) -> AutoAdjustResponse:
    """Suggest Adjust positions for the crop. Takes no render slot: it only reads."""
    source = original_path_for(resolve_editable_image(path))

    try:
        pixels, weights = image_analysis_pixels(source, body.masks, body.crop)
        return AutoAdjustResponse(suggestion=suggest_adjust(pixels, weights))
    except (ValueError, ImageReadError, OSError) as exc:
        raise _http_error(exc, _IMAGE_EDIT_ERRORS) from exc


@router.post("/media/image-edit/revert", response_model=ImageEditResponse)
def revert_image(
    path: str = Query(..., description="Absolute path to an image file"),
) -> ImageEditResponse:
    media = resolve_editable_image(path)

    try:
        return revert_image_edit(media)
    except (ValueError, OSError) as exc:
        raise _http_error(exc, _IMAGE_EDIT_ERRORS) from exc


# Keyed by the source path, never the staging path.
_CANDIDATE_PATH = Query(..., description="Absolute path to the dataset file, not its candidate")

_DISCARD_EDIT = Query(
    False, description="Recycle the file's edit backup and spec so the candidate becomes the base"
)

_KEEP_METADATA = Query(
    False, description="Give the published file the original's metadata instead of ComfyUI's"
)


@router.get("/media/comfy-candidate", response_model=ComfyCandidateStateResponse)
def read_comfy_candidate(path: str = _CANDIDATE_PATH) -> ComfyCandidateStateResponse:
    return describe_candidate_state(resolve_candidate_media(path))


@router.post("/media/comfy-candidate/accept", response_model=ComfyCandidateResponse)
def accept_comfy_candidate(
    path: str = _CANDIDATE_PATH,
    discard_edit: bool = _DISCARD_EDIT,
    keep_metadata: bool = _KEEP_METADATA,
) -> ComfyCandidateResponse:
    media = resolve_candidate_media(path)

    try:
        return accept_candidate(media, discard_edit=discard_edit, keep_metadata=keep_metadata)
    except (NoCandidateError, ValueError, OSError) as exc:
        raise _http_error(exc, _CANDIDATE_ERRORS) from exc


@router.post("/media/comfy-candidate/reject", response_model=ComfyCandidateResponse)
def reject_comfy_candidate(path: str = _CANDIDATE_PATH) -> ComfyCandidateResponse:
    media = resolve_candidate_source(path)

    try:
        return reject_candidate(media)
    except (NoCandidateError, ValueError, OSError) as exc:
        raise _http_error(exc, _CANDIDATE_ERRORS) from exc


def _settle_candidates(
    paths: list[str],
    resolve: Callable[[str], Path],
    settle: Callable[[Path], ComfyCandidateResponse],
) -> ComfyCandidateBatchResponse:
    settled: list[str] = []
    skipped: list[str] = []
    failed: list[ComfyCandidateFailure] = []

    for raw in paths:
        try:
            media = resolve(raw)
        except HTTPException as exc:
            failed.append(ComfyCandidateFailure(path=raw, detail=str(exc.detail)))
            continue

        try:
            settle(media)
            settled.append(str(media))
        except NoCandidateError:
            skipped.append(str(media))
        except (MediaBusyError, ValueError, OSError) as exc:
            failed.append(ComfyCandidateFailure(path=str(media), detail=str(exc)))

    return ComfyCandidateBatchResponse(settled=settled, skipped=skipped, failed=failed)


@router.post("/media/comfy-candidates/accept", response_model=ComfyCandidateBatchResponse)
def accept_comfy_candidates(body: ComfyCandidateBatchRequest) -> ComfyCandidateBatchResponse:
    """Discards unreverted edits, so the candidate becomes each file's new base."""
    return _settle_candidates(
        body.paths,
        resolve_candidate_media,
        partial(accept_candidate, discard_edit=True, keep_metadata=body.keep_metadata),
    )


@router.post("/media/comfy-candidates/reject", response_model=ComfyCandidateBatchResponse)
def reject_comfy_candidates(body: ComfyCandidateBatchRequest) -> ComfyCandidateBatchResponse:
    return _settle_candidates(body.paths, resolve_candidate_source, reject_candidate)
