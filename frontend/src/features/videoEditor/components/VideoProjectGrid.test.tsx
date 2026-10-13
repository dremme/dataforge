import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VideoProjectSummary } from "@/shared/types";
import { renderWithQueryClient } from "@/test/queryClient";
import * as api from "@/features/videoEditor/api/videoProjects";
import { VideoProjectGrid } from "./VideoProjectGrid";

vi.mock("@/features/videoEditor/api/videoProjects", async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  listVideoProjects: vi.fn(),
}));

const summary: VideoProjectSummary = {
  path: "C:\\media\\trip.video-project.json",
  name: "Trip",
  updated_at: "2026-10-12T10:00:00Z",
  duration: 4,
  clip_count: 1,
  initial_source_name: null,
  initial_source_path: null,
};

describe("VideoProjectGrid", () => {
  it("drops a draft deleted outside the app once the folder fingerprint moves", async () => {
    const list = vi.mocked(api.listVideoProjects).mockResolvedValue({ projects: [summary] });
    const grid = (fingerprint: string) => (
      <VideoProjectGrid
        folderPath="C:\media"
        fingerprint={fingerprint}
        searchQuery=""
        onOpen={vi.fn()}
      />
    );
    const { rerender } = renderWithQueryClient(grid("before"));
    expect(await screen.findByRole("region", { name: "Video projects" })).toBeInTheDocument();

    list.mockResolvedValue({ projects: [] });
    rerender(grid("after"));

    await waitFor(() =>
      expect(screen.queryByRole("region", { name: "Video projects" })).not.toBeInTheDocument(),
    );
  });
});
