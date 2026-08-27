from __future__ import annotations

import re
import shutil
from pathlib import Path
from typing import BinaryIO

from constants import IMPORT_EXTENSIONS, SYSPROMPT_FILENAME

_INVALID_FILENAME_RE = re.compile(r'[<>:"/\\|?*\x00-\x1f]')


def sanitize_filename(name: str) -> str | None:
    cleaned = Path(name).name.strip()
    if not cleaned or cleaned in {".", ".."}:
        return None
    if _INVALID_FILENAME_RE.search(cleaned):
        return None
    return cleaned


def is_importable_filename(name: str) -> bool:
    if name == SYSPROMPT_FILENAME:
        return True
    suffix = Path(name).suffix.lower()
    return suffix in IMPORT_EXTENSIONS


def classify_import_filenames(filenames: list[str]) -> tuple[list[str], list[str]]:
    importable: list[str] = []
    rejected: list[str] = []

    for raw_name in filenames:
        name = sanitize_filename(raw_name)
        if name is None or not is_importable_filename(name):
            rejected.append(raw_name)
            continue
        importable.append(name)

    return importable, rejected


def preview_import(folder: Path, filenames: list[str]) -> dict[str, list[str]]:
    importable, rejected = classify_import_filenames(filenames)
    existing = _existing_file_names(folder)

    conflicts = [name for name in importable if name in existing]
    new_files = [name for name in importable if name not in existing]

    return {
        "importable": importable,
        "new_files": new_files,
        "conflicts": conflicts,
        "rejected": rejected,
    }


def import_uploaded_files(
    folder: Path,
    uploads: list[tuple[str, BinaryIO]],
    *,
    overwrite: bool = False,
) -> dict[str, list[str]]:
    importable_names, rejected = classify_import_filenames([name for name, _ in uploads])
    allowed = set(importable_names)

    copied: list[str] = []
    skipped: list[str] = []

    for raw_name, stream in uploads:
        name = sanitize_filename(raw_name)
        if name is None or name not in allowed:
            continue

        destination = folder / name
        if destination.exists() and not overwrite:
            skipped.append(name)
            continue

        if destination.exists():
            destination.unlink()

        with destination.open("wb") as handle:
            shutil.copyfileobj(stream, handle)

        copied.append(name)

    return {
        "copied": copied,
        "skipped": skipped,
        "rejected": rejected,
    }


def _existing_file_names(folder: Path) -> set[str]:
    names: set[str] = set()
    try:
        # Materialized inside the guard: on 3.12 `iterdir` is a generator, so listing fails once iterated.
        entries = list(folder.iterdir())
    except OSError:
        return names

    for entry in entries:
        try:
            if entry.is_file():
                names.add(entry.name)
        except OSError:
            continue

    return names
