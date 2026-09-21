import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRecord, ServerEvent } from "@/shared/types";
import { ServerEventsContext } from "@/shared/events/serverEvents";
import * as notificationsApi from "@/shared/api/notifications";
import {
  MAX_VISIBLE_TOASTS,
  NOTIFICATION_DURATION_MS,
  NOTIFICATION_EXIT_MS,
  useNotify,
} from "./notifications";
import { NotificationsProvider } from "./NotificationsProvider";

vi.mock("@/shared/api/notifications", () => ({
  fetchNotifications: vi.fn(),
  postNotification: vi.fn(),
  markNotificationsRead: vi.fn(),
  clearNotifications: vi.fn(),
}));

const fetchNotifications = vi.mocked(notificationsApi.fetchNotifications);
const postNotification = vi.mocked(notificationsApi.postNotification);

const DANGER_MS = NOTIFICATION_DURATION_MS.danger;

function record(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "notification-1",
    message: 'Auto-caption completed in "Photos".',
    variant: "success",
    source: "job",
    job_id: "job-1",
    count: 1,
    created_at: "2026-01-01T00:00:00.000Z",
    read_at: null,
    ...overrides,
  };
}

function NotifyButton({
  message,
  variant = "danger",
}: {
  message: string;
  variant?: NotificationRecord["variant"];
}) {
  const notify = useNotify();
  return (
    <button type="button" onClick={() => notify({ message, variant })}>
      {`Notify ${message}`}
    </button>
  );
}

let emit: (event: ServerEvent) => void = () => {};

function renderProvider(children: React.ReactNode) {
  const handlers = new Set<(event: ServerEvent) => void>();
  emit = (event) => {
    for (const handler of handlers) handler(event);
  };

  return render(
    <ServerEventsContext.Provider
      value={{
        connected: true,
        subscribe: (handler) => {
          handlers.add(handler);
          return () => handlers.delete(handler);
        },
      }}
    >
      <NotificationsProvider>{children}</NotificationsProvider>
    </ServerEventsContext.Provider>,
  );
}

function renderWithStream(connected: boolean) {
  const handlers = new Set<(event: ServerEvent) => void>();
  emit = (event) => {
    for (const handler of handlers) handler(event);
  };
  const subscribe = (handler: (event: ServerEvent) => void) => {
    handlers.add(handler);
    return () => handlers.delete(handler);
  };
  const tree = (value: boolean) => (
    <ServerEventsContext.Provider value={{ connected: value, subscribe }}>
      <NotificationsProvider>{null}</NotificationsProvider>
    </ServerEventsContext.Provider>
  );

  const view = render(tree(connected));
  return { setConnected: (value: boolean) => view.rerender(tree(value)) };
}

describe("NotificationsProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fetchNotifications.mockResolvedValue([]);
    postNotification.mockResolvedValue(record({ source: "client" }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("shows a dismissible notification that auto-dismisses with exit animation", () => {
    render(
      <NotificationsProvider>
        <NotifyButton message="Move failed" />
      </NotificationsProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Notify / }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Move failed");

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Dismiss notification" }));
    });
    expect(screen.getByRole("alert")).toHaveClass("notifications__toast--exiting");

    act(() => {
      vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Notify / }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Move failed");

    act(() => {
      vi.advanceTimersByTime(DANGER_MS);
    });
    expect(screen.getByRole("alert")).toHaveClass("notifications__toast--exiting");

    act(() => {
      vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("pauses auto-dismiss while the pointer is over the notification", () => {
    render(
      <NotificationsProvider>
        <NotifyButton message="Could not delete sunset.png: Permission denied" />
      </NotificationsProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Notify / }));
    });

    const toast = screen.getByRole("alert");

    act(() => {
      vi.advanceTimersByTime(DANGER_MS - 2000);
    });
    expect(toast).not.toHaveClass("notifications__toast--exiting");

    act(() => {
      fireEvent.mouseEnter(toast);
    });

    act(() => {
      vi.advanceTimersByTime(10000);
    });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("alert")).not.toHaveClass("notifications__toast--exiting");
    expect(screen.getByRole("alert")).toHaveClass("notifications__toast--paused");

    act(() => {
      fireEvent.mouseLeave(toast);
    });

    act(() => {
      vi.advanceTimersByTime(1999);
    });
    expect(screen.getByRole("alert")).not.toHaveClass("notifications__toast--exiting");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(screen.getByRole("alert")).toHaveClass("notifications__toast--exiting");

    act(() => {
      vi.advanceTimersByTime(NOTIFICATION_EXIT_MS);
    });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("collapses an immediate repeat into a count and restarts its countdown", () => {
    render(
      <NotificationsProvider>
        <NotifyButton message="Could not read the folder." />
      </NotificationsProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Notify / }));
    });

    act(() => {
      vi.advanceTimersByTime(DANGER_MS - 1000);
    });

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Notify / }));
    });

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByLabelText("Repeated 2 times")).toHaveTextContent("×2");

    act(() => {
      vi.advanceTimersByTime(DANGER_MS - 1);
    });
    expect(screen.getByRole("alert")).not.toHaveClass("notifications__toast--exiting");
  });

  it("caps the visible stack so a burst cannot cover the screen", () => {
    const messages = ["First.", "Second.", "Third.", "Fourth."];

    render(
      <NotificationsProvider>
        {messages.map((message) => (
          <NotifyButton key={message} message={message} />
        ))}
      </NotificationsProvider>,
    );

    const liveToasts = () =>
      screen
        .queryAllByRole("alert")
        .filter((toast) => !toast.classList.contains("notifications__toast--exiting"));

    for (const message of messages.slice(0, MAX_VISIBLE_TOASTS)) {
      act(() => {
        fireEvent.click(screen.getByRole("button", { name: `Notify ${message}` }));
      });
    }
    expect(liveToasts()).toHaveLength(MAX_VISIBLE_TOASTS);

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Notify Fourth." }));
    });

    const live = liveToasts();
    expect(live).toHaveLength(MAX_VISIBLE_TOASTS);
    expect(live.some((toast) => toast.textContent?.includes("First."))).toBe(false);
    expect(live.at(-1)).toHaveTextContent("Fourth.");
  });

  it("keeps the toast on screen when recording it in the feed fails", () => {
    postNotification.mockRejectedValue(new Error("Backend unreachable"));

    render(
      <NotificationsProvider>
        <NotifyButton message="Could not reach the server." />
      </NotificationsProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: /^Notify / }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("Could not reach the server.");
  });

  it("raises a toast for a pushed job outcome", () => {
    renderProvider(null);

    act(() => {
      emit({ type: "notification", notification: record() });
    });

    expect(screen.getByRole("status")).toHaveTextContent('Auto-caption completed in "Photos".');
  });

  it("does not re-toast a client notification another tab raised", () => {
    renderProvider(null);

    act(() => {
      emit({
        type: "notification",
        notification: record({ source: "client", message: "Folder path copied." }),
      });
    });

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("re-reads the feed when the stream reconnects", () => {
    const { setConnected } = renderWithStream(false);
    expect(fetchNotifications).toHaveBeenCalledTimes(1);

    act(() => setConnected(true));

    expect(fetchNotifications).toHaveBeenCalledTimes(2);
  });

  it("does not re-read the feed when the stream merely drops", () => {
    const { setConnected } = renderWithStream(true);
    expect(fetchNotifications).toHaveBeenCalledTimes(1);

    act(() => setConnected(false));

    expect(fetchNotifications).toHaveBeenCalledTimes(1);
  });

  it("re-reads the feed when the tab is looked at again", () => {
    renderWithStream(true);
    expect(fetchNotifications).toHaveBeenCalledTimes(1);

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(fetchNotifications).toHaveBeenCalledTimes(2);
  });

  it("loads the retained feed when it mounts", () => {
    renderProvider(null);

    expect(fetchNotifications).toHaveBeenCalledTimes(1);
  });
});
