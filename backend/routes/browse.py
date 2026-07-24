import asyncio

from fastapi import APIRouter, HTTPException, Query

from browse import build_browse_response
from filesystem import resolve_initial_folder
from folder_fingerprint import folder_browse_fingerprint
from routes._helpers import resolve_folder
from schemas import BrowseFingerprintResponse, BrowseResponse

router = APIRouter()


@router.get("/browse", response_model=BrowseResponse)
async def browse(
    path: str | None = Query(None, description="Folder to browse; defaults to last or home"),
) -> BrowseResponse:
    folder = resolve_initial_folder(path)
    return await asyncio.to_thread(build_browse_response, folder)


@router.get("/browse/fingerprint", response_model=BrowseFingerprintResponse)
async def browse_fingerprint(
    path: str = Query(..., description="Folder to fingerprint"),
) -> BrowseFingerprintResponse:
    folder = resolve_folder(path)
    fingerprint = await asyncio.to_thread(folder_browse_fingerprint, folder)
    if fingerprint is None:
        raise HTTPException(status_code=500, detail="Failed to fingerprint folder")
    return BrowseFingerprintResponse(fingerprint=fingerprint)
