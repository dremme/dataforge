"""Stat-keyed memo for parsed caption and issue sidecars."""

from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path

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
) -> T:
    """``namespace`` separates readings of the same file (caption vs issue)."""
    key: _CacheKey = (namespace, str(path), mtime_ns, size)

    with _lock:
        hit = _cache.get(key, _MISS)
        if hit is not _MISS:
            _cache.move_to_end(key)
            return hit  # type: ignore[return-value]

    value = load()

    with _lock:
        _cache[key] = value
        _cache.move_to_end(key)
        while len(_cache) > MAX_CACHE_ENTRIES:
            _cache.popitem(last=False)

    return value
