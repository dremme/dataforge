import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { homeBrowse } from "@/test/fixtures";
import { installMockBackend } from "@/test/mockBackend";
import { BreadcrumbBar } from "./BreadcrumbBar";

describe("BreadcrumbBar", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables explorer when the current folder is missing", () => {
    render(
      <BreadcrumbBar
        breadcrumbs={homeBrowse.breadcrumbs}
        currentFolder={homeBrowse.folder}
        folderNotFound
        onNavigate={vi.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Open in File Explorer" })).toBeDisabled();
  });

  it("opens the create-folder dialog from the breadcrumb bar", async () => {
    const user = userEvent.setup();
    const onCreateFolder = vi.fn();

    render(
      <BreadcrumbBar
        breadcrumbs={homeBrowse.breadcrumbs}
        currentFolder={homeBrowse.folder}
        onNavigate={vi.fn()}
        onCreateFolder={onCreateFolder}
      />,
    );

    await user.click(screen.getByRole("button", { name: "New folder" }));

    expect(onCreateFolder).toHaveBeenCalledTimes(1);
  });

  it("opens the current folder in the file explorer", async () => {
    const user = userEvent.setup();
    const { fetchMock } = installMockBackend();

    render(
      <BreadcrumbBar
        breadcrumbs={homeBrowse.breadcrumbs}
        currentFolder={homeBrowse.folder}
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
