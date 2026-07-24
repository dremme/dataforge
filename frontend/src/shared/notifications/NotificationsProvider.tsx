import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { NotificationContainer } from "./NotificationContainer";
import {
  NOTIFICATION_EXIT_MS,
  NotificationsContext,
  type Notification,
  type NotifyOptions,
} from "./notifications";

const DEFAULT_DURATION_MS = 5000;

function createNotificationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const autoDismissTimeoutIdsRef = useRef(new Map<string, number>());
  const exitTimeoutIdsRef = useRef(new Map<string, number>());

  const removeNotification = useCallback((id: string) => {
    const exitTimeoutId = exitTimeoutIdsRef.current.get(id);
    if (exitTimeoutId !== undefined) {
      window.clearTimeout(exitTimeoutId);
      exitTimeoutIdsRef.current.delete(id);
    }

    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      const autoDismissTimeoutId = autoDismissTimeoutIdsRef.current.get(id);
      if (autoDismissTimeoutId !== undefined) {
        window.clearTimeout(autoDismissTimeoutId);
        autoDismissTimeoutIdsRef.current.delete(id);
      }

      setNotifications((current) => {
        const target = current.find((notification) => notification.id === id);
        if (!target || target.exiting) {
          return current;
        }

        if (!exitTimeoutIdsRef.current.has(id)) {
          const exitTimeoutId = window.setTimeout(() => {
            removeNotification(id);
          }, NOTIFICATION_EXIT_MS);
          exitTimeoutIdsRef.current.set(id, exitTimeoutId);
        }

        return current.map((notification) =>
          notification.id === id ? { ...notification, exiting: true } : notification,
        );
      });
    },
    [removeNotification],
  );

  const notify = useCallback(
    ({ message, variant, duration = DEFAULT_DURATION_MS }: NotifyOptions) => {
      const trimmed = message.trim();
      if (!trimmed) return;

      const id = createNotificationId();
      setNotifications((current) => [...current, { id, message: trimmed, variant }]);

      const timeoutId = window.setTimeout(() => {
        dismiss(id);
      }, duration);
      autoDismissTimeoutIdsRef.current.set(id, timeoutId);
    },
    [dismiss],
  );

  useEffect(() => {
    const autoDismissTimeoutIds = autoDismissTimeoutIdsRef.current;
    const exitTimeoutIds = exitTimeoutIdsRef.current;
    return () => {
      for (const timeoutId of autoDismissTimeoutIds.values()) {
        window.clearTimeout(timeoutId);
      }
      autoDismissTimeoutIds.clear();

      for (const timeoutId of exitTimeoutIds.values()) {
        window.clearTimeout(timeoutId);
      }
      exitTimeoutIds.clear();
    };
  }, []);

  const value = useMemo(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <NotificationContainer
        notifications={notifications}
        onDismiss={dismiss}
        onRemove={removeNotification}
      />
    </NotificationsContext.Provider>
  );
}
