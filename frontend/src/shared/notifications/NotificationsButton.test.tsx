import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NotificationRecord } from "@/shared/types";
import * as notificationsApi from "@/shared/api/notifications";
import { NotificationsButton } from "./NotificationsButton";
import { NotificationsProvider } from "./NotificationsProvider";

vi.mock("@/shared/api/notifications", () => ({
  fetchNotifications: vi.fn(),
  postNotification: vi.fn(),
  markNotificationsRead: vi.fn(),
  clearNotifications: vi.fn(),
}));

const fetchNotifications = vi.mocked(notificationsApi.fetchNotifications);
const markNotificationsRead = vi.mocked(notificationsApi.markNotificationsRead);
const clearNotifications = vi.mocked(notificationsApi.clearNotifications);

const READ_AT = "2026-02-01T00:00:00.000Z";

function record(overrides: Partial<NotificationRecord> = {}): NotificationRecord {
  return {
    id: "notification-1",
    message: 'Auto-caption completed in "Photos".',
    variant: "success",
    source: "job",
    job_id: "job-1",
    count: 1,
    created_at: new Date().toISOString(),
    read_at: null,
    ...overrides,
  };
}

function renderButton(feed: NotificationRecord[]) {
  fetchNotifications.mockResolvedValue(feed);
  // The endpoint returns the stamped feed, which is what the provider adopts.
  markNotificationsRead.mockResolvedValue(
    feed.map((entry) => ({ ...entry, read_at: entry.read_at ?? READ_AT })),
  );

  return render(
    <NotificationsProvider>
      <NotificationsButton />
    </NotificationsProvider>,
  );
}

/** Waits for the retained feed to land before opening, so the panel is never read empty. */
async function openPanel(user: ReturnType<typeof userEvent.setup>, unread: number) {
  const name = unread > 0 ? `Notifications (${unread} new)` : "Notifications";
  await user.click(await screen.findByRole("button", { name }));
  return screen.getByRole("group", { name: "Notifications" });
}

describe("NotificationsButton", () => {
  beforeEach(() => {
    fetchNotifications.mockResolvedValue([]);
    clearNotifications.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("fetches the retained feed and counts what has not been read", async () => {
    renderButton([
      record({ id: "a" }),
      record({ id: "b", variant: "danger", message: "Auto-caption failed." }),
      record({ id: "c", read_at: READ_AT }),
    ]);

    expect(await screen.findByRole("button", { name: "Notifications (2 new)" })).toBeVisible();
  });

  it("lists the retained notifications when opened", async () => {
    const user = userEvent.setup();
    renderButton([record(), record({ id: "b", message: "Second." })]);

    const panel = await openPanel(user, 2);

    expect(within(panel).getByText('Auto-caption completed in "Photos".')).toBeVisible();
    expect(within(panel).getByText("Second.")).toBeVisible();
  });

  it("re-reads the feed when the panel opens", async () => {
    const user = userEvent.setup();
    renderButton([record()]);

    await openPanel(user, 1);

    await waitFor(() => expect(fetchNotifications).toHaveBeenCalledTimes(2));
  });

  it("keeps the unread marks visible while the panel is open", async () => {
    const user = userEvent.setup();
    renderButton([record()]);

    const panel = await openPanel(user, 1);

    expect(panel.querySelector(".notifications-panel__row--unread")).not.toBeNull();
    expect(markNotificationsRead).not.toHaveBeenCalled();
  });

  it("marks everything read once the panel closes", async () => {
    const user = userEvent.setup();
    renderButton([record()]);

    await openPanel(user, 1);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(markNotificationsRead).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeVisible();
  });

  it("shows how often a message repeated", async () => {
    const user = userEvent.setup();
    renderButton([record({ count: 4, message: "Could not read." })]);

    const panel = await openPanel(user, 1);

    expect(within(panel).getByText("×4")).toBeVisible();
  });

  it("clears the feed and falls back to the empty state", async () => {
    const user = userEvent.setup();
    renderButton([record()]);

    const panel = await openPanel(user, 1);
    await user.click(within(panel).getByRole("button", { name: "Clear all" }));

    expect(clearNotifications).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("No notifications")).toBeVisible();
  });

  it("offers the empty state when nothing has arrived yet", async () => {
    const user = userEvent.setup();
    renderButton([]);

    const panel = await openPanel(user, 0);

    expect(within(panel).getByText("No notifications")).toBeVisible();
    expect(within(panel).queryByRole("button", { name: "Clear all" })).not.toBeInTheDocument();
  });
});
