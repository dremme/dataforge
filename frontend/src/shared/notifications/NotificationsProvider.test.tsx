import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATION_EXIT_MS, useNotify } from "./notifications";
import { NotificationsProvider } from "./NotificationsProvider";

function NotifyButton({ message, variant }: { message: string; variant: "danger" }) {
  const notify = useNotify();
  return (
    <button type="button" onClick={() => notify({ message, variant })}>
      Notify
    </button>
  );
}

describe("NotificationsProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("shows a dismissible notification that auto-dismisses with exit animation", () => {
    render(
      <NotificationsProvider>
        <NotifyButton message="Move failed" variant="danger" />
      </NotificationsProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Notify" }));
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
      fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("Move failed");

    act(() => {
      vi.advanceTimersByTime(5000);
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
        <NotifyButton message="Could not delete sunset.png: Permission denied" variant="danger" />
      </NotificationsProvider>,
    );

    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    });

    const toast = screen.getByRole("alert");

    act(() => {
      vi.advanceTimersByTime(3000);
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
});
