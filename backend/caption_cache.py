"""Stat-keyed memo for parsed caption and issue sidecars.

Browsing a folder used to re-read and re-parse every sidecar on every request —
including the reloads the 3s change-detection poll triggers. Keying on
``(path, mtime_ns, size)`` makes a repeat browse of an unchanged folder cost no
file reads at all, while a rewritten sidecar bumps its mtime and so invalidates
itself. Callers get those three values free from :mod:`folder_scan`, so a lookup
costs no syscall either.
"""

from __future__ import annotations

import threading
from collections import OrderedDict
from collections.abc import Callable
from pathlib import Path
from typing import TypeVar

#: Roughly one very large folder's worth of sidecars; entries are small tuples.
MAX_CACHE_ENTRIES = 20_000

T = TypeVar("T")

_CacheKey = tuple[str, str, int, int]

_cache: OrderedDict[_CacheKey, object] = OrderedDict()
_lock = threading.Lock()
_MISS = object()


def clear_caption_cache_for_tests() -> None:
    with _lock:
        _cache.clear()


def cached_by_stat(
    namespace: str,
    path: Path,
    mtime_ns: int,
    size: int,
    load: Callable[[], T],
) -> T:
    """``load()`` memoized against the file's identity and stat signature.

    ``namespace`` separates readings of the same file (a caption sidecar is read
    both as a caption summary and, for ``.issue.json``, as an issue summary).
    """
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
