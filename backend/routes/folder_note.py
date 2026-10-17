from fastapi import APIRouter, HTTPException, Query

from constants import NOTE_FILENAME
from folder_note import save_folder_note
from routes._helpers import resolve_folder
from schemas import FolderNoteResponse, FolderNoteUpdate

router = APIRouter()


@router.put("/folder-note", response_model=FolderNoteResponse)
def update_folder_note(
    path: str = Query(..., description="Absolute path to the folder the note belongs to"),
    body: FolderNoteUpdate = ...,
) -> FolderNoteResponse:
    folder = resolve_folder(path)
    try:
        text = save_folder_note(folder, body.text)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save {NOTE_FILENAME}") from exc
    return FolderNoteResponse(text=text)
