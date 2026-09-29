"""Drops finished jobs and notifications once they are older than the configured number of days."""

from __future__ import annotations

import asyncio
import logging

from app_settings import effective_settings
from automation.jobs import job_manager
from notifications_store import prune_notifications

logger = logging.getLogger(__name__)

RETENTION_INTERVAL_SECONDS = 3600.0


def prune_history() -> None:
    """``0`` days keeps everything."""
    settings = effective_settings()
    jobs = job_manager.prune_finished(settings.job_history_days) if settings.job_history_days else 0
    notifications = (
        prune_notifications(settings.notification_history_days)
        if settings.notification_history_days
        else 0
    )
    if jobs or notifications:
        logger.info("Pruned %d old jobs and %d old notifications", jobs, notifications)


async def run_history_retention() -> None:
    while True:
        await asyncio.to_thread(prune_history)
        await asyncio.sleep(RETENTION_INTERVAL_SECONDS)
