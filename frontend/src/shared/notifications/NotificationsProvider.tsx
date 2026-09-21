import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  clearNotifications,
  fetchNotifications,
  markNotificationsRead,
  postNotification,
} from "@/shared/api/notifications";
import { useOptionalServerEvent } from "@/shared/events/serverEvents";
import { NotificationContainer } from "./NotificationContainer";
import {
  MAX_VISIBLE_TOASTS,
  NOTIFICATION_DURATION_MS,
  NotificationsContext,
  upsertNotification,
  type NotificationRecord,
  type NotificationVariant,
  type NotifyOptions,
  type Toast,
} from "./notifications";
import { useToastTimers } from "./useToastTimers";

function createToastId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [history, setHistory] = useState<NotificationRecord[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);

  // Collapse and cap decisions read committed toasts, never the value inside a state updater.
  const toastsRef = useRef<Toast[]>([]);
  const panelOpenRef = useRef(false);
  panelOpenRef.current = panelOpen;

  const applyToasts = useCallback((next: Toast[]) => {
    toastsRef.current = next;
    setToasts(next);
  }, []);

  // The wrappers close over the bindings below, so the timers can own the whole lifecycle.
  const timers = useToastTimers(
    (id) => dismiss(id),
    (id) => removeToast(id),
  );

  const removeToast = useCallback(
    (id: string) => {
      timers.cancel(id);
      applyToasts(toastsRef.current.filter((toast) => toast.id !== id));
    },
    [applyToasts, timers],
  );

  const dismiss = useCallback(
    (id: string) => {
      const target = toastsRef.current.find((toast) => toast.id === id);
      if (!target || target.exiting) return;
      if (!timers.armExit(id)) return;

      applyToasts(
        toastsRef.current.map((toast) => (toast.id === id ? { ...toast, exiting: true } : toast)),
      );
    },
    [applyToasts, timers],
  );

  const pushToast = useCallback(
    (message: string, variant: NotificationVariant) => {
      // An open panel already lists what arrives, so a toast would only cover the list.
      if (panelOpenRef.current) return;

      const durationMs = NOTIFICATION_DURATION_MS[variant];
      const existing = toastsRef.current.find(
        (toast) => !toast.exiting && toast.variant === variant && toast.message === message,
      );

      if (existing) {
        applyToasts(
          toastsRef.current.map((toast) =>
            toast.id === existing.id ? { ...toast, count: toast.count + 1 } : toast,
          ),
        );
        timers.schedule(existing.id, durationMs);
        return;
      }

      const id = createToastId();
      const next = [...toastsRef.current, { id, message, variant, count: 1, durationMs }];
      applyToasts(next);
      timers.schedule(id, durationMs);

      const live = next.filter((toast) => !toast.exiting);
      for (const stale of live.slice(0, Math.max(0, live.length - MAX_VISIBLE_TOASTS))) {
        dismiss(stale.id);
      }
    },
    [applyToasts, dismiss, timers],
  );

  const notify = useCallback(
    ({ message, variant }: NotifyOptions) => {
      const trimmed = message.trim();
      if (!trimmed) return;

      pushToast(trimmed, variant);

      // The toast must outlive a failed POST: most danger toasts report the backend being down.
      void postNotification(trimmed, variant)
        .then((record) => setHistory((current) => upsertNotification(current, record)))
        .catch(() => {});
    },
    [pushToast],
  );

  useOptionalServerEvent((event) => {
    if (event.type !== "notification") return;

    setHistory((current) => upsertNotification(current, event.notification));
    // A client toast already showed in the tab that raised it, and is not this tab's business.
    if (event.notification.source === "job") {
      pushToast(event.notification.message, event.notification.variant);
    }
  });

  useEffect(() => {
    const controller = new AbortController();
    fetchNotifications(controller.signal)
      .then(setHistory)
      .catch(() => {});
    return () => controller.abort();
  }, []);

  const markAllRead = useCallback(() => {
    setHistory((current) =>
      current.map((entry) =>
        entry.read_at ? entry : { ...entry, read_at: new Date().toISOString() },
      ),
    );
    void markNotificationsRead()
      .then(setHistory)
      .catch(() => {});
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
    void clearNotifications()
      .then(setHistory)
      .catch(() => {});
  }, []);

  const unreadCount = useMemo(() => history.filter((entry) => !entry.read_at).length, [history]);

  const value = useMemo(
    () => ({
      notify,
      dismiss,
      history,
      unreadCount,
      panelOpen,
      setPanelOpen,
      markAllRead,
      clearHistory,
    }),
    [notify, dismiss, history, unreadCount, panelOpen, markAllRead, clearHistory],
  );

  return (
    <NotificationsContext.Provider value={value}>
      {children}
      <NotificationContainer
        toasts={toasts}
        onDismiss={dismiss}
        onRemove={removeToast}
        onPauseAutoDismiss={timers.pause}
        onResumeAutoDismiss={timers.resume}
      />
    </NotificationsContext.Provider>
  );
}
