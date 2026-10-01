from __future__ import annotations

import hashlib
import logging
import os
import subprocess
import tempfile
import threading
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from app_settings import effective_settings
from constants import MEDIA_EXTENSIONS, PILLOW_EXTENSIONS
from ffmpeg_bin import ffmpeg_path
from schemas import ThumbnailCacheCleared, ThumbnailCacheStats

logger = logging.getLogger(__name__)

DEFAULT_THUMBNAIL_WIDTH = 400
MIN_THUMBNAIL_WIDTH = 64
MAX_THUMBNAIL_WIDTH = 1200
WEBP_QUALITY = 80

#: A prune walks the whole cache tree; a gallery scrolling a new folder generates in bursts.
PRUNE_EVERY_N_THUMBNAILS = 200

_lock_guard = threading.Lock()
_generation_locks: dict[str, threading.Lock] = {}

THUMBNAIL_SUFFIX = ".webp"
# In-progress renders share the shard folder; a different suffix keeps eviction off them.
PARTIAL_SUFFIX = ".partial"

_prune_guard = threading.Lock()
_thumbnails_since_prune = 0


class ThumbnailError(Exception):
    pass


class ThumbnailUnavailableError(ThumbnailError):
    """Raised when a thumbnail cannot be produced (for example, ffmpeg missing)."""


def get_thumbnail_cache_dir() -> Path:
    override = os.environ.get("DATAFORGE_THUMBNAIL_CACHE")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "data" / "thumbnails"


def get_thumbnail_cache_budget_bytes() -> int:
    """``0`` turns pruning off."""
    return effective_settings().thumbnail_cache_max_mb * 1024 * 1024


def normalize_thumbnail_width(width: int) -> int:
    return max(MIN_THUMBNAIL_WIDTH, min(MAX_THUMBNAIL_WIDTH, width))


def thumbnail_cache_path(source: Path, width: int) -> Path:
    stat = source.stat()
    key = f"{source.resolve()}|{width}|{stat.st_mtime_ns}:{stat.st_size}"
    digest = hashlib.sha256(key.encode()).hexdigest()
    return get_thumbnail_cache_dir() / digest[:2] / f"{digest}{THUMBNAIL_SUFFIX}"


def _generation_lock(cache_key: str) -> threading.Lock:
    with _lock_guard:
        lock = _generation_locks.get(cache_key)
        if lock is None:
            lock = threading.Lock()
            _generation_locks[cache_key] = lock
        return lock


def _prepare_thumbnail_image(image: Image.Image, width: int) -> Image.Image:
    working = image
    if working.mode in {"RGBA", "LA", "P"}:
        rgba = working.convert("RGBA")
        working = Image.new("RGB", rgba.size, (24, 24, 24))
        working.paste(rgba.convert("RGB"), mask=rgba.split()[-1])
    elif working.mode != "RGB":
        working = working.convert("RGB")

    if working.width > width:
        max_height = max(1, round(working.height * width / working.width))
        working.thumbnail((width, max_height), Image.Resampling.LANCZOS)

    return working


def _save_thumbnail_webp(image: Image.Image, destination: Path, width: int) -> None:
    working = _prepare_thumbnail_image(image, width)
    working.save(destination, format="WEBP", quality=WEBP_QUALITY, method=6)


def _render_image_thumbnail(source: Path, destination: Path, width: int) -> None:
    try:
        with Image.open(source) as image:
            try:
                image.draft("RGB", (width, width))
            except Exception:
                logger.debug("Thumbnail draft mode unavailable for %s", source, exc_info=True)
            _save_thumbnail_webp(image, destination, width)
    except (OSError, UnidentifiedImageError) as exc:
        raise ThumbnailError("Failed to read image for thumbnail generation") from exc


def _video_thumbnail_commands(source: Path, destination: Path, width: int) -> list[list[str]]:
    source_arg = str(source)
    destination_arg = str(destination)
    scale_filter = f"scale='min({width},iw)':-2"

    frame_args = [
        "-frames:v",
        "1",
        "-an",
        "-vf",
        scale_filter,
        "-f",
        "image2",
        "-c:v",
        "libwebp",
        "-quality",
        str(WEBP_QUALITY),
        "-preset",
        "picture",
        "-update",
        "1",
        "-y",
        destination_arg,
    ]

    # First decoded frame, not a later seek point.
    return [
        ["-i", source_arg, *frame_args],
        ["-ss", "0", "-i", source_arg, *frame_args],
        ["-i", source_arg, "-ss", "0", *frame_args],
    ]


def _render_video_thumbnail(source: Path, destination: Path, width: int) -> None:
    ffmpeg = ffmpeg_path()
    if not ffmpeg:
        raise ThumbnailUnavailableError("Video thumbnail requires ffmpeg")

    errors: list[str] = []
    for command_args in _video_thumbnail_commands(source, destination, width):
        destination.unlink(missing_ok=True)

        command = [
            ffmpeg,
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            *command_args,
        ]

        try:
            completed = subprocess.run(
                command,
                check=False,
                capture_output=True,
                timeout=30,
            )
        except FileNotFoundError as exc:
            raise ThumbnailUnavailableError("Video thumbnail requires ffmpeg") from exc
        except subprocess.TimeoutExpired:
            errors.append("Timed out while extracting a video frame")
            continue

        if completed.returncode == 0 and destination.is_file() and destination.stat().st_size > 0:
            return

        stderr = completed.stderr.decode("utf-8", errors="replace").strip()
        errors.append(stderr or "ffmpeg failed to extract a video frame")

    detail = errors[-1] if errors else "ffmpeg failed to extract a video frame"
    raise ThumbnailUnavailableError(detail)


def _cached_thumbnails() -> list[tuple[float, int, Path]]:
    """``(last use, size, path)``, oldest first. Uses max(atime, mtime) because many mounts use ``noatime``."""
    entries: list[tuple[float, int, Path]] = []

    for path in get_thumbnail_cache_dir().rglob(f"*{THUMBNAIL_SUFFIX}"):
        try:
            stat = path.stat()
        except OSError:
            continue
        entries.append((max(stat.st_atime, stat.st_mtime), stat.st_size, path))

    entries.sort(key=lambda entry: entry[0])
    return entries


def _evict(entries: list[tuple[float, int, Path]], keep_bytes: int) -> tuple[int, int]:
    """Deletes oldest first until at most ``keep_bytes`` remain. Returns ``(files, bytes)`` freed."""
    remaining = sum(size for _, size, _ in entries)
    removed = 0
    freed = 0
    for _, size, path in entries:
        if remaining - freed <= keep_bytes:
            break
        try:
            path.unlink()
        except OSError:
            continue
        removed += 1
        freed += size
    return removed, freed


def prune_thumbnail_cache(budget_bytes: int | None = None) -> int:
    """Returns bytes reclaimed."""
    budget = get_thumbnail_cache_budget_bytes() if budget_bytes is None else budget_bytes
    if budget <= 0:
        return 0

    _, reclaimed = _evict(_cached_thumbnails(), budget)
    if reclaimed:
        logger.info(
            "Pruned %.1f MB from the thumbnail cache (budget %.0f MB)",
            reclaimed / (1024 * 1024),
            budget / (1024 * 1024),
        )
    return reclaimed


def thumbnail_cache_stats() -> ThumbnailCacheStats:
    entries = _cached_thumbnails()
    return ThumbnailCacheStats(
        directory=str(get_thumbnail_cache_dir()),
        file_count=len(entries),
        size_bytes=sum(size for _, size, _ in entries),
    )


def clear_thumbnail_cache() -> ThumbnailCacheCleared:
    removed, freed = _evict(_cached_thumbnails(), 0)
    logger.info("Cleared %d thumbnails (%.1f MB)", removed, freed / (1024 * 1024))
    return ThumbnailCacheCleared(removed_files=removed, freed_bytes=freed)


def _prune_thumbnail_cache_periodically() -> None:
    global _thumbnails_since_prune

    with _prune_guard:
        _thumbnails_since_prune += 1
        if _thumbnails_since_prune < PRUNE_EVERY_N_THUMBNAILS:
            return
        _thumbnails_since_prune = 0

    try:
        prune_thumbnail_cache()
    except OSError:
        logger.debug("Thumbnail cache prune failed", exc_info=True)


def get_or_create_thumbnail(source: Path, width: int) -> Path:
    source = source.resolve()
    normalized_width = normalize_thumbnail_width(width)
    suffix = source.suffix.lower()

    if suffix not in MEDIA_EXTENSIONS:
        raise ThumbnailError("Unsupported media type for thumbnails")

    cached = thumbnail_cache_path(source, normalized_width)
    if cached.is_file():
        return cached

    lock = _generation_lock(str(cached))
    with lock:
        if cached.is_file():
            return cached

        cached.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            dir=cached.parent,
            suffix=PARTIAL_SUFFIX,
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)

        try:
            if suffix in PILLOW_EXTENSIONS:
                # GIF via Pillow: frame zero is the poster a still thumbnail wants.
                _render_image_thumbnail(source, temp_path, normalized_width)
            else:
                _render_video_thumbnail(source, temp_path, normalized_width)
            os.replace(temp_path, cached)
        except Exception:
            temp_path.unlink(missing_ok=True)
            raise

    _prune_thumbnail_cache_periodically()
    return cached
