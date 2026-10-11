from fastapi import APIRouter, HTTPException, Query

from filesystem import (
    FolderExplorerError,
    create_subfolder,
    delete_empty_folder,
    get_home_folder,
    list_child_folders,
    list_folder_roots,
    open_folder_in_file_manager,
)
from folder_favorites import (
    add_folder_favorite,
    list_folder_favorites,
    remove_folder_favorite,
    reorder_folder_favorites,
)
from media_delete import deletes_to_trash
from routes._helpers import resolve_folder
from schemas import (
    FolderChildrenResponse,
    FolderCreateResponse,
    FolderDeleteResponse,
    FolderFavoritesOrderRequest,
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


@router.put("/folders/favorites", response_model=FolderFavoritesResponse)
def update_folder_favorite_order(request: FolderFavoritesOrderRequest) -> FolderFavoritesResponse:
    return FolderFavoritesResponse(favorites=reorder_folder_favorites(request.paths))


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
    return FolderCreateResponse.model_validate(created)


@router.post("/folders/delete", response_model=FolderDeleteResponse)
def delete_folder(
    path: str = Query(..., description="Absolute path to an empty folder"),
) -> FolderDeleteResponse:
    folder = resolve_folder(path)
    parent = delete_empty_folder(folder)
    # Otherwise a folder recreated under the same name would come back as a favorite.
    remove_folder_favorite(str(folder))
    return FolderDeleteResponse(
        path=str(folder),
        parent=str(parent),
        deletes_to_trash=deletes_to_trash(),
    )
