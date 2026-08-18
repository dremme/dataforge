from fastapi import APIRouter, HTTPException

from constants import DUPLICATE_SIDECAR_SUFFIX, ISSUE_SIDECAR_SUFFIX
from folder_scan import scan_folder
from media_delete import delete_path, deletes_to_trash
from routes._helpers import resolve_folder
from schemas import SidecarDeleteRequest, SidecarDeleteResponse, SidecarKind

router = APIRouter()

_SUFFIX_BY_KIND: dict[SidecarKind, str] = {
    "issue": ISSUE_SIDECAR_SUFFIX,
    "duplicate": DUPLICATE_SIDECAR_SUFFIX,
}


@router.post("/sidecars/delete", response_model=SidecarDeleteResponse)
def delete_sidecars(request: SidecarDeleteRequest) -> SidecarDeleteResponse:
    """Delete every sidecar of ``kind`` in ``folder``, leaving media untouched."""
    folder_path = resolve_folder(request.folder)

    scan = scan_folder(folder_path)
    if scan is None:
        raise HTTPException(status_code=404, detail="Folder not found")

    suffix = _SUFFIX_BY_KIND[request.kind]
    # A JSON caption for media named ``sunset.issue.png`` is byte-identical to the
    # issue sidecar of ``sunset.png``. A written caption is unrecoverable work; a
    # finding is one job re-run, so the caption wins.
    claimed_captions = {media.path.with_suffix(".json").name for media in scan.media}

    deleted: list[str] = []
    failed: list[str] = []
    # Lowercased, matching how `folder_scan` orders everything else, so two names
    # differing only by case cannot swap places between runs.
    for name in sorted(scan.files, key=lambda name: (name.lower(), name)):
        # Exact case, matching `FolderScan.sidecar`: an `A.Issue.JSON` is not read
        # as a sidecar by the listing either, so it is not in the count the
        # confirmation showed - and deleting more than was advertised is the worse
        # failure.
        if not name.endswith(suffix):
            continue
        if name in claimed_captions:
            continue
        try:
            delete_path(scan.files[name].path)
        except OSError:
            failed.append(name)
            continue
        deleted.append(name)

    return SidecarDeleteResponse(
        folder=str(folder_path),
        kind=request.kind,
        deleted=deleted,
        failed=failed,
        deletes_to_trash=deletes_to_trash(),
    )
