from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from duplicates import (
    delete_duplicate_file,
    group_duplicate_findings,
    stale_duplicate_members,
)
from folder_scan import scan_folder
from media_delete import delete_media_with_sidecars, deletes_to_trash
from media_listing import media_items_named
from routes._helpers import resolve_folder, resolve_media_file
from schemas import (
    DuplicateDismissRequest,
    DuplicateDismissResponse,
    DuplicateGroup,
    DuplicateGroupsResponse,
    DuplicateResolveRequest,
    DuplicateResolveResponse,
    GalleryItem,
)

router = APIRouter()


@router.get("/duplicates", response_model=DuplicateGroupsResponse)
def list_duplicates(
    folder: str = Query(..., description="Absolute path to the folder to report on"),
) -> DuplicateGroupsResponse:
    """Every duplicate group in ``folder``, each member carrying its gallery metadata."""
    folder_path = resolve_folder(folder)

    # One scan feeds both grouping and member metadata so they cannot disagree.
    scan = scan_folder(folder_path)
    if scan is None:
        raise HTTPException(status_code=404, detail="Folder not found")

    groups: list[DuplicateGroup] = []
    for group_id, members in group_duplicate_findings(scan).items():
        names = {media_path.name for media_path, _finding in members}
        items = [GalleryItem(**item) for item in media_items_named(scan, names)]
        if len(items) < 2:
            continue

        _first_path, finding = members[0]
        groups.append(
            DuplicateGroup(
                group=group_id,
                max_distance=finding.max_distance,
                threshold=finding.threshold,
                members=items,
            )
        )

    # Largest groups first: they are where deleting saves the most.
    groups.sort(key=lambda group: (-len(group.members), group.members[0].name.lower()))

    return DuplicateGroupsResponse(
        folder=str(folder_path),
        groups=groups,
        stale=[path.name for path in stale_duplicate_members(scan)],
        deletes_to_trash=deletes_to_trash(),
    )


@router.post("/duplicates/resolve", response_model=DuplicateResolveResponse)
def resolve_duplicate_group(request: DuplicateResolveRequest) -> DuplicateResolveResponse:
    """Delete the discarded members of a group and clear the keeper's sidecar."""
    keep_path = resolve_media_file(request.keep)

    if not request.discard:
        raise HTTPException(status_code=400, detail="No files were marked for deletion")

    discard_paths: list[Path] = []
    for raw in request.discard:
        path = resolve_media_file(raw)
        if path == keep_path:
            raise HTTPException(
                status_code=400,
                detail="The file to keep cannot also be marked for deletion",
            )
        discard_paths.append(path)

    deleted: list[str] = []
    failed: list[str] = []
    for path in discard_paths:
        try:
            delete_media_with_sidecars(path)
        except OSError:
            failed.append(path.name)
            continue
        deleted.append(path.name)

    # Clear only after partners are gone; otherwise two files remain with no finding.
    if not failed:
        try:
            delete_duplicate_file(keep_path)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return DuplicateResolveResponse(kept=keep_path.name, deleted=deleted, failed=failed)


@router.post("/duplicates/dismiss", response_model=DuplicateDismissResponse)
def dismiss_duplicate_group(request: DuplicateDismissRequest) -> DuplicateDismissResponse:
    """Clear a group's findings, leaving every file where it is."""
    if len(request.paths) < 2:
        raise HTTPException(status_code=400, detail="A duplicate group needs at least two members")

    paths = [resolve_media_file(raw) for raw in request.paths]

    cleared: list[str] = []
    failed: list[str] = []
    for path in paths:
        try:
            delete_duplicate_file(path)
        except OSError:
            failed.append(path.name)
            continue
        cleared.append(path.name)

    return DuplicateDismissResponse(cleared=cleared, failed=failed)
