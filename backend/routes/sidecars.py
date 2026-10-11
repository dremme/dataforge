from fastapi import APIRouter

from api_errors import folder_not_found
from captions import is_blank_caption_file, resolve_caption_file_name
from constants import DUPLICATE_SIDECAR_SUFFIX, ISSUE_SIDECAR_SUFFIX
from folder_scan import FolderScan, scan_folder
from media_delete import delete_path, deletes_to_trash
from routes._helpers import resolve_folder
from schemas import SidecarDeleteRequest, SidecarDeleteResponse, SidecarKind

router = APIRouter()

_SUFFIX_BY_KIND: dict[SidecarKind, str] = {
    "issue": ISSUE_SIDECAR_SUFFIX,
    "duplicate": DUPLICATE_SIDECAR_SUFFIX,
}


def _blank_caption_names(scan: FolderScan) -> set[str]:
    """Only captions the gallery pairs with media; ``clip.png`` and ``clip.mp4`` share one."""
    names: set[str] = set()
    for media in scan.media:
        name = resolve_caption_file_name(media.path.stem, lambda candidate: candidate in scan.files)
        if name is not None and is_blank_caption_file(scan.files[name].path):
            names.add(name)
    return names


def _sweep_names(scan: FolderScan, kind: SidecarKind) -> list[str]:
    if kind == "empty_caption":
        names = _blank_caption_names(scan)
    else:
        # Exact case, matching `FolderScan.sidecar`; do not delete more than the confirmation showed.
        names = {name for name in scan.files if name.endswith(_SUFFIX_BY_KIND[kind])}
    # Lowercased, matching how `folder_scan` orders everything else.
    return sorted(names, key=lambda name: (name.lower(), name))


@router.post("/sidecars/delete", response_model=SidecarDeleteResponse)
def delete_sidecars(request: SidecarDeleteRequest) -> SidecarDeleteResponse:
    """Delete every sidecar of ``kind`` in ``folder``, leaving media untouched."""
    folder_path = resolve_folder(request.folder)

    scan = scan_folder(folder_path)
    if scan is None:
        raise folder_not_found()

    deleted: list[str] = []
    failed: list[str] = []
    for name in _sweep_names(scan, request.kind):
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
