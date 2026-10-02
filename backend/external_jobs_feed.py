"""Polls AI-Toolkit while anyone is listening and pushes what changes."""

from __future__ import annotations

import asyncio
import logging
import threading
from time import monotonic

import events
from external.ostris_jobs import fetch_active_ostris_jobs
from revisions import next_revision
from schemas import ExternalJobsEvent, ExternalOstrisJobResponse

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 2.0
IDLE_INTERVAL_SECONDS = 5.0

_lock = threading.Lock()
_snapshot: dict[str, object] | None = None
_observed_at = 0.0


def observe_external_jobs(jobs: list[dict[str, object]], available: bool) -> dict[str, object]:
    """Record one AI-Toolkit read and return the current snapshot, pushing it when it changed.

    REST reads and the feed both land here, so whichever sees a change first announces it and
    the other cannot announce it a second time with an older revision.
    """
    global _snapshot, _observed_at

    content = ExternalJobsEvent(
        jobs=[ExternalOstrisJobResponse.model_validate(job) for job in jobs],
        active_count=len(jobs),
        available=available,
    ).model_dump()

    with _lock:
        _observed_at = monotonic()
        previous = _snapshot
        if previous is not None and {**previous, "revision": 0} == content:
            return previous

        snapshot = {**content, "revision": next_revision()}
        _snapshot = snapshot
        # Under the lock, so two concurrent changes go out in revision order.
        events.publish(snapshot)
        return snapshot


def read_external_jobs() -> dict[str, object]:
    """The newest snapshot, asking AI-Toolkit again only when it is older than one poll."""
    with _lock:
        if _snapshot is not None and monotonic() - _observed_at < POLL_INTERVAL_SECONDS:
            return _snapshot

    return _poll_external_jobs()


def reset_external_jobs_for_tests() -> None:
    global _snapshot, _observed_at
    with _lock:
        _snapshot = None
        _observed_at = 0.0


def _poll_external_jobs() -> dict[str, object]:
    jobs, available = fetch_active_ostris_jobs()
    return observe_external_jobs(jobs, available)


async def run_external_jobs_feed() -> None:
    while True:
        if events.subscriber_count() == 0:
            await asyncio.sleep(IDLE_INTERVAL_SECONDS)
            continue

        try:
            await asyncio.to_thread(_poll_external_jobs)
        except Exception:
            logger.debug("AI-Toolkit poll failed", exc_info=True)

        await asyncio.sleep(POLL_INTERVAL_SECONDS)
