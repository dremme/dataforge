from fastapi import APIRouter

import notifications
from schemas import NotificationCreateRequest, NotificationRecord, NotificationsResponse

router = APIRouter()


@router.get("/notifications", response_model=NotificationsResponse)
def read_notifications() -> NotificationsResponse:
    return NotificationsResponse(notifications=notifications.list_notifications())


@router.post("/notifications", response_model=NotificationRecord)
def create_notification(body: NotificationCreateRequest) -> NotificationRecord:
    return notifications.record_notification(body.message, body.variant, source="client")


@router.post("/notifications/read", response_model=NotificationsResponse)
def mark_notifications_read() -> NotificationsResponse:
    notifications.mark_all_read()
    return NotificationsResponse(notifications=notifications.list_notifications())


@router.delete("/notifications", response_model=NotificationsResponse)
def clear_notifications() -> NotificationsResponse:
    notifications.clear_notifications()
    return NotificationsResponse()
