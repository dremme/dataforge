from fastapi import APIRouter, HTTPException, Query

from caption_rules import STARTER_CAPTION_RULES, save_caption_rules
from constants import CAPTION_RULES_FILENAME, SYSPROMPT_FILENAME
from folder_instructions import describe_instruction_file, save_instruction_file
from routes._helpers import resolve_folder
from schemas import FolderInstructionsResponse, InstructionFileResponse, InstructionFileUpdate

router = APIRouter()

FOLDER_QUERY = Query(..., description="Absolute path to the folder the instructions apply to")


def _describe(folder, filename: str) -> InstructionFileResponse:
    try:
        return describe_instruction_file(folder, filename)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to read {filename}") from exc


@router.get("/folder-instructions", response_model=FolderInstructionsResponse)
def read_folder_instructions(path: str = FOLDER_QUERY) -> FolderInstructionsResponse:
    folder = resolve_folder(path)
    return FolderInstructionsResponse(
        sysprompt=_describe(folder, SYSPROMPT_FILENAME),
        caption_rules=_describe(folder, CAPTION_RULES_FILENAME),
        caption_rules_template=STARTER_CAPTION_RULES,
    )


@router.put("/sysprompt", response_model=InstructionFileResponse)
def update_sysprompt(
    path: str = FOLDER_QUERY,
    body: InstructionFileUpdate = ...,
) -> InstructionFileResponse:
    folder = resolve_folder(path)

    try:
        save_instruction_file(folder, SYSPROMPT_FILENAME, body.text)
    except OSError as exc:
        raise HTTPException(status_code=500, detail=f"Failed to save {SYSPROMPT_FILENAME}") from exc

    return _describe(folder, SYSPROMPT_FILENAME)


@router.put("/caption-rules", response_model=InstructionFileResponse)
def update_caption_rules(
    path: str = FOLDER_QUERY,
    body: InstructionFileUpdate = ...,
) -> InstructionFileResponse:
    folder = resolve_folder(path)

    try:
        save_caption_rules(folder, body.text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to save {CAPTION_RULES_FILENAME}"
        ) from exc

    return _describe(folder, CAPTION_RULES_FILENAME)
