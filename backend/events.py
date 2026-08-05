"""Server-sent event fan-out from worker threads to connected clients.

Job progress is produced on worker threads (:mod:`automation.jobs`) and consumed by the
SSE endpoint on the event loop, so a subscriber remembers the loop it was created on and
publishers hand the event over with ``call_soon_threadsafe`` rather than touching the
queue directly.

A subscriber that stops reading must never hold up a job, so its queue is bounded and
drops its oldest event when full. Losing an intermediate progress frame is harmless —
each one carries the job's whole current state, so the next frame restores the truth.
"""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Iterator
from contextlib import contextmanager, suppress

#: Enough to absorb a burst from a fast per-file job without unbounded growth.
MAX_QUEUED_EVENTS = 100

Event = dict[str, object]


class Subscriber:
    """One connected client's event queue, fed from any thread."""

    def __init__(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop
        self._queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=MAX_QUEUED_EVENTS)

    def offer(self, event: Event) -> None:
        """Hand ``event`` to this subscriber's loop. Safe from any thread."""
        with suppress(RuntimeError):
            # The loop is gone when the client disconnected mid-publish; the
            # subscriber is on its way out anyway.
            self._loop.call_soon_threadsafe(self._enqueue, event)

    def _enqueue(self, event: Event) -> None:
        if self._queue.full():
            with suppress(asyncio.QueueEmpty):
                self._queue.get_nowait()
        with suppress(asyncio.QueueFull):
            self._queue.put_nowait(event)

    async def next_event(self, timeout: float) -> Event | None:
        """The next event, or ``None`` when ``timeout`` elapses first."""
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except TimeoutError:
            return None


_subscribers: set[Subscriber] = set()
_lock = threading.Lock()


def publish(event: Event) -> None:
    """Fan ``event`` out to every connected client. Safe from any thread."""
    with _lock:
        targets = list(_subscribers)

    for subscriber in targets:
        subscriber.offer(event)


def subscriber_count() -> int:
    with _lock:
        return len(_subscribers)


@contextmanager
def subscribe() -> Iterator[Subscriber]:
    """Register a subscriber for the duration of one connection."""
    subscriber = Subscriber(asyncio.get_running_loop())

    with _lock:
        _subscribers.add(subscriber)
    try:
        yield subscriber
    finally:
        with _lock:
            _subscribers.discard(subscriber)


def clear_subscribers_for_tests() -> None:
    with _lock:
        _subscribers.clear()
