import { createContext, useContext } from "react";
import { iconCircleAlert, iconCircleCheck, iconTriangleAlert, type AppIcon } from "@/shared/icons";
import type { NotificationRecord, NotificationVariant } from "@/shared/types";

export type { NotificationRecord, NotificationVariant };

export interface Toast {
  id: string;
  message: string;
  variant: NotificationVariant;
  /** Repeats of the newest identical toast raise this instead of stacking another. */
  count: number;
  durationMs: number;
  exiting?: boolean;
}

export interface NotifyOptions {
  message: string;
  variant: NotificationVariant;
}

export const NOTIFICATION_EXIT_MS = 220;

export const variantIcons: Record<NotificationVariant, AppIcon> = {
  danger: iconCircleAlert,
  warning: iconTriangleAlert,
  success: iconCircleCheck,
};

export const MAX_VISIBLE_TOASTS = 3;

//: Long enough to read what went wrong; a success is an acknowledgement, not a message.
export const NOTIFICATION_DURATION_MS: Record<NotificationVariant, number> = {
  danger: 8000,
  warning: 6000,
  success: 4000,
};

export interface NotificationsContextValue {
  notify: (options: NotifyOptions) => void;
  dismiss: (id: string) => void;
  history: NotificationRecord[];
  unreadCount: number;
  panelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
  markAllRead: () => void;
  clearHistory: () => void;
}

export const NotificationsContext = createContext<NotificationsContextValue | null>(null);

function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return context;
}

export function useNotify() {
  return useNotifications().notify;
}

export function useNotificationHistory() {
  const { history, unreadCount, panelOpen, setPanelOpen, markAllRead, clearHistory } =
    useNotifications();
  return { history, unreadCount, panelOpen, setPanelOpen, markAllRead, clearHistory };
}

export function upsertNotification(
  history: NotificationRecord[],
  record: NotificationRecord,
): NotificationRecord[] {
  const without = history.filter((entry) => entry.id !== record.id);
  return [record, ...without];
}
