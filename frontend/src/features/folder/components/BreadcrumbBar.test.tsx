import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { homeFolder, vacationFolder } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { BreadcrumbBar } from "./BreadcrumbBar";

type BarProps = ComponentProps<typeof BreadcrumbBar>;

function renderBar(props: Partial<BarProps> = {}) {
  return render(
    <BreadcrumbBar
      breadcrumbs={homeFolder.breadcrumbs}
      currentFolder={homeFolder.path}
      hasSubfolders
      onNavigate={vi.fn()}
      onOpenPicker={vi.fn()}
      {...props}
    />,
  );
}

describe("BreadcrumbBar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables path actions when the current folder is missing", () => {
    renderBar({ folderNotFound: true });

    expect(screen.getByRole("button", { name: "Copy path" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open in File Explorer" })).toBeDisabled();
  });

  it("copies the current folder path", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    renderBar();

    await user.click(screen.getByRole("button", { name: "Copy path" }));

    expect(writeText).toHaveBeenCalledWith(homeFolder.path);

    const copied = screen.getByRole("button", { name: "Copied!" });
    expect(copied).toHaveClass("breadcrumbs__explorer--copied");
    expect(copied.querySelector(".lucide-check")).not.toBeNull();
    expect(screen.getByRole("tooltip")).toHaveTextContent("Copied!");
  });

  it("says so when the path cannot be copied", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));

    renderBar();

    await user.click(screen.getByRole("button", { name: "Copy path" }));

    const failed = screen.getByRole("button", { name: "Failed!" });
    expect(failed).toHaveClass("breadcrumbs__explorer--error");
    expect(screen.getByRole("tooltip")).toHaveTextContent("Failed!");
  });

  it("opens the current folder in the file explorer", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();

    renderBar();

    await user.click(screen.getByRole("button", { name: "Open in File Explorer" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/folders/open?"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("lists the current folder's subfolders from the trailing chevron", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    installMockBackend();

    renderBar({ onNavigate });

    await user.click(screen.getByRole("button", { name: "Subfolders of Photos" }));

    await user.click(await screen.findByRole("menuitem", { name: "Vacation" }));

    expect(onNavigate).toHaveBeenCalledWith(vacationFolder.path);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  // The crumb menu is the one that opens from the left edge of its trigger; a
  // silently wrong placement would only show as a panel drifting off the crumb.
  it("drops the subfolder menu from the left edge of its chevron", async () => {
    const user = userEvent.setup();
    installMockBackend();
    vi.spyOn(window, "innerWidth", "get").mockReturnValue(1000);
    vi.spyOn(window, "innerHeight", "get").mockReturnValue(800);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      const box = this.classList.contains("breadcrumbs__menu-panel")
        ? { top: 0, left: 0, width: 200, height: 100 }
        : { top: 50, left: 300, width: 20, height: 20 };
      return {
        ...box,
        right: box.left + box.width,
        bottom: box.top + box.height,
        x: box.left,
        y: box.top,
        toJSON: () => ({}),
      } as DOMRect;
    });

    renderBar();

    await user.click(screen.getByRole("button", { name: "Subfolders of Photos" }));

    const panel = await screen.findByRole("menu");
    expect(panel.parentElement).toBe(document.body);
    expect(panel.style.left).toBe("300px");
    expect(panel.style.top).toBe("76px");
  });

  it("marks the subfolder the path is currently inside", async () => {
    const user = userEvent.setup();
    installMockBackend();

    renderBar({
      breadcrumbs: vacationFolder.breadcrumbs,
      currentFolder: vacationFolder.path,
      hasSubfolders: false,
    });

    await user.click(screen.getByRole("button", { name: "Subfolders of Photos" }));

    expect(await screen.findByRole("menuitem", { name: "Vacation" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("leaves the trailing chevron off a folder with no subfolders", () => {
    installMockBackend();

    renderBar({
      breadcrumbs: vacationFolder.breadcrumbs,
      currentFolder: vacationFolder.path,
      hasSubfolders: false,
    });

    expect(
      screen.queryByRole("button", { name: "Subfolders of Vacation" }),
    ).not.toBeInTheDocument();
    // Earlier crumbs keep theirs — they always have the next crumb to list.
    expect(screen.getByRole("button", { name: "Subfolders of Photos" })).toBeInTheDocument();
  });

  it("says so when a folder turns out to have no subfolders after all", async () => {
    const user = userEvent.setup();
    installMockBackend();

    renderBar();

    // The mock knows the drive root exists but has no children under it.
    await user.click(screen.getByRole("button", { name: "Subfolders of C:" }));

    expect(await screen.findByText("No subfolders")).toBeInTheDocument();
  });

  it("shows the failure inside the menu when the children cannot be listed", async () => {
    const user = userEvent.setup();
    installMockBackend();

    // The mock backend only knows the fixture folders, so this one 404s.
    const ghostPath = `${homeFolder.path}\\Ghost`;

    renderBar({
      breadcrumbs: [...homeFolder.breadcrumbs, { name: "Ghost", path: ghostPath }],
      currentFolder: ghostPath,
    });

    await user.click(screen.getByRole("button", { name: "Subfolders of Ghost" }));

    expect(await screen.findByText("Folder not found")).toBeInTheDocument();
  });
});
