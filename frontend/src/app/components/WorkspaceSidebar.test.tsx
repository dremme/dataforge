import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotificationsProvider } from "@/shared/notifications/NotificationsProvider";
import { EMPTY_PATH, HOME_PATH, VACATION_PATH } from "@/test/fixtures";
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

function renderSidebar(options: Parameters<typeof installMockBackend>[0] = {}) {
  const backend = installMockBackend(options);
  const onNavigate = vi.fn();
  renderWithQueryClient(
    <NotificationsProvider>
      <WorkspaceSidebar
        currentFolder={HOME_PATH}
        onNavigate={onNavigate}
        onOpenFolder={vi.fn()}
        onCreateFolder={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenVideoEditor={vi.fn()}
        videoEditorDisabled={false}
        createDisabled={false}
      />
    </NotificationsProvider>,
  );
  return {
    backend,
    sidebar: screen.getByRole("complementary", { name: "Folder navigation" }),
  };
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

  it.each([["Expand folder sidebar"], ["New folder"], [/^(Un)?favorite folder$/i]])(
    "explains the rail's %s icon on hover",
    async (name) => {
      const user = userEvent.setup();
      stubViewportWidth(1440);
      renderSidebar();

      await user.hover(screen.getByRole("button", { name }));

      expect(await screen.findByRole("tooltip")).toHaveTextContent(name);
    },
  );

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

  describe("reordering favorites", () => {
    const favoriteNames = () =>
      within(screen.getByRole("region", { name: "Favorite folders" }))
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label"));

    async function dragFavorite(from: string, to: string) {
      const dataTransfer = { setData: vi.fn(), effectAllowed: "", dropEffect: "" };
      const source = await screen.findByRole("button", { name: from });
      const target = screen.getByRole("button", { name: to });
      fireEvent.dragStart(source, { dataTransfer });
      fireEvent.dragOver(target, { dataTransfer });
      fireEvent.drop(target, { dataTransfer });
      fireEvent.dragEnd(source, { dataTransfer });
    }

    it.each([
      ["up", "Empty", "Home", ["Empty", "Home", "Vacation"]],
      ["down", "Home", "Empty", ["Vacation", "Empty", "Home"]],
    ])("moves a favorite %s onto the one it is dropped on", async (_, from, to, order) => {
      stubViewportWidth(1920);
      const { backend } = renderSidebar({
        folderFavorites: [HOME_PATH, VACATION_PATH, EMPTY_PATH],
      });

      await dragFavorite(from, to);

      await waitFor(() => expect(favoriteNames()).toEqual(order));
      const byName: Record<string, string> = {
        Home: HOME_PATH,
        Vacation: VACATION_PATH,
        Empty: EMPTY_PATH,
      };
      await waitFor(() =>
        expect(backend.fetchMock).toHaveBeenCalledWith(
          "/api/folders/favorites",
          expect.objectContaining({
            method: "PUT",
            body: JSON.stringify({ paths: order.map((name) => byName[name]) }),
          }),
        ),
      );
    });

    it("ignores a drop that leaves the order unchanged", async () => {
      stubViewportWidth(1920);
      const { backend } = renderSidebar({ folderFavorites: [HOME_PATH, VACATION_PATH] });

      await dragFavorite("Home", "Home");

      expect(favoriteNames()).toEqual(["Home", "Vacation"]);
      expect(backend.fetchMock).not.toHaveBeenCalledWith(
        "/api/folders/favorites",
        expect.objectContaining({ method: "PUT" }),
      );
    });
  });
});
