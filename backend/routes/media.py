from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse

from filesystem import MediaPreviewError, open_file_in_default_viewer
from media_delete import delete_media_with_sidecars
from media_transfer import TransferMode, preview_media_transfer, transfer_media_batch
from routes._helpers import resolve_folder, resolve_image_file, resolve_media_file
from schemas import (
    MediaDeleteResponse,
    MediaOpenResponse,
    MediaTransferPreviewRequest,
    MediaTransferPreviewResponse,
    MediaTransferRequest,
    MediaTransferResponse,
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
    v: str | None = Query(
        None,
        description="Client cache-busting token derived from file metadata",
    ),
) -> FileResponse:
    # A versioned URL names one revision of the file, so it can be cached hard.
    # Without one, the response must be revalidated: browsers otherwise apply
    # heuristic freshness and keep serving an edited file's old bytes.
    cache_control = "public, max-age=31536000, immutable" if v else "no-cache, must-revalidate"
    return FileResponse(
        resolve_media_file(path),
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


def _preview_transfer(destination: str, paths: list[str]) -> MediaTransferPreviewResponse:
    folder = resolve_folder(destination)
    source_paths = [resolve_media_file(path) for path in paths]
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

    source_paths = [resolve_media_file(path) for path in paths]
    result = transfer_media_batch(folder, source_paths, mode=mode, overwrite=overwrite)
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
