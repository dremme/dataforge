from pathlib import Path
from time import monotonic

from fastapi import APIRouter, HTTPException, Query, Response

import events
from constants import MEDIA_MIME_TYPES
from edit_sidecars import EditBusyError, backup_path_for, cancel_render, render_slot
from ffmpeg_run import FfmpegCancelled
from filesystem import MediaPreviewError, open_file_in_default_viewer
from gif_frames import (
    GifFrameError,
    GifFrameUnavailableError,
    extract_gif_frame,
    gif_frame_count,
)
from image_edit import apply_image_edit, read_image_edit_spec, revert_image_edit
from image_edit import is_identity_spec as is_identity_image_spec
from image_io import ImageReadError
from media_delete import delete_media_with_sidecars
from media_file_response import MediaFileResponse
from media_transfer import TransferMode, preview_media_transfer, transfer_media_batch
from routes._helpers import (
    resolve_editable_image,
    resolve_editable_video,
    resolve_folder,
    resolve_gif_file,
    resolve_image_file,
    resolve_media_file,
    resolve_optional_gif_file,
    resolve_optional_media_file,
)
from schemas import (
    GifInfoResponse,
    ImageEditResponse,
    ImageEditSpec,
    ImageEditStateResponse,
    MediaDeleteResponse,
    MediaOpenResponse,
    MediaTransferPreviewRequest,
    MediaTransferPreviewResponse,
    MediaTransferRequest,
    MediaTransferResponse,
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
    """The answer for an `optional` request whose file is no longer there.

    A 404 on an `<img>` is logged by the browser itself and cannot be silenced from
    JavaScript, which spams the console for callers that expect files to disappear
    (AI-Toolkit prunes training samples). A bodyless 204 still fires the image's
    error handler, so those callers drop the sample exactly as they did before.
    """
    return Response(status_code=204, headers={"Cache-Control": "no-store"})


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
    if optional:
        file_path = resolve_optional_media_file(path)
        if file_path is None:
            return _gone()
    else:
        file_path = resolve_media_file(path)

    # The content type still comes from the media path: the backup deliberately carries
    # a non-media suffix so nothing else in the app treats it as a file of its own.
    served_path = file_path
    if original:
        backup = backup_path_for(file_path)
        if backup.is_file():
            served_path = backup

    # A versioned URL names one revision of the file, so it can be cached hard.
    # Without one, the response must be revalidated: browsers otherwise apply
    # heuristic freshness and keep serving an edited file's old bytes.
    cache_control = "public, max-age=31536000, immutable" if v else "no-cache, must-revalidate"
    # MediaFileResponse: share-delete open + cancel on disconnect so a video
    # range request cannot leave the source locked against delete on Windows.
    return MediaFileResponse(
        served_path,
        media_type=MEDIA_MIME_TYPES.get(file_path.suffix.lower()),
        headers={"Cache-Control": cache_control},
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

    return MediaDeleteResponse(**result)


def _resolve_transfer_sources(paths: list[str]) -> tuple[list[Path], list[dict[str, str]]]:
    """Split requested paths into the files still on disk and the ones that have vanished.

    A path goes stale the moment the file behind it is renamed, moved, or deleted —
    by a rename job, another window, or Explorer — and the client can hold the old
    name until its next folder refresh. That is one file's problem: failing the whole
    request over it would strand every other file in the batch, so a missing source
    is reported per file instead, the same way a failed transfer is.
    """
    source_paths: list[Path] = []
    missing: list[dict[str, str]] = []

    for path in paths:
        resolved = resolve_optional_media_file(path)
        if resolved is None:
            missing.append({"path": path, "detail": "Media file not found"})
            continue
        source_paths.append(resolved)

    return source_paths, missing


def _preview_transfer(destination: str, paths: list[str]) -> MediaTransferPreviewResponse:
    folder = resolve_folder(destination)
    source_paths, _missing = _resolve_transfer_sources(paths)
    return MediaTransferPreviewResponse(**preview_media_transfer(folder, source_paths))


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
    return MediaTransferResponse(**result)


@router.post("/media/move/preview", response_model=MediaTransferPreviewResponse)
def preview_move_media(
    destination: str = Query(..., description="Absolute path to destination folder"),
    body: MediaTransferPreviewRequest = ...,
) -> MediaTransferPreviewResponse:
    return _preview_transfer(destination, body.paths)


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


@router.post("/media/copy/preview", response_model=MediaTransferPreviewResponse)
def preview_copy_media(
    destination: str = Query(..., description="Absolute path to destination folder"),
    body: MediaTransferPreviewRequest = ...,
) -> MediaTransferPreviewResponse:
    return _preview_transfer(destination, body.paths)


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
    """One GIF frame as a JPEG, which is what the frame-capture viewer previews.

    Deliberately not written to the thumbnail cache: these are full-resolution and
    live only as long as the scrub, so caching them would evict real thumbnails.
    The browser holds them instead, which is why a versioned URL is cached hard.
    """
    if optional:
        file_path = resolve_optional_gif_file(path)
        if file_path is None:
            return _gone()
    else:
        file_path = resolve_gif_file(path)

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

    cache_control = "public, max-age=31536000, immutable" if v else "no-cache, must-revalidate"
    return Response(
        content=data,
        media_type="image/jpeg",
        headers={"Cache-Control": cache_control},
    )


@router.get("/thumbnail")
def serve_thumbnail(
    path: str = Query(..., description="Absolute path to image or video file"),
    w: int = Query(
        DEFAULT_THUMBNAIL_WIDTH,
        ge=MIN_THUMBNAIL_WIDTH,
        le=MAX_THUMBNAIL_WIDTH,
        description="Maximum thumbnail width in pixels",
    ),
    v: str | None = Query(
        None,
        description="Client cache-busting token derived from file metadata",
    ),
    optional: bool = Query(False, description=_OPTIONAL_DESCRIPTION),
) -> Response:
    del v

    if optional:
        file_path = resolve_optional_media_file(path)
        if file_path is None:
            return _gone()
    else:
        file_path = resolve_media_file(path)

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

    # MediaFileResponse for the same reason as /media: cache pruning deletes
    # these .webp files, and a plain FileResponse would lock one mid-stream.
    return MediaFileResponse(
        thumbnail_path,
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )


#: Progress frames are thinned the way job frames are: the bar has one width, and the
#: encoder reports far more often than it is worth waking every reader for.
VIDEO_EDIT_EVENT_MIN_INTERVAL_SECONDS = 0.25


def _video_edit_progress(media: Path, tab: str, duration: float | None):
    """A callback that pushes render progress to the one tab waiting on it.

    Returns ``None`` when there is no tab to address, so the encode is not asked to
    report into nothing.
    """
    if not tab:
        return None

    last_published = 0.0

    def publish(seconds: float) -> None:
        nonlocal last_published
        now = monotonic()
        if now - last_published < VIDEO_EDIT_EVENT_MIN_INTERVAL_SECONDS:
            return

        last_published = now
        events.publish_to_tabs(
            [tab],
            VideoEditEvent(path=str(media), seconds=seconds, duration=duration).model_dump(),
        )

    return publish


def _video_edit_failure(exc: Exception) -> HTTPException:
    if isinstance(exc, EditBusyError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, FfmpegCancelled):
        return HTTPException(status_code=409, detail="The edit was cancelled")
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    if isinstance(exc, RuntimeError) and str(exc) == FFMPEG_MISSING_MESSAGE:
        return HTTPException(status_code=503, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@router.get("/media/video-edit", response_model=VideoEditStateResponse)
def read_video_edit(
    path: str = Query(..., description="Absolute path to a video file"),
) -> VideoEditStateResponse:
    """What the editor needs to re-open on a file it has already changed."""
    media = resolve_editable_video(path)

    return VideoEditStateResponse(
        path=str(media),
        has_backup=backup_path_for(media).is_file(),
        spec=read_edit_spec(media),
    )


@router.post("/media/video-edit", response_model=VideoEditResponse)
def edit_video(
    path: str = Query(..., description="Absolute path to a video file"),
    tab: str = Query("", description="Client tab id, so progress reaches the right stream"),
    body: VideoEditSpec = ...,
) -> VideoEditResponse:
    """Render the spec from the untouched original and put it back under the same name.

    A plain ``def`` on purpose: FastAPI runs it on the threadpool, so a long encode never
    stalls the event loop that carries its own progress frames.
    """
    media = resolve_editable_video(path)

    if is_identity_spec(body):
        raise HTTPException(status_code=400, detail="This edit would not change the video")

    on_progress = _video_edit_progress(media, tab, expected_output_seconds(body))

    try:
        with render_slot(media) as should_cancel:
            return apply_video_edit(
                media, body, on_progress=on_progress, should_cancel=should_cancel
            )
    except (EditBusyError, FfmpegCancelled, ValueError, RuntimeError, OSError) as exc:
        raise _video_edit_failure(exc) from exc


@router.post("/media/video-edit/cancel", status_code=204)
def cancel_video_edit(
    path: str = Query(..., description="Absolute path to a video file"),
) -> Response:
    """Stop an in-flight render. Silent when there is none: it may have just finished."""
    cancel_render(resolve_editable_video(path))

    return Response(status_code=204)


@router.post("/media/video-edit/revert", response_model=VideoEditResponse)
def revert_video(
    path: str = Query(..., description="Absolute path to a video file"),
) -> VideoEditResponse:
    media = resolve_editable_video(path)

    try:
        with render_slot(media):
            return revert_video_edit(media)
    except (EditBusyError, ValueError, OSError) as exc:
        raise _video_edit_failure(exc) from exc


def _image_edit_failure(exc: Exception) -> HTTPException:
    if isinstance(exc, EditBusyError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, ValueError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=str(exc))


@router.get("/media/image-edit", response_model=ImageEditStateResponse)
def read_image_edit(
    path: str = Query(..., description="Absolute path to an image file"),
) -> ImageEditStateResponse:
    """What the editor needs to re-open on a file it has already changed."""
    media = resolve_editable_image(path)

    return ImageEditStateResponse(
        path=str(media),
        has_backup=backup_path_for(media).is_file(),
        spec=read_image_edit_spec(media),
    )


@router.post("/media/image-edit", response_model=ImageEditResponse)
def edit_image(
    path: str = Query(..., description="Absolute path to an image file"),
    body: ImageEditSpec = ...,
) -> ImageEditResponse:
    """Render the spec from the untouched original and put it back under the same name.

    A plain ``def`` on purpose: FastAPI runs it on the threadpool, so a large resample
    never stalls the event loop. There is no progress channel and no cancel - a Pillow
    pass finishes in the time it would take to draw a bar.
    """
    media = resolve_editable_image(path)

    if is_identity_image_spec(body):
        raise HTTPException(status_code=400, detail="This edit would not change the image")

    try:
        with render_slot(media):
            return apply_image_edit(media, body)
    except (EditBusyError, ValueError, ImageReadError, OSError) as exc:
        raise _image_edit_failure(exc) from exc


@router.post("/media/image-edit/revert", response_model=ImageEditResponse)
def revert_image(
    path: str = Query(..., description="Absolute path to an image file"),
) -> ImageEditResponse:
    media = resolve_editable_image(path)

    try:
        with render_slot(media):
            return revert_image_edit(media)
    except (EditBusyError, ValueError, OSError) as exc:
        raise _image_edit_failure(exc) from exc
