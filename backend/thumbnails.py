from __future__ import annotations

import hashlib
import logging
import os
import shutil
import subprocess
import tempfile
import threading
from pathlib import Path

from PIL import Image, UnidentifiedImageError

from constants import IMAGE_EXTENSIONS, VIDEO_EXTENSIONS

logger = logging.getLogger(__name__)

DEFAULT_THUMBNAIL_WIDTH = 400
MIN_THUMBNAIL_WIDTH = 64
MAX_THUMBNAIL_WIDTH = 1200
WEBP_QUALITY = 80

_lock_guard = threading.Lock()
_generation_locks: dict[str, threading.Lock] = {}


class ThumbnailError(Exception):
    """Base thumbnail generation error."""


class ThumbnailUnavailableError(ThumbnailError):
    """Thumbnail cannot be produced for this media (for example, ffmpeg missing)."""


def get_thumbnail_cache_dir() -> Path:
    override = os.environ.get("DATAFORGE_THUMBNAIL_CACHE")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "data" / "thumbnails"


def normalize_thumbnail_width(width: int) -> int:
    return max(MIN_THUMBNAIL_WIDTH, min(MAX_THUMBNAIL_WIDTH, width))


def _source_cache_token(source: Path) -> str:
    stat = source.stat()
    return f"{stat.st_mtime_ns}:{stat.st_size}"


def thumbnail_cache_digest(source: Path, width: int) -> str:
    token = _source_cache_token(source)
    return hashlib.sha256(f"{source.resolve()}|{width}|{token}".encode()).hexdigest()


def thumbnail_cache_path(source: Path, width: int) -> Path:
    cache_dir = get_thumbnail_cache_dir()
    digest = thumbnail_cache_digest(source, width)
    return cache_dir / digest[:2] / f"{digest}.webp"


def legacy_thumbnail_cache_path(source: Path, width: int) -> Path:
    """Pre-sharding cache layout kept for read fallback."""
    cache_dir = get_thumbnail_cache_dir()
    digest = thumbnail_cache_digest(source, width)
    return cache_dir / f"{digest}.webp"


def resolve_cached_thumbnail(source: Path, width: int) -> Path | None:
    """Return a cached thumbnail if present.

    Checks current .webp locations first, then falls back to legacy .jpg
    files so existing thumbnail caches continue to work after the format switch.
    """
    for ext in (".webp", ".jpg"):
        sharded = thumbnail_cache_path(source, width).with_suffix(ext)
        if sharded.is_file():
            return sharded

        legacy = legacy_thumbnail_cache_path(source, width).with_suffix(ext)
        if legacy.is_file():
            return legacy

    return None


def _generation_lock(cache_key: str) -> threading.Lock:
    with _lock_guard:
        lock = _generation_locks.get(cache_key)
        if lock is None:
            lock = threading.Lock()
            _generation_locks[cache_key] = lock
        return lock


def _ensure_cache_dir() -> Path:
    cache_dir = get_thumbnail_cache_dir()
    cache_dir.mkdir(parents=True, exist_ok=True)
    return cache_dir


def _publish_temp_thumbnail(temp_path: Path, cached: Path) -> None:
    cached.parent.mkdir(parents=True, exist_ok=True)
    os.replace(temp_path, cached)


def _prepare_thumbnail_image(image: Image.Image, width: int) -> Image.Image:
    working = image
    if working.mode in {"RGBA", "LA"}:
        background = Image.new("RGB", working.size, (24, 24, 24))
        alpha = working.split()[-1]
        rgb = working.convert("RGB")
        background.paste(rgb, mask=alpha)
        working = background
    elif working.mode == "P":
        working = working.convert("RGBA")
        background = Image.new("RGB", working.size, (24, 24, 24))
        background.paste(working.convert("RGB"), mask=working.split()[-1])
        working = background
    elif working.mode != "RGB":
        working = working.convert("RGB")

    if working.width > width:
        max_height = max(1, round(working.height * width / working.width))
        working.thumbnail((width, max_height), Image.Resampling.LANCZOS)

    return working


def _save_thumbnail_webp(image: Image.Image, destination: Path, width: int) -> None:
    working = _prepare_thumbnail_image(image, width)
    destination.parent.mkdir(parents=True, exist_ok=True)
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


def _ffmpeg_path() -> str | None:
    found = shutil.which("ffmpeg")
    if found:
        return found

    try:
        import imageio_ffmpeg

        bundled = imageio_ffmpeg.get_ffmpeg_exe()
        if bundled and Path(bundled).is_file():
            return bundled
    except Exception:
        logger.debug("Bundled ffmpeg unavailable", exc_info=True)

    return None


def _video_thumbnail_commands(
    ffmpeg: str, source: Path, destination: Path, width: int
) -> list[list[str]]:
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

    # Match Explorer-style posters: first decoded frame, not a later seek point.
    return [
        ["-i", source_arg, *frame_args],
        ["-ss", "0", "-i", source_arg, *frame_args],
        ["-i", source_arg, "-ss", "0", *frame_args],
    ]


def _render_video_thumbnail(source: Path, destination: Path, width: int) -> None:
    ffmpeg = _ffmpeg_path()
    if not ffmpeg:
        raise ThumbnailUnavailableError("Video thumbnail requires ffmpeg")

    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        destination.unlink()

    errors: list[str] = []
    for command_args in _video_thumbnail_commands(ffmpeg, source, destination, width):
        if destination.exists():
            destination.unlink()

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


def get_or_create_thumbnail(source: Path, width: int) -> Path:
    source = source.resolve()
    normalized_width = normalize_thumbnail_width(width)
    suffix = source.suffix.lower()

    if suffix not in IMAGE_EXTENSIONS | VIDEO_EXTENSIONS:
        raise ThumbnailError("Unsupported media type for thumbnails")

    _ensure_cache_dir()
    cached = thumbnail_cache_path(source, normalized_width)
    existing = resolve_cached_thumbnail(source, normalized_width)
    if existing is not None:
        return existing

    lock = _generation_lock(str(cached))
    with lock:
        existing = resolve_cached_thumbnail(source, normalized_width)
        if existing is not None:
            return existing

        cached.parent.mkdir(parents=True, exist_ok=True)
        with tempfile.NamedTemporaryFile(
            dir=cached.parent,
            suffix=".webp",
            delete=False,
        ) as handle:
            temp_path = Path(handle.name)

        try:
            if suffix in IMAGE_EXTENSIONS:
                _render_image_thumbnail(source, temp_path, normalized_width)
            else:
                _render_video_thumbnail(source, temp_path, normalized_width)
            _publish_temp_thumbnail(temp_path, cached)
            temp_path = cached
        except Exception:
            if temp_path.exists() and temp_path != cached:
                temp_path.unlink(missing_ok=True)
            raise

    return cached
