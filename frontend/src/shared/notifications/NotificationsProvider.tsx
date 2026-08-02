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
  /** Remaining auto-dismiss time while a toast is paused (pointer hover). */
  const remainingMsRef = useRef(new Map<string, number>());
  /** Absolute deadline (`performance.now()`) for the active auto-dismiss timer. */
  const deadlineMsRef = useRef(new Map<string, number>());

  const clearAutoDismiss = useCallback((id: string) => {
    const autoDismissTimeoutId = autoDismissTimeoutIdsRef.current.get(id);
    if (autoDismissTimeoutId !== undefined) {
      window.clearTimeout(autoDismissTimeoutId);
      autoDismissTimeoutIdsRef.current.delete(id);
    }
    deadlineMsRef.current.delete(id);
  }, []);

  const removeNotification = useCallback(
    (id: string) => {
      clearAutoDismiss(id);
      remainingMsRef.current.delete(id);

      const exitTimeoutId = exitTimeoutIdsRef.current.get(id);
      if (exitTimeoutId !== undefined) {
        window.clearTimeout(exitTimeoutId);
        exitTimeoutIdsRef.current.delete(id);
      }

      setNotifications((current) => current.filter((notification) => notification.id !== id));
    },
    [clearAutoDismiss],
  );

  const dismiss = useCallback(
    (id: string) => {
      clearAutoDismiss(id);
      remainingMsRef.current.delete(id);

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
    [clearAutoDismiss, removeNotification],
  );

  const scheduleAutoDismiss = useCallback(
    (id: string, durationMs: number) => {
      clearAutoDismiss(id);

      const remainingMs = Math.max(0, durationMs);
      remainingMsRef.current.set(id, remainingMs);

      if (remainingMs === 0) {
        dismiss(id);
        return;
      }

      deadlineMsRef.current.set(id, performance.now() + remainingMs);
      const timeoutId = window.setTimeout(() => {
        autoDismissTimeoutIdsRef.current.delete(id);
        deadlineMsRef.current.delete(id);
        remainingMsRef.current.delete(id);
        dismiss(id);
      }, remainingMs);
      autoDismissTimeoutIdsRef.current.set(id, timeoutId);
    },
    [clearAutoDismiss, dismiss],
  );

  const pauseAutoDismiss = useCallback(
    (id: string) => {
      const autoDismissTimeoutId = autoDismissTimeoutIdsRef.current.get(id);
      if (autoDismissTimeoutId === undefined) {
        return;
      }

      const deadlineMs = deadlineMsRef.current.get(id);
      const remainingMs =
        deadlineMs === undefined
          ? (remainingMsRef.current.get(id) ?? 0)
          : deadlineMs - performance.now();

      clearAutoDismiss(id);
      remainingMsRef.current.set(id, Math.max(0, remainingMs));
    },
    [clearAutoDismiss],
  );

  const resumeAutoDismiss = useCallback(
    (id: string) => {
      if (autoDismissTimeoutIdsRef.current.has(id)) {
        return;
      }

      if (!remainingMsRef.current.has(id)) {
        return;
      }

      scheduleAutoDismiss(id, remainingMsRef.current.get(id) ?? 0);
    },
    [scheduleAutoDismiss],
  );

  const notify = useCallback(
    ({ message, variant, duration = DEFAULT_DURATION_MS }: NotifyOptions) => {
      const trimmed = message.trim();
      if (!trimmed) return;

      const id = createNotificationId();
      setNotifications((current) => [...current, { id, message: trimmed, variant }]);
      scheduleAutoDismiss(id, duration);
    },
    [scheduleAutoDismiss],
  );

  useEffect(() => {
    const autoDismissTimeoutIds = autoDismissTimeoutIdsRef.current;
    const exitTimeoutIds = exitTimeoutIdsRef.current;
    const remainingMs = remainingMsRef.current;
    const deadlineMs = deadlineMsRef.current;
    return () => {
      for (const timeoutId of autoDismissTimeoutIds.values()) {
        window.clearTimeout(timeoutId);
      }
      autoDismissTimeoutIds.clear();

      for (const timeoutId of exitTimeoutIds.values()) {
        window.clearTimeout(timeoutId);
      }
      exitTimeoutIds.clear();

      remainingMs.clear();
      deadlineMs.clear();
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
        onPauseAutoDismiss={pauseAutoDismiss}
        onResumeAutoDismiss={resumeAutoDismiss}
      />
    </NotificationsContext.Provider>
  );
}
