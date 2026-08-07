import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homeFolder } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { BreadcrumbBar } from "./BreadcrumbBar";

describe("BreadcrumbBar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables path actions when the current folder is missing", () => {
    render(
      <BreadcrumbBar
        breadcrumbs={homeFolder.breadcrumbs}
        currentFolder={homeFolder.path}
        folderNotFound
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Copy path" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Open in File Explorer" })).toBeDisabled();
  });

  it("copies the current folder path", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);

    render(
      <BreadcrumbBar
        breadcrumbs={homeFolder.breadcrumbs}
        currentFolder={homeFolder.path}
        onNavigate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copy path" }));

    expect(writeText).toHaveBeenCalledWith(homeFolder.path);
    expect(screen.getByRole("button", { name: "Copied!" })).toBeInTheDocument();
  });

  it("opens the current folder in the file explorer", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();

    render(
      <BreadcrumbBar
        breadcrumbs={homeFolder.breadcrumbs}
        currentFolder={homeFolder.path}
        onNavigate={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open in File Explorer" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/folders/open?"),
        expect.objectContaining({ method: "POST" }),
      );
    });
  });
});
