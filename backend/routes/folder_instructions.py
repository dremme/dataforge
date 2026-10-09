from pathlib import Path

from fastapi import APIRouter, HTTPException, Query

from automation.jobs import JobType, job_manager
from caption_rules import STARTER_CAPTION_RULES, save_caption_rules
from constants import CAPTION_RULES_FILENAME, JOB_TYPE_LABELS, SYSPROMPT_FILENAME
from folder_instructions import (
    describe_instruction_file,
    instruction_file_reaches,
    save_instruction_file,
)
from routes._helpers import resolve_folder
from schemas import FolderInstructionsResponse, InstructionFileResponse, InstructionFileUpdate

router = APIRouter()

FOLDER_QUERY = Query(..., description="Absolute path to the folder the instructions apply to")


#: The job that reads each file; edits wait for it so the folder matches what the run used.
READING_JOBS: dict[str, JobType] = {
    SYSPROMPT_FILENAME: "auto_caption",
    CAPTION_RULES_FILENAME: "check_caption_rules",
}


def _locking_job_id(folder: Path, filename: str) -> str | None:
    for job in job_manager.active_jobs(READING_JOBS[filename]):
        if instruction_file_reaches(folder, Path(job.folder), filename):
            return job.id
    return None


def _refuse_while_locked(folder: Path, filename: str) -> None:
    if _locking_job_id(folder, filename) is not None:
        label = JOB_TYPE_LABELS[READING_JOBS[filename]]
        raise HTTPException(
            status_code=409,
            detail=f"{label} is using this {filename}. Edit it once the job finishes.",
        )


def _describe(folder: Path, filename: str) -> InstructionFileResponse:
    try:
        return describe_instruction_file(folder, filename, _locking_job_id(folder, filename))
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
    _refuse_while_locked(folder, SYSPROMPT_FILENAME)

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
    _refuse_while_locked(folder, CAPTION_RULES_FILENAME)

    try:
        save_caption_rules(folder, body.text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except OSError as exc:
        raise HTTPException(
            status_code=500, detail=f"Failed to save {CAPTION_RULES_FILENAME}"
        ) from exc

    return _describe(folder, CAPTION_RULES_FILENAME)
