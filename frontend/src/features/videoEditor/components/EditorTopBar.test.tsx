import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { VideoProjectExportState } from "@/shared/types";
import { makeProject } from "@/test/videoProject";
import type { VideoProjectState } from "@/features/videoEditor/hooks/useVideoProject";
import { EditorTopBar } from "./EditorTopBar";

function renderBar(latestExport: VideoProjectExportState) {
  const state = {
    project: makeProject(),
    path: null,
    saveState: "saved",
    saveError: null,
  } as unknown as VideoProjectState;
  render(
    <EditorTopBar
      state={state}
      latestExport={latestExport}
      onCancelExport={vi.fn<() => void>()}
      onDismissExport={vi.fn<() => void>()}
      onOpenExport={vi.fn<() => void>()}
      browserOpen
      inspectorOpen
      onToggleBrowser={vi.fn<() => void>()}
      onToggleInspector={vi.fn<() => void>()}
      menuOpen={false}
      onMenuOpenChange={vi.fn<(open: boolean) => void>()}
      onOpenProject={vi.fn<() => void>()}
      onSettings={vi.fn<() => void>()}
      onDuplicate={vi.fn<() => void>()}
      onVersions={vi.fn<() => void>()}
      onDelete={vi.fn<() => void>()}
      onExport={vi.fn<() => void>()}
      canExport
      onBack={vi.fn<() => void>()}
    />,
  );
}

const finished: VideoProjectExportState = {
  id: "e",
  folder: "/media",
  status: "completed",
  progress: 1,
  output_path: "/media/trip-edited.mp4",
  output_name: "trip-edited.mp4",
  project_name: "Trip",
  started_at: "",
};

describe("EditorTopBar export status", () => {
  it("reports what the finished file measures", () => {
    renderBar({ ...finished, loudness_lufs: -14.04, true_peak_db: -1.2 });

    expect(screen.getByText("-14.0 LUFS · peak -1.2 dBTP")).toBeInTheDocument();
  });

  it("warns when the exported sound reaches full scale", () => {
    renderBar({ ...finished, loudness_lufs: -6, true_peak_db: 2.3 });

    expect(screen.getByText(/peak 2\.3 dBTP · clipped/)).toHaveAttribute(
      "title",
      expect.stringMatching(/will distort/),
    );
  });

  it("says nothing about a level it could not measure", () => {
    renderBar(finished);

    expect(screen.queryByText(/LUFS|dBTP/)).not.toBeInTheDocument();
  });
});
