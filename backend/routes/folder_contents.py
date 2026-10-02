import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response

import folder_watch
from filesystem import resolve_initial_folder
from folder_contents import (
    build_folder_changes,
    build_folder_fingerprint,
    build_folder_response,
    build_folder_review_counts,
    build_subfolder_stats_response,
)
from routes._helpers import resolve_folder
from schemas import (
    FolderChangesResponse,
    FolderFingerprintResponse,
    FolderResponse,
    FolderReviewCountsResponse,
    SubfolderStatsResponse,
)

router = APIRouter()

JSON_MEDIA_TYPE = "application/json"

TAB_QUERY = Query("", description="Caller's tab id, so this folder is watched for it")


def _folder_payload(folder: Path, remember_last: bool) -> str:
    # Serialize on a worker thread so a large folder does not stall thumbnail requests.
    return build_folder_response(folder, remember_last=remember_last).model_dump_json()


@router.get(
    "/folders/contents",
    response_model=None,
    responses={200: {"model": FolderResponse}},
)
async def read_folder_contents(
    path: str | None = Query(None, description="Folder to list; defaults to last or home"),
    tab: str = TAB_QUERY,
    prefetch: bool = Query(
        False,
        description="A speculative read: neither watched nor remembered as the last folder",
    ),
) -> Response:
    # Resolving stats the path, which blocks for the SMB timeout on a dead network drive.
    folder = await asyncio.to_thread(resolve_initial_folder, path)
    if not prefetch:
        # Registers interest, keyed off the resolved path because ``path`` may be absent.
        folder_watch.touch(tab, str(folder))
    payload = await asyncio.to_thread(_folder_payload, folder, not prefetch)
    return Response(content=payload, media_type=JSON_MEDIA_TYPE)


@router.get("/folders/subfolder-stats", response_model=SubfolderStatsResponse)
async def read_subfolder_stats(
    path: str = Query(..., description="Folder whose child folders should be counted"),
) -> SubfolderStatsResponse:
    folder = await asyncio.to_thread(resolve_folder, path)
    return await asyncio.to_thread(build_subfolder_stats_response, folder)


@router.get("/folders/review-counts", response_model=FolderReviewCountsResponse)
async def read_folder_review_counts(
    path: str = Query(..., description="Folder whose caption issues and candidates are counted"),
) -> FolderReviewCountsResponse:
    folder = await asyncio.to_thread(resolve_folder, path)
    return await asyncio.to_thread(build_folder_review_counts, folder)


@router.get("/folders/fingerprint", response_model=FolderFingerprintResponse)
async def read_folder_fingerprint(
    path: str = Query(..., description="Folder to fingerprint"),
    tab: str = TAB_QUERY,
) -> FolderFingerprintResponse:
    folder_watch.touch(tab, path)
    folder = await asyncio.to_thread(resolve_folder, path)
    fingerprint = await asyncio.to_thread(build_folder_fingerprint, folder)
    if fingerprint is None:
        raise HTTPException(status_code=500, detail="Failed to fingerprint folder")
    return FolderFingerprintResponse(fingerprint=fingerprint)


@router.get("/folders/changes", response_model=FolderChangesResponse)
async def read_folder_changes(
    path: str = Query(..., description="Folder to check"),
    since: str = Query(
        "",
        description="Fingerprint of the listing to diff against; an unknown one answers full",
    ),
    tab: str = TAB_QUERY,
    opened: bool = Query(
        False,
        description="The user opened this folder, so it is the one to start in next time",
    ),
) -> FolderChangesResponse:
    # Watch a vanished folder long enough for the client to be told it is gone.
    folder_watch.touch(tab, path)
    folder = await asyncio.to_thread(resolve_folder, path)
    return await asyncio.to_thread(build_folder_changes, folder, since, remember_last=opened)
