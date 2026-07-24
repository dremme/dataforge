from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from filesystem import MediaPreviewError, open_file_in_default_viewer
from media_delete import delete_media_with_sidecars
from media_move import move_media_batch, preview_media_move
from routes._helpers import resolve_folder, resolve_image_file, resolve_media_file
from schemas import (
    MediaDeleteResponse,
    MediaMovePreviewRequest,
    MediaMovePreviewResponse,
    MediaMoveRequest,
    MediaMoveResponse,
    MediaOpenResponse,
)
from thumbnails import (
    DEFAULT_THUMBNAIL_WIDTH,
    MAX_THUMBNAIL_WIDTH,
    MIN_THUMBNAIL_WIDTH,
    ThumbnailError,
    ThumbnailUnavailableError,
    get_or_create_thumbnail,
)

router = APIRouter()


@router.get("/media")
def serve_media(
    path: str = Query(..., description="Absolute path to image or video file"),
) -> FileResponse:
    return FileResponse(resolve_media_file(path))


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


@router.post("/media/move/preview", response_model=MediaMovePreviewResponse)
def preview_move_media(
    destination: str = Query(..., description="Absolute path to destination folder"),
    body: MediaMovePreviewRequest = ...,
) -> MediaMovePreviewResponse:
    folder = resolve_folder(destination)
    source_paths = [resolve_media_file(path) for path in body.paths]
    result = preview_media_move(folder, source_paths)
    return MediaMovePreviewResponse(**result)


@router.post("/media/move", response_model=MediaMoveResponse)
def move_media(
    destination: str = Query(..., description="Absolute path to destination folder"),
    overwrite: bool = Query(
        False,
        description="Replace files that already exist in the destination folder",
    ),
    body: MediaMoveRequest = ...,
) -> MediaMoveResponse:
    folder = resolve_folder(destination)

    if not body.paths:
        raise HTTPException(status_code=400, detail="No files were provided")

    source_paths = [resolve_media_file(path) for path in body.paths]
    result = move_media_batch(folder, source_paths, overwrite=overwrite)
    return MediaMoveResponse(**result)


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
) -> FileResponse:
    del v
    file_path = resolve_media_file(path)

    try:
        thumbnail_path = get_or_create_thumbnail(file_path, w)
    except ThumbnailUnavailableError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ThumbnailError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate thumbnail: {exc}",
        ) from exc

    return FileResponse(
        thumbnail_path,
        media_type="image/webp",
        headers={"Cache-Control": "public, max-age=31536000, immutable"},
    )
