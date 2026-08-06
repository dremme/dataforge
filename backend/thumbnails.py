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

from constants import MEDIA_EXTENSIONS, PILLOW_EXTENSIONS

logger = logging.getLogger(__name__)

DEFAULT_THUMBNAIL_WIDTH = 400
MIN_THUMBNAIL_WIDTH = 64
MAX_THUMBNAIL_WIDTH = 1200
WEBP_QUALITY = 80

#: A cache entry is keyed by the source's path, size, and mtime, so anything that
#: rewrites media — ``batch_rename``, ``strip_metadata``, or an edit outside the app —
#: orphans every thumbnail it had. Nothing else ever deletes them, so the cache is
#: trimmed back to this budget instead of growing for the life of the install.
DEFAULT_CACHE_BUDGET_MB = 2048

#: Checked this often rather than on every write: a prune walks the whole cache tree,
#: and a gallery scrolling through a new folder generates thumbnails in bursts.
PRUNE_EVERY_N_THUMBNAILS = 200

_lock_guard = threading.Lock()
_generation_locks: dict[str, threading.Lock] = {}

_prune_guard = threading.Lock()
_thumbnails_since_prune = 0


class ThumbnailError(Exception):
    """Base thumbnail generation error."""


class ThumbnailUnavailableError(ThumbnailError):
    """Thumbnail cannot be produced for this media (for example, ffmpeg missing)."""


def get_thumbnail_cache_dir() -> Path:
    override = os.environ.get("DATAFORGE_THUMBNAIL_CACHE")
    if override:
        return Path(override)
    return Path(__file__).resolve().parent / "data" / "thumbnails"


def get_thumbnail_cache_budget_bytes() -> int:
    """The cache's size ceiling. ``0`` or less turns pruning off."""
    raw = os.environ.get("DATAFORGE_THUMBNAIL_CACHE_MAX_MB", "").strip()
    if not raw:
        return DEFAULT_CACHE_BUDGET_MB * 1024 * 1024

    try:
        megabytes = int(raw)
    except ValueError:
        logger.warning("Ignoring DATAFORGE_THUMBNAIL_CACHE_MAX_MB=%r: not a number", raw)
        return DEFAULT_CACHE_BUDGET_MB * 1024 * 1024

    return max(0, megabytes) * 1024 * 1024


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


def _cached_thumbnails() -> list[tuple[float, int, Path]]:
    """Every cache entry as ``(last use, size, path)``, oldest use first.

    Access time is what "least recently used" means here, but plenty of systems mount
    with ``relatime`` or ``noatime``, where it barely moves. Modification time is the
    honest fallback: for a file this cache only ever writes once, it is the time the
    thumbnail was generated, so the worst case degrades to least-recently-generated.
    """
    entries: list[tuple[float, int, Path]] = []

    for path in get_thumbnail_cache_dir().rglob("*"):
        try:
            if not path.is_file():
                continue
            stat = path.stat()
        except OSError:
            continue
        entries.append((max(stat.st_atime, stat.st_mtime), stat.st_size, path))

    entries.sort(key=lambda entry: entry[0])
    return entries


def prune_thumbnail_cache(budget_bytes: int | None = None) -> int:
    """Delete least-recently-used thumbnails until the cache fits its budget.

    Returns the number of bytes reclaimed. Safe to call at any time: a thumbnail that
    is deleted while still wanted is simply generated again.
    """
    budget = get_thumbnail_cache_budget_bytes() if budget_bytes is None else budget_bytes
    if budget <= 0:
        return 0

    entries = _cached_thumbnails()
    total = sum(size for _, size, _ in entries)
    if total <= budget:
        return 0

    reclaimed = 0
    for _, size, path in entries:
        if total - reclaimed <= budget:
            break
        try:
            path.unlink()
        except OSError:
            continue
        reclaimed += size

    logger.info(
        "Pruned %.1f MB from the thumbnail cache (budget %.0f MB)",
        reclaimed / (1024 * 1024),
        budget / (1024 * 1024),
    )
    return reclaimed


def _prune_thumbnail_cache_periodically() -> None:
    """Prune every ``PRUNE_EVERY_N_THUMBNAILS`` generations, never on the hot path twice."""
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
            if suffix in PILLOW_EXTENSIONS:
                # A GIF lands here rather than in ffmpeg: Pillow opens it on frame
                # zero, which is the poster frame a still thumbnail wants anyway.
                _render_image_thumbnail(source, temp_path, normalized_width)
            else:
                _render_video_thumbnail(source, temp_path, normalized_width)
            _publish_temp_thumbnail(temp_path, cached)
            temp_path = cached
        except Exception:
            if temp_path.exists() and temp_path != cached:
                temp_path.unlink(missing_ok=True)
            raise

    _prune_thumbnail_cache_periodically()
    return cached
