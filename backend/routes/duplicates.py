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
    """Every duplicate group in ``folder``, each member carrying its gallery metadata.

    The metadata rides along because the resolver compares files on it - resolution,
    size, caption, modified date - and asking for the folder listing separately would
    make the resolver's first paint wait on a second request.
    """
    folder_path = resolve_folder(folder)

    # One scan feeds both the grouping and the member metadata, so the two cannot
    # disagree about what is in the folder.
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

    # Largest groups first: they are where deleting saves the most, and a pair is the
    # quickest decision to leave for last.
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

    # Only once the partners are actually gone. Clearing first and then failing a delete
    # would leave two files behind with no finding to bring the user back to them.
    if not failed:
        try:
            delete_duplicate_file(keep_path)
        except OSError as exc:
            raise HTTPException(status_code=500, detail=str(exc)) from exc

    return DuplicateResolveResponse(kept=keep_path.name, deleted=deleted, failed=failed)
