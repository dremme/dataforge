"""Polls AI-Toolkit while anyone is listening and pushes what changes."""

from __future__ import annotations

import asyncio
import logging

import events
from external.ostris_jobs import fetch_active_ostris_jobs
from schemas import ExternalJobsEvent, ExternalOstrisJobResponse

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 2.0
IDLE_INTERVAL_SECONDS = 5.0


def external_jobs_event() -> dict[str, object]:
    jobs, available = fetch_active_ostris_jobs()
    return ExternalJobsEvent(
        jobs=[ExternalOstrisJobResponse.model_validate(job) for job in jobs],
        active_count=len(jobs),
        available=available,
    ).model_dump()


async def run_external_jobs_feed() -> None:
    last_event: dict[str, object] | None = None

    while True:
        if events.subscriber_count() == 0:
            # Next listener hydrates over REST and must not miss a change made while idle.
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
