import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/shared/api/http";
import type { VideoProjectDocument } from "@/shared/types";
import * as api from "@/features/videoEditor/api/videoProjects";
import { AUTOSAVE_DELAY_MS, useVideoProject } from "./useVideoProject";

vi.mock("@/features/videoEditor/api/videoProjects", () => ({ saveVideoProject: vi.fn() }));

const saveMock = vi.mocked(api.saveVideoProject);

function document(path: string | null = null): VideoProjectDocument {
  return {
    path,
    folder: "C:\\media",
    sources: [],
    project: {
      format_version: 1,
      id: "p",
      name: "Edit",
      revision: path ? 3 : 0,
      created_at: "",
      updated_at: "",
      width: 64,
      height: 48,
      frame_rate: 10,
      sources: [],
      tracks: [
        {
          id: "v1",
          kind: "video",
          name: "V1",
          locked: false,
          hidden: false,
          muted: false,
          solo: false,
        },
      ],
      clips: [],
      transitions: [],
      export: {
        filename: "",
        size: "source",
        orientation: null,
        quality: "standard",
        copy_caption: false,
        audio_level: "limit",
      },
    },
  };
}

describe("useVideoProject", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    saveMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("writes nothing until the first edit, then saves a new draft and keeps its path", async () => {
    saveMock.mockResolvedValue({
      path: "C:\\media\\clip-edit.video-project.json",
      revision: 1,
      updated_at: "",
    });
    const { result } = renderHook(() => useVideoProject(document()));
    expect(result.current.saveState).toBe("new");
    expect(await result.current.flush()).toBe(true);
    expect(saveMock).not.toHaveBeenCalled();

    act(() => result.current.commit({ ...result.current.project, name: "Renamed" }));
    expect(result.current.saveState).toBe("unsaved");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });

    expect(saveMock).toHaveBeenCalledWith(
      "C:\\media",
      null,
      null,
      expect.objectContaining({ name: "Renamed" }),
    );
    expect(result.current.saveState).toBe("saved");
    expect(result.current.path).toBe("C:\\media\\clip-edit.video-project.json");

    act(() => result.current.commit({ ...result.current.project, name: "Again" }));
    await act(async () => {
      await result.current.flush();
    });
    expect(saveMock).toHaveBeenLastCalledWith(
      "C:\\media",
      "C:\\media\\clip-edit.video-project.json",
      1,
      expect.objectContaining({ name: "Again" }),
    );
  });

  it("reports a save that failed, and a flush says so", async () => {
    saveMock.mockRejectedValue(new ApiError(500, "Disk full"));
    const { result } = renderHook(() =>
      useVideoProject(document("C:\\media\\a.video-project.json")),
    );

    act(() => result.current.commit({ ...result.current.project, name: "Renamed" }));
    let saved = true;
    await act(async () => {
      saved = await result.current.flush();
    });

    expect(saved).toBe(false);
    expect(result.current.saveState).toBe("error");
    expect(result.current.saveError).toBe("Disk full");
  });

  it("stops saving over a newer revision and offers a copy instead", async () => {
    saveMock.mockRejectedValueOnce(new ApiError(409, "Saved from another window"));
    const { result } = renderHook(() =>
      useVideoProject(document("C:\\media\\a.video-project.json")),
    );

    act(() => result.current.commit({ ...result.current.project, name: "Mine" }));
    await act(async () => {
      await result.current.flush();
    });
    expect(result.current.saveState).toBe("conflict");

    act(() => result.current.commit({ ...result.current.project, name: "Mine again" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    expect(saveMock).toHaveBeenCalledTimes(1);

    saveMock.mockResolvedValueOnce({
      path: "C:\\media\\a-2.video-project.json",
      revision: 1,
      updated_at: "",
    });
    await act(async () => {
      await result.current.saveAsCopy();
    });
    expect(saveMock).toHaveBeenLastCalledWith("C:\\media", null, null, expect.anything());
    expect(result.current.path).toBe("C:\\media\\a-2.video-project.json");
    expect(result.current.saveState).toBe("saved");
  });

  it("undoes and redoes one committed step at a time", () => {
    const { result } = renderHook(() => useVideoProject(document()));
    const first = { ...result.current.project, name: "One" };

    act(() => result.current.commit(first));
    act(() => result.current.commit({ ...first, name: "Two" }));
    act(() => result.current.undo());
    expect(result.current.project.name).toBe("One");
    act(() => result.current.undo());
    expect(result.current.project.name).toBe("Edit");
    expect(result.current.canUndo).toBe(false);
    act(() => result.current.redo());
    expect(result.current.project.name).toBe("One");
  });

  it("records a previewed drag as one step from where it started", () => {
    const { result } = renderHook(() => useVideoProject(document()));
    const start = result.current.project;

    act(() => result.current.preview({ ...start, name: "Dragging" }));
    act(() => result.current.preview({ ...start, name: "Still dragging" }));
    act(() => result.current.commit({ ...start, name: "Dropped" }));
    act(() => result.current.undo());

    expect(result.current.project.name).toBe("Edit");
  });

  it("saves nothing for a preview alone, and a flush settles and saves an unfinished gesture", async () => {
    saveMock.mockResolvedValue({
      path: "C:\\media\\a.video-project.json",
      revision: 1,
      updated_at: "",
    });
    const { result } = renderHook(() => useVideoProject(document()));

    act(() => result.current.preview({ ...result.current.project, name: "Dragging" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AUTOSAVE_DELAY_MS);
    });
    expect(saveMock).not.toHaveBeenCalled();

    await act(async () => {
      await result.current.flush();
    });
    expect(saveMock).toHaveBeenCalledWith(
      "C:\\media",
      null,
      null,
      expect.objectContaining({ name: "Dragging" }),
    );
    act(() => result.current.undo());
    expect(result.current.project.name).toBe("Edit");
  });

  it("saves an amendment without making it an undo step", async () => {
    saveMock.mockResolvedValue({
      path: "C:\\media\\a.video-project.json",
      revision: 1,
      updated_at: "",
    });
    const { result } = renderHook(() => useVideoProject(document()));
    act(() => result.current.commit({ ...result.current.project, name: "Renamed" }));

    act(() => {
      result.current.amend((project) => ({ ...project, width: 1280 }));
    });
    await act(async () => {
      await result.current.flush();
    });
    expect(saveMock).toHaveBeenLastCalledWith(
      "C:\\media",
      null,
      null,
      expect.objectContaining({ name: "Renamed", width: 1280 }),
    );

    act(() => result.current.undo());
    expect(result.current.project).toMatchObject({ name: "Edit", width: 1280 });
    expect(result.current.canUndo).toBe(false);
  });
});
