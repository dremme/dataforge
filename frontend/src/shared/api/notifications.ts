import { postJson, requestJson } from "@/shared/api/http";
import type {
  NotificationRecord,
  NotificationVariant,
  NotificationsResponse,
} from "@/shared/types";

export async function fetchNotifications(signal?: AbortSignal): Promise<NotificationRecord[]> {
  const response = await requestJson<NotificationsResponse>("/api/notifications", { signal });
  return response.notifications;
}

export async function postNotification(
  message: string,
  variant: NotificationVariant,
): Promise<NotificationRecord> {
  return postJson<NotificationRecord>("/api/notifications", { message, variant });
}

export async function markNotificationsRead(): Promise<NotificationRecord[]> {
  const response = await postJson<NotificationsResponse>("/api/notifications/read", {});
  return response.notifications;
}

export async function clearNotifications(): Promise<NotificationRecord[]> {
  const response = await requestJson<NotificationsResponse>("/api/notifications", {
    method: "DELETE",
  });
  return response.notifications;
}
