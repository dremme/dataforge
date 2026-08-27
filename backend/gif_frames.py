"""GIF frames are deltas, so decoding frame N is O(N) and a scrub is O(N^2); Pillow also holds the file open, which locks it on Windows."""

from __future__ import annotations

import io
import logging
import threading
from collections import OrderedDict
from pathlib import Path

from PIL import Image, ImageSequence, UnidentifiedImageError

logger = logging.getLogger(__name__)

#: Matches the frontend canvas JPEG quality of 0.95 so GIF and MP4 frame saves match.
GIF_FRAME_JPEG_QUALITY = 95

#: Cap across every GIF; one 300-frame 960x720 strip is roughly 30 MB.
GIF_FRAME_CACHE_BUDGET_BYTES = 128 * 1024 * 1024

_MAX_FRAME_COUNT_CACHE = 512
_frame_count_cache: dict[str, tuple[tuple[int, int], int | None]] = {}
_frame_count_cache_lock = threading.Lock()

_frame_strips: OrderedDict[str, tuple[tuple[int, int], list[bytes]]] = OrderedDict()
_frame_strips_bytes = 0
#: GIFs whose strip does not fit the budget, so they are not re-decoded in full every request.
_uncacheable_strips: set[tuple[str, tuple[int, int]]] = set()
_frame_strips_lock = threading.Lock()
#: One decode at a time per GIF so a scrub burst does not start N full decodes.
_decode_locks: dict[str, threading.Lock] = {}
_decode_locks_lock = threading.Lock()


class GifFrameError(Exception):
    """The GIF could not be read at all."""


class GifFrameUnavailableError(GifFrameError):
    """The GIF is readable but has no such frame."""


def _count_frames(path: Path) -> int | None:
    try:
        with Image.open(path) as image:
            # Pillow opens PNG/JPEG too; reject on decoded format so a mislabelled file is caught.
            if image.format != "GIF":
                return None

            frames = getattr(image, "n_frames", 1)
    except (OSError, UnidentifiedImageError) as exc:
        logger.debug("GIF frame count failed for %s", path, exc_info=exc)
        return None

    return frames or None


def _cache_token(path: Path) -> tuple[int, int] | None:
    try:
        stat = path.stat()
        return stat.st_mtime_ns, stat.st_size
    except OSError:
        return None


def gif_frame_count(path: Path) -> int | None:
    """How many frames the GIF holds, or ``None`` if it cannot be read."""
    resolved = str(path.resolve())
    token = _cache_token(path)
    if token is not None:
        with _frame_count_cache_lock:
            cached = _frame_count_cache.get(resolved)
            if cached is not None and cached[0] == token:
                return cached[1]

    frames = _count_frames(path)

    if token is not None:
        with _frame_count_cache_lock:
            if len(_frame_count_cache) >= _MAX_FRAME_COUNT_CACHE:
                _frame_count_cache.clear()
            _frame_count_cache[resolved] = (token, frames)

    return frames


def get_gif_frame_cache_bytes_for_tests() -> int:
    with _frame_strips_lock:
        return _frame_strips_bytes


def clear_gif_caches_for_tests() -> None:
    global _frame_strips_bytes

    with _frame_count_cache_lock:
        _frame_count_cache.clear()
    with _frame_strips_lock:
        _frame_strips.clear()
        _uncacheable_strips.clear()
        _frame_strips_bytes = 0
    with _decode_locks_lock:
        _decode_locks.clear()


def _flatten(frame: Image.Image) -> Image.Image:
    """Opaque RGB, compositing transparency over black; JPEG has no alpha."""
    converted = frame.convert("RGBA")
    background = Image.new("RGB", converted.size, (0, 0, 0))
    background.paste(converted, mask=converted.split()[-1])
    return background


def _encode_jpeg(frame: Image.Image) -> bytes:
    buffer = io.BytesIO()
    frame.save(buffer, format="JPEG", quality=GIF_FRAME_JPEG_QUALITY)
    return buffer.getvalue()


def _read_gif_bytes(path: Path) -> bytes:
    """Slurp the file so no decode holds the path; a background warm would lock it on Windows."""
    try:
        return path.read_bytes()
    except OSError as exc:
        raise GifFrameError("Failed to read GIF") from exc


def _open_gif(data: bytes) -> Image.Image:
    try:
        image = Image.open(io.BytesIO(data))
    except (OSError, UnidentifiedImageError) as exc:
        raise GifFrameError("Failed to read GIF") from exc

    if image.format != "GIF":
        image.close()
        raise GifFrameError("Not a GIF")

    return image


def _walk_to_frame(path: Path, index: int) -> bytes:
    """One frame, replaying the animation up to it. O(index), so a last resort."""
    data = _read_gif_bytes(path)

    try:
        with _open_gif(data) as image:
            for position, frame in enumerate(ImageSequence.Iterator(image)):
                if position == index:
                    return _encode_jpeg(_flatten(frame))
    except (OSError, UnidentifiedImageError) as exc:
        raise GifFrameError("Failed to read GIF") from exc

    raise GifFrameUnavailableError("Frame index is out of range")


def _decode_strip(path: Path) -> list[bytes] | None:
    """Every frame as JPEG bytes, or ``None`` if the strip outgrows the budget."""
    data = _read_gif_bytes(path)
    total = 0
    strip: list[bytes] = []

    try:
        with _open_gif(data) as image:
            for frame in ImageSequence.Iterator(image):
                encoded = _encode_jpeg(_flatten(frame))
                total += len(encoded)
                if total > GIF_FRAME_CACHE_BUDGET_BYTES:
                    return None
                strip.append(encoded)
    except (OSError, UnidentifiedImageError) as exc:
        raise GifFrameError("Failed to read GIF") from exc

    return strip


def _strip_from_cache(key: str, token: tuple[int, int] | None) -> list[bytes] | None:
    if token is None:
        return None
    with _frame_strips_lock:
        cached = _frame_strips.get(key)
        if cached is None or cached[0] != token:
            return None
        _frame_strips.move_to_end(key)
        return cached[1]


def _store_strip(key: str, token: tuple[int, int], strip: list[bytes]) -> None:
    global _frame_strips_bytes

    size = sum(len(frame) for frame in strip)
    with _frame_strips_lock:
        previous = _frame_strips.pop(key, None)
        if previous is not None:
            _frame_strips_bytes -= sum(len(frame) for frame in previous[1])

        _frame_strips[key] = (token, strip)
        _frame_strips_bytes += size

        while _frame_strips_bytes > GIF_FRAME_CACHE_BUDGET_BYTES and len(_frame_strips) > 1:
            _, evicted = _frame_strips.popitem(last=False)
            _frame_strips_bytes -= sum(len(frame) for frame in evicted[1])


def _decode_lock(key: str) -> threading.Lock:
    with _decode_locks_lock:
        lock = _decode_locks.get(key)
        if lock is None:
            # Clearing is safe: a held lock still works; a duplicate decode is wasteful, not wrong.
            if len(_decode_locks) >= _MAX_FRAME_COUNT_CACHE:
                _decode_locks.clear()
            lock = threading.Lock()
            _decode_locks[key] = lock
        return lock


def _is_uncacheable(key: str, token: tuple[int, int]) -> bool:
    with _frame_strips_lock:
        return (key, token) in _uncacheable_strips


def warm_gif_frames(path: Path) -> bool:
    """Decode and cache every frame. Returns whether a strip is now resident."""
    key = str(path.resolve())
    token = _cache_token(path)
    if token is None or _is_uncacheable(key, token):
        return False

    with _decode_lock(key):
        if _strip_from_cache(key, token) is not None:
            return True

        try:
            strip = _decode_strip(path)
        except GifFrameError:
            strip = None

        if strip is None:
            with _frame_strips_lock:
                _uncacheable_strips.add((key, token))
            return False

        _store_strip(key, token, strip)
        return True


def _schedule_warm(path: Path, key: str, token: tuple[int, int]) -> None:
    """Start a full decode unless one is already running for this GIF."""
    lock = _decode_lock(key)
    if not lock.acquire(blocking=False):
        return
    lock.release()

    thread = threading.Thread(
        target=warm_gif_frames,
        args=(path,),
        name=f"gif-warm-{Path(key).name}",
        daemon=True,
    )
    thread.start()


def extract_gif_frame(path: Path, index: int) -> bytes:
    """One frame as JPEG bytes. Raises GifFrameUnavailableError / GifFrameError."""
    if index < 0:
        raise GifFrameUnavailableError("Frame index is out of range")

    key = str(path.resolve())
    token = _cache_token(path)
    strip = _strip_from_cache(key, token)

    if strip is None:
        if token is not None and not _is_uncacheable(key, token):
            _schedule_warm(path, key, token)
        return _walk_to_frame(path, index)

    if index >= len(strip):
        raise GifFrameUnavailableError("Frame index is out of range")

    return strip[index]


def keyframe_indices(total_frames: int, count: int) -> list[int]:
    """Up to ``count`` evenly spaced indices, always including first and last."""
    if total_frames <= 0 or count <= 0:
        return []
    if total_frames <= count:
        return list(range(total_frames))
    if count == 1:
        return [0]
    return sorted({round(index * (total_frames - 1) / (count - 1)) for index in range(count)})


def extract_gif_first_frame(path: Path) -> Image.Image | None:
    """Opening frame as opaque RGB. Flatten rather than convert("RGB"), which would emit the transparent palette entry."""
    try:
        data = _read_gif_bytes(path)
        with _open_gif(data) as image:
            return _flatten(image)
    except (OSError, UnidentifiedImageError, GifFrameError) as exc:
        logger.error("GIF first frame read failed for %s: %s", path.name, exc)
        return None
