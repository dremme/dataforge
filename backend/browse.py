"""Browse response assembly — runs on a worker thread to avoid blocking the event loop."""

from pathlib import Path

from constants import LAST_FOLDER_KEY
from db import set_preference
from filesystem import build_breadcrumbs, get_home_folder, list_subfolders
from folder_fingerprint import folder_browse_fingerprint
from media_listing import list_media_in_folder
from schemas import BrowseResponse
from sysprompt import load_sysprompt_item


def build_browse_response(folder: Path) -> BrowseResponse:
    set_preference(LAST_FOLDER_KEY, str(folder))

    parent = folder.parent
    parent_path = None if parent == folder else str(parent.resolve())
    subfolders = list_subfolders(folder)
    items = list_media_in_folder(folder)

    return BrowseResponse(
        folder=str(folder),
        home=str(get_home_folder()),
        parent=parent_path,
        breadcrumbs=build_breadcrumbs(folder),
        subfolders=subfolders,
        items=items,
        sysprompt=load_sysprompt_item(folder),
        item_count=len(items),
        subfolder_count=len(subfolders),
        fingerprint=folder_browse_fingerprint(folder) or "",
    )
