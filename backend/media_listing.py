import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import NamedTuple

from captions import (
    caption_summary_from_sidecar,
    issue_summary_from_sidecar,
    resolve_caption_file_name,
)
from constants import CAPTION_SIDECAR_EXTENSIONS, ISSUE_SIDECAR_SUFFIX
from folder_scan import FolderScan, ScannedEntry, get_media_type, scan_folder

__all__ = [
    "clear_folder_summary_cache_for_tests",
    "folder_summary_fingerprint",
    "get_media_type",
    "list_media_from_scan",
    "list_media_in_folder",
    "media_items_named",
    "summarize_folder_contents",
]

_EMPTY_SUMMARY = {"file_count": 0, "captioned_count": 0, "issue_count": 0}


class _SummaryCacheEntry(NamedTuple):
    fingerprint: tuple
    result: dict[str, int]


_summary_cache: dict[str, _SummaryCacheEntry] = {}
_summary_cache_lock = threading.Lock()


def clear_folder_summary_cache_for_tests() -> None:
    with _summary_cache_lock:
        _summary_cache.clear()


# ---------------------------------------------------------------------------
# Sidecar lookup against an already-enumerated directory
# ---------------------------------------------------------------------------


def _caption_sidecar(scan: FolderScan, media: ScannedEntry) -> tuple[ScannedEntry, str] | None:
    """Winning caption sidecar for ``media``, resolved from the scan (no syscalls)."""
    name, caption_file_type = resolve_caption_file_name(
        media.path.stem,
        lambda candidate: candidate in scan.files,
    )
    if name is None or caption_file_type is None:
        return None

    sidecar = scan.files.get(name)
    return None if sidecar is None else (sidecar, caption_file_type)


def _issue_sidecar(scan: FolderScan, media: ScannedEntry) -> ScannedEntry | None:
    return scan.files.get(f"{media.path.stem}{ISSUE_SIDECAR_SUFFIX}")


# ---------------------------------------------------------------------------
# Per-folder counts (the subfolder cards)
# ---------------------------------------------------------------------------


def _summary_signature(scan: FolderScan) -> tuple:
    """Directory signature used to invalidate the summary cache.

    Media files and their sidecars only - unlike the browse fingerprint, a child
    directory appearing under this folder does not change its own counts.
    """
    signatures: list[tuple[str, int, int]] = []

    for media in scan.media:
        signatures.append((media.name, media.mtime_ns, media.size))

        stem = media.path.stem
        for extension in (*CAPTION_SIDECAR_EXTENSIONS, ISSUE_SIDECAR_SUFFIX):
            sidecar = scan.files.get(f"{stem}{extension}")
            if sidecar is not None:
                signatures.append((sidecar.name, sidecar.mtime_ns, sidecar.size))

    return tuple(sorted(signatures))


def folder_summary_fingerprint(folder: Path) -> tuple | None:
    """Lightweight directory signature used to invalidate summary caches."""
    scan = scan_folder(folder)
    return None if scan is None else _summary_signature(scan)


def _summarize_scan_uncached(scan: FolderScan) -> dict[str, int]:
    captioned_count = 0
    issue_count = 0

    for media in scan.media:
        caption = _caption_sidecar(scan, media)
        if caption is not None:
            sidecar, caption_file_type = caption
            description, caption_status, _ = caption_summary_from_sidecar(
                sidecar.path,
                caption_file_type,
                sidecar.mtime_ns,
                sidecar.size,
            )
            if description is not None and caption_status == "text":
                captioned_count += 1

        if _issue_sidecar(scan, media) is not None:
            issue_count += 1

    return {
        "file_count": len(scan.media),
        "captioned_count": captioned_count,
        "issue_count": issue_count,
    }


def _summarize_folder_contents_uncached(folder: Path) -> dict[str, int]:
    scan = scan_folder(folder)
    if scan is None:
        return dict(_EMPTY_SUMMARY)
    return _summarize_scan_uncached(scan)


def summarize_folder_contents(folder: Path) -> dict[str, int]:
    scan = scan_folder(folder)
    if scan is None:
        return dict(_EMPTY_SUMMARY)

    folder_key = str(folder.resolve())
    fingerprint = _summary_signature(scan)

    with _summary_cache_lock:
        cached = _summary_cache.get(folder_key)
        if cached is not None and cached.fingerprint == fingerprint:
            return dict(cached.result)

    # Routed through the module-level name so tests can patch the uncached path.
    result = _summarize_folder_contents_uncached(folder)

    with _summary_cache_lock:
        _summary_cache[folder_key] = _SummaryCacheEntry(fingerprint, dict(result))

    return result


# ---------------------------------------------------------------------------
# Media items (the gallery grid)
# ---------------------------------------------------------------------------


def _build_media_item(scan: FolderScan, media: ScannedEntry, media_type: str) -> dict:
    description: str | None = None
    caption_status = "none"
    caption_file_type: str | None = None

    caption = _caption_sidecar(scan, media)
    if caption is not None:
        sidecar, caption_file_type = caption
        description, caption_status, caption_file_type = caption_summary_from_sidecar(
            sidecar.path,
            caption_file_type,
            sidecar.mtime_ns,
            sidecar.size,
        )

    issue_sidecar = _issue_sidecar(scan, media)
    if issue_sidecar is None:
        issue_fixes: list[str] = []
        has_issue_file = False
    else:
        issue_fixes, has_issue_file = issue_summary_from_sidecar(
            issue_sidecar.path,
            issue_sidecar.mtime_ns,
            issue_sidecar.size,
        )

    return {
        "name": media.name,
        "path": str(media.path),
        "description": description,
        "has_description": description is not None,
        "has_caption_file": caption_status != "none",
        "issue_fixes": issue_fixes,
        "has_issue_file": has_issue_file,
        "caption_status": caption_status,
        "caption_file_type": caption_file_type,
        "media_type": media_type,
        "size": media.size,
        "modified_at": datetime.fromtimestamp(media.mtime, tz=UTC).isoformat(),
    }


def list_media_from_scan(scan: FolderScan) -> list[dict]:
    if not scan.media:
        return []

    max_workers = min(16, len(scan.media))

    def build(media: ScannedEntry) -> dict:
        return _build_media_item(scan, media, get_media_type(media.path) or "image")

    if max_workers <= 1:
        return [build(media) for media in scan.media]

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        return list(pool.map(build, scan.media))


def media_items_named(scan: FolderScan, names: set[str]) -> list[dict]:
    """Just the named media entries, resolved exactly as a full listing would.

    Used by the browse delta so a changed item is built by the same code that built it
    the first time, rather than by a second, drifting implementation.
    """
    return [
        _build_media_item(scan, media, get_media_type(media.path) or "image")
        for media in scan.media
        if media.name in names
    ]


def list_media_in_folder(folder: Path) -> list[dict]:
    scan = scan_folder(folder)
    if scan is None:
        return []
    return list_media_from_scan(scan)
