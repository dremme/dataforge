"""Lightweight folder signatures for browse change detection.

Change detection asks "did anything move?" every few seconds. A fingerprint answers
that in one hash, but answering it with *yes* used to mean refetching the whole folder
— every item, with its full caption text — because that was the only shape the API
could produce. :class:`BrowseSignature` keeps the per-entry detail behind the
fingerprint so the same question can be answered with *what* moved instead.
"""

from __future__ import annotations

import hashlib
import json
import threading
from collections import OrderedDict
from dataclasses import dataclass
from pathlib import Path

from constants import CAPTION_SIDECAR_EXTENSIONS, ISSUE_SIDECAR_SUFFIX
from folder_scan import FolderScan, browse_entries_in_order, scan_folder

EntrySignature = tuple[str, str, int, int]
ItemSignature = tuple[tuple[int, int], ...]

_SIDECAR_EXTENSIONS = (*CAPTION_SIDECAR_EXTENSIONS, ISSUE_SIDECAR_SUFFIX)

#: Two generations for each of a handful of folders: enough to answer the next poll
#: for the folder in view and the one just navigated away from, without holding an
#: item map for every folder ever visited.
MAX_REMEMBERED_SIGNATURES = 16


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


@dataclass(frozen=True)
class BrowseSignature:
    """One browse of one folder, broken down finely enough to diff.

    ``items`` maps a media file's name to a signature covering the file *and* its
    sidecars, because a caption rewrite changes the item the client shows without
    touching the media file at all.

    ``shell`` covers the parts of a browse response that are not items — the child
    directories and the sysprompt. A change there is rare and drags in data the delta
    does not carry, so it sends the client back for a full response instead.
    """

    fingerprint: str
    items: dict[str, ItemSignature]
    shell: tuple[EntrySignature, ...]


#: Stands in for a sidecar that is not there, so gaining or losing one shows up as a
#: change rather than as a shorter tuple that happens to compare equal.
_ABSENT_SIDECAR = (-1, -1)


def _item_signature(scan: FolderScan, stem: str, media_stat: tuple[int, int]) -> ItemSignature:
    parts: list[tuple[int, int]] = [media_stat]

    for extension in _SIDECAR_EXTENSIONS:
        sidecar = scan.files.get(f"{stem}{extension}")
        parts.append(_ABSENT_SIDECAR if sidecar is None else (sidecar.mtime_ns, sidecar.size))

    return tuple(parts)


def browse_signature_from_scan(scan: FolderScan) -> BrowseSignature:
    items = {
        entry.name: _item_signature(scan, entry.path.stem, (entry.mtime_ns, entry.size))
        for entry in scan.media
    }

    shell: list[EntrySignature] = [
        ("dir", entry.name, entry.mtime_ns, entry.size) for entry in scan.dirs
    ]
    if scan.sysprompt is not None:
        sysprompt = scan.sysprompt
        shell.append(("sysprompt", sysprompt.name, sysprompt.mtime_ns, sysprompt.size))

    return BrowseSignature(
        fingerprint=browse_fingerprint_from_scan(scan),
        items=items,
        shell=tuple(shell),
    )


_remembered: OrderedDict[tuple[str, str], BrowseSignature] = OrderedDict()
_remembered_lock = threading.Lock()


def remember_browse_signature(folder: Path, signature: BrowseSignature) -> None:
    """Keep ``signature`` so a later poll can be answered as a delta against it."""
    key = (str(folder), signature.fingerprint)

    with _remembered_lock:
        _remembered[key] = signature
        _remembered.move_to_end(key)
        while len(_remembered) > MAX_REMEMBERED_SIGNATURES:
            _remembered.popitem(last=False)


def recall_browse_signature(folder: Path, fingerprint: str) -> BrowseSignature | None:
    """The remembered signature for this folder at ``fingerprint``, if still held."""
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
