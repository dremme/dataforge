import { describe, expect, it } from "vitest";
import type { VideoProjectExportState } from "@/shared/types";
import { mergeExport } from "./useVideoExports";

function state(overrides: Partial<VideoProjectExportState>): VideoProjectExportState {
  return {
    id: "a",
    folder: "C:\\media",
    status: "running",
    progress: 0,
    output_path: "C:\\media\\clip-edited.mp4",
    output_name: "clip-edited.mp4",
    project_name: "Edit",
    started_at: "2026-10-12T10:00:00Z",
    ...overrides,
  };
}

describe("mergeExport", () => {
  it("keeps a finished export when a late start response arrives", () => {
    const finished = mergeExport([], state({ status: "completed", progress: 1 }));

    const merged = mergeExport(finished, state({ status: "running", progress: 0 }));

    expect(merged[0].status).toBe("completed");
  });

  it("never moves progress backwards", () => {
    const ahead = mergeExport([], state({ progress: 0.6 }));

    expect(mergeExport(ahead, state({ progress: 0.2 }))[0].progress).toBe(0.6);
    expect(mergeExport(ahead, state({ progress: 0.8 }))[0].progress).toBe(0.8);
  });

  it("lists the newest export first", () => {
    const older = mergeExport([], state({ id: "old", started_at: "2026-10-12T09:00:00Z" }));

    expect(mergeExport(older, state({ id: "new" })).map((item) => item.id)).toEqual(["new", "old"]);
  });
});
