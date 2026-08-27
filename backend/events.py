"""SSE fan-out from worker threads. Queues are bounded; a full queue drops the oldest event."""

from __future__ import annotations

import asyncio
import threading
from collections.abc import Iterable, Iterator
from contextlib import contextmanager, suppress

MAX_QUEUED_EVENTS = 100

Event = dict[str, object]


class Subscriber:
    def __init__(self, loop: asyncio.AbstractEventLoop, tab_id: str = "") -> None:
        self._loop = loop
        self._queue: asyncio.Queue[Event] = asyncio.Queue(maxsize=MAX_QUEUED_EVENTS)
        self.tab_id = tab_id

    def offer(self, event: Event) -> None:
        """Safe from any thread."""
        with suppress(RuntimeError):
            # The loop is gone when the client disconnected mid-publish.
            self._loop.call_soon_threadsafe(self._enqueue, event)

    def _enqueue(self, event: Event) -> None:
        if self._queue.full():
            with suppress(asyncio.QueueEmpty):
                self._queue.get_nowait()
        with suppress(asyncio.QueueFull):
            self._queue.put_nowait(event)

    async def next_event(self, timeout: float) -> Event | None:
        try:
            return await asyncio.wait_for(self._queue.get(), timeout=timeout)
        except TimeoutError:
            return None


_subscribers: set[Subscriber] = set()
_lock = threading.Lock()


def publish(event: Event) -> None:
    """Safe from any thread."""
    with _lock:
        targets = list(_subscribers)

    for subscriber in targets:
        subscriber.offer(event)


def publish_to_tabs(tab_ids: Iterable[str], event: Event) -> None:
    """Send ``event`` only to streams belonging to ``tab_ids``. Safe from any thread."""
    wanted = set(tab_ids)
    if not wanted:
        return

    with _lock:
        targets = [subscriber for subscriber in _subscribers if subscriber.tab_id in wanted]

    for subscriber in targets:
        subscriber.offer(event)


def subscriber_count() -> int:
    with _lock:
        return len(_subscribers)


def connected_tab_ids() -> set[str]:
    with _lock:
        return {subscriber.tab_id for subscriber in _subscribers if subscriber.tab_id}


@contextmanager
def subscribe(tab_id: str = "") -> Iterator[Subscriber]:
    subscriber = Subscriber(asyncio.get_running_loop(), tab_id)

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
