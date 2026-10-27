import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  type NotificationActionFor,
  type NotificationRecord,
  type NotificationVariant,
  type NotifyOptions,
  type Toast,
  type ToastAction,
} from "./notifications";
import { useToastTimers } from "./useToastTimers";
import { useLatestRef } from "@/shared/hooks/useLatestRef";

const HISTORY_QUERY_KEY = ["notifications"] as const;

const NO_HISTORY: NotificationRecord[] = [];

function createToastId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `notification-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [providers, setProviders] = useState<ReadonlyMap<string, NotificationActionFor>>(
    () => new Map(),
  );

  const provideActions = useCallback((key: string, provider: NotificationActionFor | null) => {
    setProviders((current) => {
      if ((current.get(key) ?? null) === provider) return current;
      const next = new Map(current);
      if (provider) next.set(key, provider);
      else next.delete(key);
      return next;
    });
  }, []);

  const actionFor = useCallback(
    (record: NotificationRecord) => {
      for (const provider of providers.values()) {
        const action = provider(record);
        if (action) return action;
      }
      return undefined;
    },
    [providers],
  );

  // Nothing replays the frames a disconnected tab missed, so every way back in re-reads the
  // feed: mount, a reconnect or reported loss (push-fed), the tab being looked at again
  // (focus), and the panel opening (refreshHistory).
  const historyQuery = useQuery({
    queryKey: HISTORY_QUERY_KEY,
    queryFn: ({ signal }) => fetchNotifications(signal),
    meta: { pushFed: true },
  });
  const history = historyQuery.data ?? NO_HISTORY;
  const { refetch: refetchHistory } = historyQuery;

  const setHistory = useCallback(
    (update: (current: NotificationRecord[]) => NotificationRecord[]) =>
      queryClient.setQueryData<NotificationRecord[]>(HISTORY_QUERY_KEY, (current) =>
        update(current ?? NO_HISTORY),
      ),
    [queryClient],
  );

  // Collapse and cap decisions read committed toasts, never the value inside a state updater.
  const toastsRef = useRef<Toast[]>([]);
  const panelOpenRef = useLatestRef(panelOpen);

  const applyToasts = useCallback((next: Toast[]) => {
    toastsRef.current = next;
    setToasts(next);
  }, []);

  const timers = useToastTimers();

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
      if (!timers.armExit(id, removeToast)) return;

      applyToasts(
        toastsRef.current.map((toast) => (toast.id === id ? { ...toast, exiting: true } : toast)),
      );
    },
    [applyToasts, removeToast, timers],
  );

  const pushToast = useCallback(
    (message: string, variant: NotificationVariant, action?: ToastAction) => {
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
        timers.schedule(existing.id, durationMs, dismiss);
        return;
      }

      const id = createToastId();
      const next = [...toastsRef.current, { id, message, variant, action, count: 1, durationMs }];
      applyToasts(next);
      timers.schedule(id, durationMs, dismiss);

      const live = next.filter((toast) => !toast.exiting);
      for (const stale of live.slice(0, Math.max(0, live.length - MAX_VISIBLE_TOASTS))) {
        dismiss(stale.id);
      }
    },
    [applyToasts, dismiss, panelOpenRef, timers],
  );

  const notify = useCallback(
    ({ message, variant, action }: NotifyOptions) => {
      const trimmed = message.trim();
      if (!trimmed) return;

      pushToast(trimmed, variant, action);

      // The toast must outlive a failed POST: most danger toasts report the backend being down.
      void postNotification(trimmed, variant)
        .then((record) => setHistory((current) => upsertNotification(current, record)))
        .catch(() => {});
    },
    [pushToast, setHistory],
  );

  useOptionalServerEvent((event) => {
    if (event.type !== "notification") return;

    setHistory((current) => upsertNotification(current, event.notification));
    // A client toast already showed in the tab that raised it, and is not this tab's business.
    if (event.notification.source === "job") {
      pushToast(
        event.notification.message,
        event.notification.variant,
        actionFor(event.notification),
      );
    }
  });

  const refreshHistory = useCallback(() => {
    void refetchHistory();
  }, [refetchHistory]);

  const markAllRead = useCallback(() => {
    setHistory((current) =>
      current.map((entry) =>
        entry.read_at ? entry : { ...entry, read_at: new Date().toISOString() },
      ),
    );
    void markNotificationsRead()
      .then((saved) => setHistory(() => saved))
      .catch(() => {});
  }, [setHistory]);

  const clearHistory = useCallback(() => {
    setHistory(() => []);
    void clearNotifications()
      .then((saved) => setHistory(() => saved))
      .catch(() => {});
  }, [setHistory]);

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
      refreshHistory,
      actionFor,
      provideActions,
    }),
    [
      notify,
      dismiss,
      history,
      unreadCount,
      panelOpen,
      markAllRead,
      clearHistory,
      refreshHistory,
      actionFor,
      provideActions,
    ],
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
