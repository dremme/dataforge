"""Orders snapshots pushed over SSE against snapshots read over REST.

A client holding two copies of the same record keeps the one with the higher revision. Revisions
follow the wall clock in microseconds, so they keep rising across restarts without a stored maximum.
"""

from __future__ import annotations

import threading
import time

_lock = threading.Lock()
_last = 0


def next_revision() -> int:
    """A revision greater than every one handed out before, in this process or an earlier one."""
    global _last
    with _lock:
        _last = max(_last + 1, time.time_ns() // 1000)
        return _last
