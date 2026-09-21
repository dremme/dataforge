"""Records a notification and pushes it to every open tab."""

from __future__ import annotations

import events
import notifications_store
from schemas import NotificationEvent, NotificationRecord, NotificationSource, NotificationVariant


def record_notification(
    message: str,
    variant: NotificationVariant,
    *,
    source: NotificationSource,
    job_id: str | None = None,
) -> NotificationRecord:
    trimmed = message.strip()
    if not trimmed:
        raise ValueError("A notification needs a message")

    stored = notifications_store.insert_notification(
        message=trimmed, variant=variant, source=source, job_id=job_id
    )
    record = NotificationRecord.model_validate(stored)
    events.publish(NotificationEvent(notification=record).model_dump())
    return record


def list_notifications() -> list[NotificationRecord]:
    return [
        NotificationRecord.model_validate(row) for row in notifications_store.list_notifications()
    ]


def mark_all_read() -> None:
    notifications_store.mark_all_read()


def clear_notifications() -> None:
    notifications_store.delete_all_notifications()
