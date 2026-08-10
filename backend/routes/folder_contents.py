import asyncio
from pathlib import Path

from fastapi import APIRouter, HTTPException, Query, Response

import folder_watch
from filesystem import resolve_initial_folder
from folder_contents import (
    build_folder_changes,
    build_folder_response,
    build_subfolder_stats_response,
)
from folder_fingerprint import compute_folder_fingerprint
from routes._helpers import resolve_folder
from schemas import (
    FolderChangesResponse,
    FolderFingerprintResponse,
    FolderResponse,
    SubfolderStatsResponse,
)

router = APIRouter()

JSON_MEDIA_TYPE = "application/json"

TAB_QUERY = Query("", description="Caller's tab id, so this folder is watched for it")


def _folder_payload(folder: Path) -> str:
    # Serializing on the worker thread keeps a multi-megabyte folder from tying up
    # the event loop, which would otherwise stall the thumbnail requests the
    # gallery fires as soon as it renders.
    return build_folder_response(folder).model_dump_json()


@router.get(
    "/folders/contents",
    response_model=None,
    responses={200: {"model": FolderResponse}},
)
async def read_folder_contents(
    path: str | None = Query(None, description="Folder to list; defaults to last or home"),
    tab: str = TAB_QUERY,
) -> Response:
    folder = resolve_initial_folder(path)
    # Asking for a folder is what registers interest in it, so there is no separate
    # registration to race with a navigation. Keyed off the resolved folder because
    # ``path`` may be absent here.
    folder_watch.touch(tab, str(folder))
    payload = await asyncio.to_thread(_folder_payload, folder)
    return Response(content=payload, media_type=JSON_MEDIA_TYPE)


@router.get("/folders/subfolder-stats", response_model=SubfolderStatsResponse)
async def read_subfolder_stats(
    path: str = Query(..., description="Folder whose child folders should be counted"),
) -> SubfolderStatsResponse:
    folder = resolve_folder(path)
    return await asyncio.to_thread(build_subfolder_stats_response, folder)


@router.get("/folders/fingerprint", response_model=FolderFingerprintResponse)
async def read_folder_fingerprint(
    path: str = Query(..., description="Folder to fingerprint"),
    tab: str = TAB_QUERY,
) -> FolderFingerprintResponse:
    folder_watch.touch(tab, path)
    folder = resolve_folder(path)
    fingerprint = await asyncio.to_thread(compute_folder_fingerprint, folder)
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
) -> FolderChangesResponse:
    # Before resolving: a folder that has just vanished still needs to stay watched
    # long enough for the client to be told it is gone.
    folder_watch.touch(tab, path)
    folder = resolve_folder(path)
    return await asyncio.to_thread(build_folder_changes, folder, since)
