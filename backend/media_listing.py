import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from typing import NamedTuple

from captions import (
    issue_file_path,
    load_caption_summary,
    load_issue_summary,
    media_has_caption_text,
)
from constants import IMAGE_EXTENSIONS, SYSPROMPT_FILENAME, VIDEO_EXTENSIONS


class _SummaryCacheEntry(NamedTuple):
    fingerprint: tuple
    result: dict[str, int]


_summary_cache: dict[str, _SummaryCacheEntry] = {}
_summary_cache_lock = threading.Lock()


def get_media_type(path: Path) -> str | None:
    suffix = path.suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    return None


def clear_folder_summary_cache_for_tests() -> None:
    with _summary_cache_lock:
        _summary_cache.clear()


def _file_stat_signature(path: Path) -> tuple[str, int, int] | None:
    try:
        stat = path.stat()
        return (path.name, stat.st_mtime_ns, stat.st_size)
    except OSError:
        return None


def folder_summary_fingerprint(folder: Path) -> tuple | None:
    """Lightweight directory signature used to invalidate summary caches."""
    signatures: list[tuple[str, int, int]] = []

    try:
        entries = list(folder.iterdir())
    except OSError:
        return None

    for entry in entries:
        try:
            if not entry.is_file():
                continue
        except OSError:
            continue

        if entry.name == SYSPROMPT_FILENAME:
            continue

        if get_media_type(entry) is None:
            continue

        media_signature = _file_stat_signature(entry)
        if media_signature is not None:
            signatures.append(media_signature)

        stem = entry.stem
        for sidecar_name in (f"{stem}.json", f"{stem}.txt", f"{stem}.issue.json"):
            sidecar = folder / sidecar_name
            if not sidecar.is_file():
                continue
            sidecar_signature = _file_stat_signature(sidecar)
            if sidecar_signature is not None:
                signatures.append(sidecar_signature)

    return tuple(sorted(signatures))


def _summarize_folder_contents_uncached(folder: Path) -> dict[str, int]:
    file_count = 0
    captioned_count = 0
    issue_count = 0

    try:
        entries = list(folder.iterdir())
    except OSError:
        return {
            "file_count": 0,
            "captioned_count": 0,
            "issue_count": 0,
        }

    for entry in entries:
        try:
            if not entry.is_file():
                continue
        except OSError:
            continue

        if entry.name == SYSPROMPT_FILENAME:
            continue

        media_type = get_media_type(entry)
        if media_type is None:
            continue

        file_count += 1
        if media_has_caption_text(entry):
            captioned_count += 1
        try:
            if issue_file_path(entry).is_file():
                issue_count += 1
        except OSError:
            pass

    return {
        "file_count": file_count,
        "captioned_count": captioned_count,
        "issue_count": issue_count,
    }


def summarize_folder_contents(folder: Path) -> dict[str, int]:
    folder_key = str(folder.resolve())
    fingerprint = folder_summary_fingerprint(folder)

    if fingerprint is not None:
        with _summary_cache_lock:
            cached = _summary_cache.get(folder_key)
            if cached is not None and cached.fingerprint == fingerprint:
                return dict(cached.result)

    result = _summarize_folder_contents_uncached(folder)

    if fingerprint is not None:
        with _summary_cache_lock:
            _summary_cache[folder_key] = _SummaryCacheEntry(fingerprint, dict(result))

    return result


def _read_file_stat(entry: Path) -> tuple[int, str] | None:
    try:
        file_stat = entry.stat()
        return file_stat.st_size, datetime.fromtimestamp(
            file_stat.st_mtime,
            tz=UTC,
        ).isoformat()
    except OSError:
        return None


def _build_media_item(entry: Path, media_type: str) -> dict:
    description, has_bboxes, caption_status, caption_file_type = load_caption_summary(entry)
    issue_fixes, has_issue_file = load_issue_summary(entry)

    item_data = {
        "name": entry.name,
        "path": str(entry),
        "description": description,
        "has_description": description is not None,
        "has_caption_file": caption_status != "none",
        "issue_fixes": issue_fixes,
        "has_issue_file": has_issue_file,
        "has_bboxes": has_bboxes,
        "caption_status": caption_status,
        "caption_file_type": caption_file_type,
        "media_type": media_type,
    }

    file_stat = _read_file_stat(entry)
    if file_stat:
        item_data["size"], item_data["modified_at"] = file_stat

    return item_data


def list_media_in_folder(folder: Path) -> list[dict]:
    try:
        entries: list[Path] = []
        for entry in sorted(folder.iterdir(), key=lambda path: path.name.lower()):
            try:
                if not entry.is_file():
                    continue
            except OSError:
                continue
            if entry.name == SYSPROMPT_FILENAME:
                continue
            if get_media_type(entry) is not None:
                entries.append(entry)
    except OSError:
        return []

    if not entries:
        return []

    max_workers = min(16, len(entries))

    if max_workers <= 1:
        return [_build_media_item(entry, get_media_type(entry) or "image") for entry in entries]

    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        results = pool.map(
            lambda entry: _build_media_item(entry, get_media_type(entry) or "image"),
            entries,
        )

    return list(results)
