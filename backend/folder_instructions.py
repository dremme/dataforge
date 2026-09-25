"""Per-folder instruction files: a folder without its own uses the nearest parent's."""

from __future__ import annotations

import os
from pathlib import Path

from schemas import InstructionFileResponse


def find_instruction_file(folder: Path, filename: str) -> Path | None:
    for directory in (folder, *folder.parents):
        candidate = directory / filename
        if candidate.is_file():
            return candidate
    return None


def read_instruction_file(path: Path) -> str:
    return path.read_text(encoding="utf-8-sig")


def describe_instruction_file(folder: Path, filename: str) -> InstructionFileResponse:
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
    )


def save_instruction_file(folder: Path, filename: str, text: str) -> None:
    """Write ``folder``'s own file, never a parent's; blank text removes it."""
    path = folder / filename

    if not text.strip():
        if path.is_file():
            path.unlink()
        return

    path.write_text(text.strip() + "\n", encoding="utf-8")
