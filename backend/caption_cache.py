"""Stat-keyed memo for parsed caption and issue sidecars."""

from __future__ import annotations

import logging
import threading
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path
from typing import cast

logger = logging.getLogger(__name__)

MAX_CACHE_ENTRIES = 20_000

_CacheKey = tuple[str, str, int, int]

_cache: OrderedDict[_CacheKey, object] = OrderedDict()
_lock = threading.Lock()
_MISS = object()


def clear_caption_cache_for_tests() -> None:
    with _lock:
        _cache.clear()


def cached_by_stat[T](
    namespace: str,
    path: Path,
    mtime_ns: int,
    size: int,
    load: Callable[[], T],
    unreadable: Callable[[], T],
) -> T:
    """``namespace`` separates readings of the same file (caption vs issue).

    ``load`` raises ``OSError`` when the file cannot be read right now (locked, offline drive).
    ``unreadable()`` answers then and is not kept, so a read under the same stat tries again.
    """
    key: _CacheKey = (namespace, str(path), mtime_ns, size)

    with _lock:
        hit = _cache.get(key, _MISS)
        if hit is not _MISS:
            _cache.move_to_end(key)
            return cast(T, hit)

    try:
        value = load()
    except OSError:
        logger.debug("Could not read %s", path, exc_info=True)
        return unreadable()

    with _lock:
        _cache[key] = value
        _cache.move_to_end(key)
        while len(_cache) > MAX_CACHE_ENTRIES:
            _cache.popitem(last=False)

    return value
