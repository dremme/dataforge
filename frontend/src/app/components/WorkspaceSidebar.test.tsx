import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { HOME_PATH } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithQueryClient } from "@/test/queryClient";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

function stubViewportWidth(width: number) {
  vi.stubGlobal("matchMedia", (query: string) => {
    const maxWidth = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? Infinity);
    return {
      matches: width <= maxWidth,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  });
}

function renderSidebar() {
  installMockBackend();
  const onNavigate = vi.fn();
  renderWithQueryClient(
    <NotificationsProvider>
      <WorkspaceSidebar
        currentFolder={HOME_PATH}
        onNavigate={onNavigate}
        onOpenFolder={vi.fn()}
        onCreateFolder={vi.fn()}
        onOpenSettings={vi.fn()}
        createDisabled={false}
      />
    </NotificationsProvider>,
  );
  return { sidebar: screen.getByRole("complementary", { name: "Folder navigation" }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("WorkspaceSidebar", () => {
  it("starts expanded on wide windows", () => {
    stubViewportWidth(1920);
    renderSidebar();
    expect(screen.getByRole("button", { name: "Collapse folder sidebar" })).toBeInTheDocument();
  });

  it("announces the open-folder shortcut", () => {
    stubViewportWidth(1920);
    renderSidebar();
    expect(screen.getByRole("button", { name: "Open folder" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Control+O Meta+O",
    );
  });

  it("starts as a rail below 1600px and remembers expanding it there", async () => {
    const user = userEvent.setup();
    stubViewportWidth(1440);
    renderSidebar();
    await user.click(screen.getByRole("button", { name: "Expand folder sidebar" }));
    expect(localStorage.getItem("workspace-sidebar-collapsed-medium")).toBe("false");
    expect(localStorage.getItem("workspace-sidebar-collapsed")).toBeNull();
  });

  it("opens narrow windows as an overlay that keeps the rail's track and closes on Escape", async () => {
    const user = userEvent.setup();
    stubViewportWidth(1100);
    const { sidebar } = renderSidebar();
    await user.click(screen.getByRole("button", { name: "Expand folder sidebar" }));
    expect(sidebar).toHaveClass("workspace-sidebar--overlay");
    expect(sidebar).not.toHaveClass("workspace-sidebar--collapsed");
    await user.keyboard("{Escape}");
    expect(sidebar).toHaveClass("workspace-sidebar--collapsed");
  });

  it("closes the overlay from its backdrop", async () => {
    const user = userEvent.setup();
    stubViewportWidth(1100);
    const { sidebar } = renderSidebar();
    await user.click(screen.getByRole("button", { name: "Expand folder sidebar" }));
    const backdrop = sidebar.querySelector<HTMLElement>(".workspace-sidebar__backdrop");
    expect(backdrop).toBeInstanceOf(HTMLElement);
    await user.click(backdrop!);
    expect(sidebar).toHaveClass("workspace-sidebar--collapsed");
  });
});
