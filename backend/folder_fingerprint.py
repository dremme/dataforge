"""Lightweight folder signatures for browse change detection."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from constants import CAPTION_SIDECAR_EXTENSIONS, ISSUE_SIDECAR_SUFFIX
from folder_scan import FolderScan, browse_entries_in_order, scan_folder

EntrySignature = tuple[str, str, int, int]

_SIDECAR_EXTENSIONS = (*CAPTION_SIDECAR_EXTENSIONS, ISSUE_SIDECAR_SUFFIX)


def browse_signatures_from_scan(scan: FolderScan) -> tuple[EntrySignature, ...]:
    signatures: list[EntrySignature] = []

    for kind, entry in browse_entries_in_order(scan):
        signatures.append((kind, entry.name, entry.mtime_ns, entry.size))

        if kind != "media":
            continue

        stem = entry.path.stem
        for extension in _SIDECAR_EXTENSIONS:
            sidecar = scan.files.get(f"{stem}{extension}")
            if sidecar is not None:
                signatures.append(("sidecar", sidecar.name, sidecar.mtime_ns, sidecar.size))

    return tuple(signatures)


def browse_fingerprint_from_scan(scan: FolderScan) -> str:
    payload = json.dumps(browse_signatures_from_scan(scan), separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def folder_browse_fingerprint(folder: Path) -> str | None:
    scan = scan_folder(folder)
    if scan is None:
        return None

    return browse_fingerprint_from_scan(scan)
