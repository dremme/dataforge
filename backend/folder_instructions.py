"""Per-folder instruction files: a folder without its own uses the nearest parent's."""

from __future__ import annotations

import os
from pathlib import Path

from file_write import write_text_atomic
from schemas import InstructionFileResponse


def find_instruction_file(folder: Path, filename: str) -> Path | None:
    for directory in (folder, *folder.parents):
        candidate = directory / filename
        if candidate.is_file():
            return candidate
    return None


def instruction_file_reaches(folder: Path, job_folder: Path, filename: str) -> bool:
    """Whether writing ``folder``'s own file changes which one ``job_folder`` resolves to."""
    for directory in (job_folder, *job_folder.parents):
        if directory == folder:
            return True
        if (directory / filename).is_file():
            return False
    return False


def read_instruction_file(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def describe_instruction_file(
    folder: Path, filename: str, locked_by_job_id: str | None
) -> InstructionFileResponse:
    """Raises ``OSError`` when a file exists but cannot be read."""
    own = folder / filename
    has_file = own.is_file()
    parent = None if folder.parent == folder else find_instruction_file(folder.parent, filename)

    return InstructionFileResponse(
        text=read_instruction_file(own) if has_file else "",
        has_file=has_file,
        parent_folder=None if parent is None else str(parent.parent),
        parent_relative_path=None if parent is None else os.path.relpath(parent, folder),
        parent_text="" if parent is None else read_instruction_file(parent),
        locked_by_job_id=locked_by_job_id,
    )


def save_instruction_file(folder: Path, filename: str, text: str) -> None:
    path = folder / filename

    if not text.strip():
        if path.is_file():
            path.unlink()
        return

    write_text_atomic(path, text.strip() + "\n")
