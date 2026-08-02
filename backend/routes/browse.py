import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response

from browse import build_browse_response, build_subfolder_stats_response
from filesystem import resolve_initial_folder
from folder_fingerprint import folder_browse_fingerprint
from routes._helpers import resolve_folder
from schemas import BrowseFingerprintResponse, BrowseResponse, SubfolderStatsResponse

router = APIRouter()

JSON_MEDIA_TYPE = "application/json"


def _browse_payload(folder: Path) -> str:
    # Serializing on the worker thread keeps a multi-megabyte folder from tying up
    # the event loop, which would otherwise stall the thumbnail requests the
    # gallery fires as soon as it renders.
    return build_browse_response(folder).model_dump_json()


@router.get(
    "/browse",
    response_model=None,
    responses={200: {"model": BrowseResponse}},
)
async def browse(
    path: str | None = Query(None, description="Folder to browse; defaults to last or home"),
) -> Response:
    folder = resolve_initial_folder(path)
    payload = await asyncio.to_thread(_browse_payload, folder)
    return Response(content=payload, media_type=JSON_MEDIA_TYPE)


@router.get("/browse/subfolder-stats", response_model=SubfolderStatsResponse)
async def browse_subfolder_stats(
    path: str = Query(..., description="Folder whose child folders should be counted"),
) -> SubfolderStatsResponse:
    folder = resolve_folder(path)
    return await asyncio.to_thread(build_subfolder_stats_response, folder)


@router.get("/browse/fingerprint", response_model=BrowseFingerprintResponse)
async def browse_fingerprint(
    path: str = Query(..., description="Folder to fingerprint"),
) -> BrowseFingerprintResponse:
    folder = resolve_folder(path)
    fingerprint = await asyncio.to_thread(folder_browse_fingerprint, folder)
    if fingerprint is None:
        raise HTTPException(status_code=500, detail="Failed to fingerprint folder")
    return BrowseFingerprintResponse(fingerprint=fingerprint)
