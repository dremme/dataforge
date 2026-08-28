"""Folder signatures for change detection."""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from constants import (
    CAPTION_SIDECAR_EXTENSIONS,
    DUPLICATE_SIDECAR_SUFFIX,
    EDIT_BACKUP_SUFFIX,
    ISSUE_SIDECAR_SUFFIX,
    STAGING_DIR_NAME,
)
from folder_scan import FolderScan, candidate_name_for, folder_entries_in_order, scan_folder

EntrySignature = tuple[str, str, int, int]
ItemSignature = tuple[tuple[int, int], ...]

_SIDECAR_EXTENSIONS = CAPTION_SIDECAR_EXTENSIONS

#: Whole-filename sidecars. Every suffix must appear in the fingerprint and the item signature.
_FINDING_SIDECAR_SUFFIXES = (
    ISSUE_SIDECAR_SUFFIX,
    DUPLICATE_SIDECAR_SUFFIX,
    EDIT_BACKUP_SUFFIX,
)

MAX_REMEMBERED_SIGNATURES = 16


def entry_signatures_from_scan(scan: FolderScan) -> tuple[EntrySignature, ...]:
    signatures: list[EntrySignature] = []

    for kind, entry in folder_entries_in_order(scan):
        signatures.append((kind, entry.name, entry.mtime_ns, entry.size))

        if kind != "media":
            continue

        stem = entry.path.stem
        for extension in _SIDECAR_EXTENSIONS:
            sidecar = scan.files.get(f"{stem}{extension}")
            if sidecar is not None:
                signatures.append(("sidecar", sidecar.name, sidecar.mtime_ns, sidecar.size))

        for suffix in _FINDING_SIDECAR_SUFFIXES:
            finding = scan.files.get(f"{entry.name}{suffix}")
            if finding is not None:
                signatures.append(("sidecar", finding.name, finding.mtime_ns, finding.size))

        candidate_name = candidate_name_for(entry.name, scan.candidates, scan.files)
        candidate = scan.candidates.get(candidate_name) if candidate_name else None
        if candidate is not None:
            signatures.append(("candidate", candidate.name, candidate.mtime_ns, candidate.size))

    return tuple(signatures)


def fingerprint_from_scan(scan: FolderScan) -> str:
    payload = json.dumps(entry_signatures_from_scan(scan), separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def compute_folder_fingerprint(folder: Path) -> str | None:
    scan = scan_folder(folder)
    if scan is None:
        return None

    return fingerprint_from_scan(scan)


@dataclass(frozen=True)
class FolderSignature:
    """``items`` covers the file and its sidecars; a ``shell`` change forces a full refetch."""

    fingerprint: str
    items: dict[str, ItemSignature]
    shell: tuple[EntrySignature, ...]


#: Stands in for a missing sidecar so gaining or losing one shows up as a change.
_ABSENT_SIDECAR = (-1, -1)


def _item_signature(
    scan: FolderScan,
    name: str,
    stem: str,
    media_stat: tuple[int, int],
) -> ItemSignature:
    parts: list[tuple[int, int]] = [media_stat]

    for extension in _SIDECAR_EXTENSIONS:
        sidecar = scan.files.get(f"{stem}{extension}")
        parts.append(_ABSENT_SIDECAR if sidecar is None else (sidecar.mtime_ns, sidecar.size))

    for suffix in _FINDING_SIDECAR_SUFFIXES:
        finding = scan.files.get(f"{name}{suffix}")
        parts.append(_ABSENT_SIDECAR if finding is None else (finding.mtime_ns, finding.size))

    # A non-PNG source's candidate is staged as ``<stem>.png``, so pair it the way the listing does.
    candidate_name = candidate_name_for(name, scan.candidates, scan.files)
    candidate = scan.candidates.get(candidate_name) if candidate_name else None
    parts.append(_ABSENT_SIDECAR if candidate is None else (candidate.mtime_ns, candidate.size))

    return tuple(parts)


def folder_signature_from_scan(scan: FolderScan) -> FolderSignature:
    items = {
        entry.name: _item_signature(scan, entry.name, entry.path.stem, (entry.mtime_ns, entry.size))
        for entry in scan.media
    }

    shell: list[EntrySignature] = []
    for entry in scan.dirs:
        if entry.name == STAGING_DIR_NAME:
            # Staging files are tracked per-item; using this directory's mtime would full-reload on every write.
            shell.append(("dir", entry.name, 0, 0))
        else:
            shell.append(("dir", entry.name, entry.mtime_ns, entry.size))
    if scan.sysprompt is not None:
        sysprompt = scan.sysprompt
        shell.append(("sysprompt", sysprompt.name, sysprompt.mtime_ns, sysprompt.size))

    return FolderSignature(
        fingerprint=fingerprint_from_scan(scan),
        items=items,
        shell=tuple(shell),
    )


_remembered: OrderedDict[tuple[str, str], FolderSignature] = OrderedDict()
_remembered_lock = threading.Lock()


def remember_folder_signature(folder: Path, signature: FolderSignature) -> None:
    key = (str(folder), signature.fingerprint)

    with _remembered_lock:
        _remembered[key] = signature
        _remembered.move_to_end(key)
        while len(_remembered) > MAX_REMEMBERED_SIGNATURES:
            _remembered.popitem(last=False)


def recall_folder_signature(folder: Path, fingerprint: str) -> FolderSignature | None:
    if not fingerprint:
        return None

    key = (str(folder), fingerprint)

    with _remembered_lock:
        signature = _remembered.get(key)
        if signature is not None:
            _remembered.move_to_end(key)
        return signature


def clear_remembered_signatures_for_tests() -> None:
    with _remembered_lock:
        _remembered.clear()
