import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VideoProjectExportState } from "@/shared/types";
import { installMockBackend } from "@/test/mockBackend";
import { renderWithProviders } from "@/test/renderWithProviders";
import * as api from "@/features/videoEditor/api/videoProjects";
import { VideoExportTracker } from "./VideoExportTracker";

vi.mock("@/features/videoEditor/api/videoProjects", async (importOriginal) => {
  const actual = await importOriginal<typeof api>();
  return {
    ...actual,
    listVideoProjectExports: vi.fn(),
    cancelVideoProjectExport: vi.fn(),
    dismissVideoProjectExport: vi.fn(),
  };
});

function job(id: string, patch: Partial<VideoProjectExportState>): VideoProjectExportState {
  return {
    id,
    folder: "/media",
    status: "running",
    progress: 0.25,
    output_path: `/media/${id}.mp4`,
    output_name: `${id}.mp4`,
    project_name: id,
    started_at: "",
    ...patch,
  };
}

describe("VideoExportTracker", () => {
  beforeEach(() => {
    installMockBackend();
    vi.mocked(api.listVideoProjectExports).mockResolvedValue({
      exports: [
        job("trip", {}),
        job("party", { status: "completed", progress: 1 }),
        job("broken", { status: "failed", error: "Disk full" }),
      ],
    });
  });

  it("keeps exports in sight from the gallery, each with what can be done about it", async () => {
    const user = userEvent.setup();
    const cancel = vi.mocked(api.cancelVideoProjectExport).mockResolvedValue(job("trip", {}));
    const dismiss = vi.mocked(api.dismissVideoProjectExport).mockResolvedValue();
    const onOpen = vi.fn();
    renderWithProviders(<VideoExportTracker hidden={false} onOpen={onOpen} />);

    expect(await screen.findByText(/Exporting trip\.mp4 · 25%/)).toBeInTheDocument();
    expect(screen.getByText("Export of broken.mp4 failed: Disk full")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Open" }));
    await user.click(screen.getByRole("button", { name: "Dismiss broken.mp4" }));

    expect(cancel).toHaveBeenCalledWith("trip");
    expect(onOpen).toHaveBeenCalledWith("/media/party.mp4");
    expect(dismiss).toHaveBeenCalledWith("broken");
  });

  it("stays hidden while the editor shows its own exports", async () => {
    renderWithProviders(<VideoExportTracker hidden onOpen={vi.fn()} />);

    await Promise.resolve();
    expect(screen.queryByText(/Exporting/)).not.toBeInTheDocument();
  });
});
