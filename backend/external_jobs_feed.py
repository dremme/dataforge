"""Polls AI-Toolkit on the server's schedule and pushes what changes.

Every connected client used to poll ``/api/external/ostris/jobs`` itself, once a second
while any job was active, and each of those calls made an outbound HTTP request to
AI-Toolkit. One task polls now, only while somebody is listening, and publishes to all
of them.

Clients still hydrate from ``/api/external/ostris/jobs`` when they connect; this feed
only carries the updates after that, so it publishes nothing while the state is
unchanged.
"""

from __future__ import annotations

import asyncio
import logging

import events
from external.ostris_jobs import fetch_active_ostris_jobs
from schemas import ExternalJobsEvent, ExternalOstrisJobResponse

logger = logging.getLogger(__name__)

#: Training progresses in steps that take seconds; a tighter loop would only add
#: outbound requests to a service that has nothing new to say.
POLL_INTERVAL_SECONDS = 2.0

#: How long to wait before looking again for a first listener.
IDLE_INTERVAL_SECONDS = 5.0


def external_jobs_event() -> dict[str, object]:
    jobs, available = fetch_active_ostris_jobs()
    return ExternalJobsEvent(
        jobs=[ExternalOstrisJobResponse.model_validate(job) for job in jobs],
        active_count=len(jobs),
        available=available,
    ).model_dump()


async def run_external_jobs_feed() -> None:
    """Publish AI-Toolkit state whenever it changes and anyone is listening."""
    last_event: dict[str, object] | None = None

    while True:
        if events.subscriber_count() == 0:
            # Nobody is watching, so forget what was last sent: the next listener
            # hydrates over REST and must not miss a change made while away.
            last_event = None
            await asyncio.sleep(IDLE_INTERVAL_SECONDS)
            continue

        try:
            event = await asyncio.to_thread(external_jobs_event)
        except Exception:
            logger.debug("AI-Toolkit poll failed", exc_info=True)
            await asyncio.sleep(POLL_INTERVAL_SECONDS)
            continue

        if event != last_event:
            last_event = event
            events.publish(event)

        await asyncio.sleep(POLL_INTERVAL_SECONDS)
