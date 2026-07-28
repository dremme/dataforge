from fastapi import APIRouter, HTTPException, Query

from filesystem import (
    FolderExplorerError,
    create_subfolder,
    get_home_folder,
    list_child_folders,
    list_folder_roots,
    open_folder_in_file_manager,
)
from folder_favorites import add_folder_favorite, list_folder_favorites, remove_folder_favorite
from routes._helpers import resolve_folder
from schemas import (
    FolderChildrenResponse,
    FolderCreateResponse,
    FolderFavoritesResponse,
    FolderOpenResponse,
    FolderRootsResponse,
)

router = APIRouter()


@router.get("/folders/roots", response_model=FolderRootsResponse)
def folder_roots() -> FolderRootsResponse:
    home = get_home_folder()
    return FolderRootsResponse(home=str(home), roots=list_folder_roots())


@router.get("/folders/children", response_model=FolderChildrenResponse)
def folder_children(
    path: str = Query(..., description="Absolute path to parent folder"),
) -> FolderChildrenResponse:
    """List immediate child folders only (no media items, stats, or last-folder side effects)."""
    folder = resolve_folder(path)
    return FolderChildrenResponse(folder=str(folder), children=list_child_folders(folder))


@router.get("/folders/favorites", response_model=FolderFavoritesResponse)
def read_folder_favorites() -> FolderFavoritesResponse:
    return FolderFavoritesResponse(favorites=list_folder_favorites())


@router.post("/folders/favorites", response_model=FolderFavoritesResponse)
def create_folder_favorite(
    path: str = Query(..., description="Absolute path to folder"),
) -> FolderFavoritesResponse:
    favorites = add_folder_favorite(path)
    return FolderFavoritesResponse(favorites=favorites)


@router.delete("/folders/favorites", response_model=FolderFavoritesResponse)
def delete_folder_favorite(
    path: str = Query(..., description="Absolute path to folder"),
) -> FolderFavoritesResponse:
    favorites = remove_folder_favorite(path)
    return FolderFavoritesResponse(favorites=favorites)


@router.post("/folders/open", response_model=FolderOpenResponse)
def open_folder_in_explorer(
    path: str = Query(..., description="Absolute path to folder"),
) -> FolderOpenResponse:
    folder = resolve_folder(path)

    try:
        open_folder_in_file_manager(folder)
    except FolderExplorerError as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return FolderOpenResponse(path=str(folder))


@router.post("/folders/create", response_model=FolderCreateResponse)
def create_folder(
    path: str = Query(..., description="Absolute path to parent folder"),
    name: str = Query(..., description="Name for the new subfolder"),
) -> FolderCreateResponse:
    parent = resolve_folder(path)
    created = create_subfolder(parent, name)
    return FolderCreateResponse(**created)
