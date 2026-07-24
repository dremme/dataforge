"""Lightweight folder signatures for browse change detection."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from constants import SYSPROMPT_FILENAME
from filesystem import is_listable_dir
from media_listing import get_media_type

EntrySignature = tuple[str, str, int, int]


def _file_stat_signature(kind: str, path: Path) -> EntrySignature | None:
    try:
        stat = path.stat()
        return (kind, path.name, stat.st_mtime_ns, stat.st_size)
    except OSError:
        return None


def _folder_browse_signatures(folder: Path) -> tuple[EntrySignature, ...] | None:
    signatures: list[EntrySignature] = []

    try:
        entries = list(folder.iterdir())
    except OSError:
        return None

    for entry in sorted(entries, key=lambda path: path.name.lower()):
        try:
            if entry.is_dir():
                if not is_listable_dir(entry):
                    continue
                dir_signature = _file_stat_signature("dir", entry)
                if dir_signature is not None:
                    signatures.append(dir_signature)
                continue
            if not entry.is_file():
                continue
        except OSError:
            continue

        if entry.name == SYSPROMPT_FILENAME:
            sysprompt_signature = _file_stat_signature("sysprompt", entry)
            if sysprompt_signature is not None:
                signatures.append(sysprompt_signature)
            continue

        if get_media_type(entry) is None:
            continue

        media_signature = _file_stat_signature("media", entry)
        if media_signature is not None:
            signatures.append(media_signature)

        stem = entry.stem
        for sidecar_name in (f"{stem}.json", f"{stem}.txt", f"{stem}.issue.json"):
            sidecar = folder / sidecar_name
            if not sidecar.is_file():
                continue
            sidecar_signature = _file_stat_signature("sidecar", sidecar)
            if sidecar_signature is not None:
                signatures.append(sidecar_signature)

    return tuple(signatures)


def folder_browse_fingerprint(folder: Path) -> str | None:
    signatures = _folder_browse_signatures(folder)
    if signatures is None:
        return None

    payload = json.dumps(signatures, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
