import { createContext, useContext } from "react";

export type NotificationVariant = "danger" | "warning" | "success";

export interface Notification {
  id: string;
  message: string;
  variant: NotificationVariant;
  exiting?: boolean;
}

export interface NotifyOptions {
  message: string;
  variant: NotificationVariant;
  duration?: number;
}

export const NOTIFICATION_EXIT_MS = 220;

export interface NotificationsContextValue {
  notify: (options: NotifyOptions) => void;
  dismiss: (id: string) => void;
}

export const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return context;
}

export function useNotify() {
  return useNotifications().notify;
}
